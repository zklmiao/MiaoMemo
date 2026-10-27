//! Note model and persistence for MiaoMemo.
//!
//! The store keeps the whole database in memory and coalesces disk writes with
//! a 250ms debounce. Writes are atomic (`notes.json.tmp` -> `notes.json`), and
//! corrupt or structurally invalid files are copied aside before recovery.

use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const DEFAULT_NOTE_WIDTH: f64 = 300.0;
pub const DEFAULT_NOTE_HEIGHT: f64 = 350.0;
pub const FLUSH_DELAY_MS: u64 = 250;

const MIN_NOTE_WIDTH: f64 = 100.0;
const MIN_NOTE_HEIGHT: f64 = 100.0;
const VALID_COLORS: [&str; 6] = ["white", "yellow", "pink", "blue", "green", "purple"];

/// Payload limits for renderer-supplied note updates. They sit far above
/// normal sticky-note usage but bound pathological payloads.
pub const MAX_PAGES: usize = 200;
pub const MAX_PAGE_TITLE_CHARS: usize = 200;
pub const MAX_PAGE_CONTENT_CHARS: usize = 100_000;

fn valid_page(page: &Page) -> bool {
    page.title.chars().count() <= MAX_PAGE_TITLE_CHARS
        && page.content.chars().count() <= MAX_PAGE_CONTENT_CHARS
}

fn validate_update_fields(fields: &UpdateNoteFields) -> bool {
    if let Some(pages) = &fields.pages {
        if pages.is_empty() || pages.len() > MAX_PAGES {
            return false;
        }
        if !pages.iter().all(valid_page) {
            return false;
        }
    }
    if let Some(color) = &fields.color {
        if !is_valid_color(color) {
            return false;
        }
    }
    true
}

const WELCOME_CONTENT: &str = r#"# 欢迎使用 MiaoMemo!

这是一款极简风格的 Windows 桌面悬浮亚克力便签。

**✨ 待办清单 🗒️**
- [ ] **新增任务**：输入 `- [ ] 任务内容` 即可自动渲染为精美的圆角复选框。
- [x] **已完成任务**：直接用鼠标点击复选框即可快捷勾选，此条为已完成演示。

**✨ 极简操作：**
- **拖拽**：按住顶部空白处（拖拽条位置）即可移动便签。
- **置顶 📌**：点击顶部左侧图钉，锁定便签在最上层。
- **调色 🎨**：在便签区域内右键，选择“更换主题”即可切换 6 种色系。
- **自动保存**：写完即走，无需手动保存。
- **新建 `+`**：点击底部 `+` 即可在桌面新建一个便签。"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page {
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub pages: Vec<Page>,
    #[serde(default)]
    pub current_page_index: usize,
    #[serde(default = "default_color")]
    pub color: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub is_pinned: bool,
}

fn default_color() -> String {
    "white".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Db {
    /// 0/缺失 = 旧版文件；加载时在内存中升级到 CURRENT_SCHEMA_VERSION，
    /// 下一次成功写盘时持久化。更高版本视为不兼容（见 load_db_from_disk）。
    #[serde(default)]
    pub schema_version: u32,
    pub notes: Vec<Note>,
}

/// Current notes.json schema version. Bump when the on-disk shape changes in
/// a way older builds cannot read.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Corruption backups (`notes.json.corrupt-<millis>.bak`) retained per file.
pub const MAX_BACKUPS: usize = 10;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreHealth {
    pub dirty: bool,
    pub read_only: bool,
    /// 后台写入线程失联（panic/通道关闭）：商店改为同步直写并保持可用。
    pub degraded: bool,
    pub last_success: Option<u64>,
    pub last_error: Option<String>,
    pub retry_count: u32,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteFields {
    pub pages: Option<Vec<Page>>,
    pub current_page_index: Option<usize>,
    pub color: Option<String>,
    pub is_pinned: Option<bool>,
}

#[derive(Debug)]
pub struct LoadOutcome {
    pub db: Db,
    pub needs_save: bool,
    pub skipped_notes: usize,
    pub repaired_ids: usize,
    pub backup_path: Option<PathBuf>,
    pub read_error: Option<String>,
    pub safe_to_write: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawNote {
    id: Option<String>,
    pages: Option<Vec<RawPage>>,
    current_page_index: Option<usize>,
    color: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    is_pinned: Option<bool>,
    is_collapsed: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum RawPage {
    Text(String),
    Object(Page),
}

impl RawNote {
    fn normalize(self) -> (Note, bool) {
        let mut changed = self.is_collapsed.is_some();

        let raw_pages = self.pages.unwrap_or_default();
        let pages: Vec<Page> = raw_pages
            .into_iter()
            .map(|page| match page {
                RawPage::Text(text) => {
                    changed = true;
                    Page {
                        title: extract_title_from_text(&text),
                        content: text,
                    }
                }
                RawPage::Object(page) => page,
            })
            .collect();

        let id = match self.id {
            Some(id) if is_valid_note_id(&id) => id,
            _ => {
                changed = true;
                make_note_id()
            }
        };

        let current_page_index = match self.current_page_index {
            Some(index) => {
                let max = pages.len().saturating_sub(1);
                if index > max {
                    changed = true;
                    max
                } else {
                    index
                }
            }
            None => 0,
        };

        let color = match self.color {
            Some(color) if is_valid_color(&color) => color,
            _ => {
                changed = true;
                default_color()
            }
        };

        let (x, x_changed) = sanitize_coordinate(self.x);
        let (y, y_changed) = sanitize_coordinate(self.y);
        let (width, width_changed) =
            sanitize_dimension(self.width, DEFAULT_NOTE_WIDTH, MIN_NOTE_WIDTH);
        let (height, height_changed) =
            sanitize_dimension(self.height, DEFAULT_NOTE_HEIGHT, MIN_NOTE_HEIGHT);
        changed |= x_changed || y_changed || width_changed || height_changed;

        let is_pinned = self.is_pinned.unwrap_or(false);

        (
            Note {
                id,
                pages,
                current_page_index,
                color,
                x,
                y,
                width,
                height,
                is_pinned,
            },
            changed,
        )
    }
}

fn sanitize_coordinate(value: Option<f64>) -> (f64, bool) {
    match value {
        Some(value) if value.is_finite() => (value, false),
        Some(_) => (0.0, true),
        None => (0.0, true),
    }
}

fn sanitize_dimension(value: Option<f64>, fallback: f64, minimum: f64) -> (f64, bool) {
    match value {
        Some(value) if value.is_finite() && value >= minimum => (value, false),
        Some(_) => (fallback, true),
        None => (fallback, true),
    }
}

fn is_valid_color(color: &str) -> bool {
    VALID_COLORS.contains(&color)
}

/// Window labels (and therefore note ids) must be safe for Tauri. Legacy ids
/// match this already; anything else is regenerated during migration.
fn is_valid_note_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 120
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Title extraction shared with the frontend `extractTitleFromText`
/// (src/noteUtils.js): 只剥离开头的 Markdown 标记（标题 #、列表 -/*/+、复选框
/// [ ]、强调 * _ `），保留日期/连字符词内部的 `-`；整行仅由符号构成视为无标题。
/// 共享用例见 tests/test-title-extract.js 与本文件测试，两侧必须保持对齐。
pub fn extract_title_from_text(text: &str) -> String {
    let line = text.trim().split('\n').next().unwrap_or("").trim();
    if line.is_empty() {
        return String::new();
    }
    // 整行只有符号/空白（如 `---`、`***`）→ 无有效标题
    let symbol_only = line
        .chars()
        .all(|c| matches!(c, '#' | '*' | '`' | '_' | '-' | ' ' | '\t'));
    if symbol_only {
        return String::new();
    }

    let mut current = line.to_string();
    for _ in 0..3 {
        let next = strip_trailing_markers(&strip_leading_markers(&current)).to_string();
        if next == current {
            break;
        }
        current = next;
    }
    current.trim().chars().take(16).collect()
}

fn strip_leading_markers(s: &str) -> &str {
    let mut t = s;

    // ATX 标题：连续 `#` 后跟空白
    let after_hashes = t.trim_start_matches('#');
    if after_hashes.len() != t.len() {
        t = after_hashes.trim_start();
    }

    // 列表项：`-`/`*`/`+` 后跟至少一个空白
    if let Some(rest) = strip_list_marker(t) {
        t = rest;
    }

    // 待办复选框：`[ ]`/`[x]`/`[X]` 后跟空白
    if let Some(rest) = strip_checkbox(t) {
        t = rest;
    }

    // 前置强调/行内代码反引号
    t.trim_start_matches(['*', '_', '`'])
}

fn strip_list_marker(t: &str) -> Option<&str> {
    let bytes = t.as_bytes();
    if !matches!(bytes.first(), Some(b'-') | Some(b'*') | Some(b'+')) {
        return None;
    }
    match bytes.get(1) {
        Some(b' ') | Some(b'\t') => Some(t[1..].trim_start()),
        _ => None,
    }
}

fn strip_checkbox(t: &str) -> Option<&str> {
    let bytes = t.as_bytes();
    if bytes.first() != Some(&b'[') {
        return None;
    }
    match bytes.get(1) {
        Some(b' ') | Some(b'x') | Some(b'X') => {}
        _ => return None,
    }
    if bytes.get(2) != Some(&b']') {
        return None;
    }
    Some(t[3..].trim_start())
}

fn strip_trailing_markers(s: &str) -> &str {
    s.trim_end_matches(['*', '_', '`', ' ', '\t'])
}

pub fn is_note_empty(note: &Note) -> bool {
    note.pages.is_empty()
        || note
            .pages
            .iter()
            .all(|page| page.title.trim().is_empty() && page.content.trim().is_empty())
}

pub fn make_note_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let suffix = Uuid::new_v4().simple().to_string();
    format!("note-{millis}-{}", &suffix[..6])
}

pub fn create_default_note(id: String, x: f64, y: f64) -> Note {
    Note {
        id,
        pages: vec![Page {
            title: String::new(),
            content: String::new(),
        }],
        current_page_index: 0,
        color: default_color(),
        x,
        y,
        width: DEFAULT_NOTE_WIDTH,
        height: DEFAULT_NOTE_HEIGHT,
        is_pinned: false,
    }
}

pub fn welcome_note(id: String, x: f64, y: f64) -> Note {
    Note {
        id,
        pages: vec![Page {
            title: "欢迎使用 MiaoMemo!".to_string(),
            content: WELCOME_CONTENT.to_string(),
        }],
        current_page_index: 0,
        color: default_color(),
        x,
        y,
        width: DEFAULT_NOTE_WIDTH,
        height: DEFAULT_NOTE_HEIGHT,
        is_pinned: false,
    }
}

/// Remove empty notes and ensure the database always has at least one note.
/// This also prevents the "empty database -> no window at all" startup case.
pub fn migrate_db(db: &mut Db, x: f64, y: f64) -> bool {
    let before = db.notes.len();
    db.notes
        .retain(|note| !note.pages.is_empty() && !is_note_empty(note));

    let mut changed = db.notes.len() != before;

    for note in &mut db.notes {
        let max = note.pages.len().saturating_sub(1);
        if note.current_page_index > max {
            note.current_page_index = max;
            changed = true;
        }
    }

    if db.notes.is_empty() {
        db.notes.push(welcome_note(make_note_id(), x, y));
        changed = true;
    }

    changed
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("notes.json")
        .to_string()
}

fn tmp_path(path: &Path) -> PathBuf {
    path.with_file_name(format!("{}.tmp", file_name(path)))
}

pub fn atomic_write_file(path: &Path, content: &str) -> io::Result<()> {
    let tmp = tmp_path(path);
    {
        let mut file = File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn backup_corrupted_file(path: &Path) -> io::Result<PathBuf> {
    let backup = path.with_file_name(format!(
        "{}.corrupt-{}.bak",
        file_name(path),
        timestamp_millis()
    ));
    fs::copy(path, &backup)?;
    prune_backups(path, MAX_BACKUPS);
    Ok(backup)
}

/// 只保留最近 `keep` 份损坏备份，且仅匹配本应用创建的
/// `<file>.corrupt-<纯数字>.bak` 命名——其余文件一律不碰。
pub fn prune_backups(path: &Path, keep: usize) {
    let prefix = format!("{}.corrupt-", file_name(path));
    let dir = match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir.to_path_buf(),
        _ => return,
    };
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut backups: Vec<(PathBuf, (SystemTime, String))> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(&prefix) || !name.ends_with(".bak") {
            continue;
        }
        let stem = &name[prefix.len()..name.len() - ".bak".len()];
        if stem.is_empty() || !stem.bytes().all(|b| b.is_ascii_digit()) {
            continue; // 非本应用时间戳命名（如手工创建）→ 保守跳过
        }
        let modified = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .unwrap_or(UNIX_EPOCH);
        backups.push((entry.path(), (modified, name)));
    }

    if backups.len() <= keep {
        return;
    }
    // 最新在前；时间戳相同则按文件名比较（时间戳为等宽数字时即数值序）。
    backups.sort_by(|a, b| b.1.cmp(&a.1));
    for (backup, _) in backups.iter().skip(keep) {
        if let Err(error) = fs::remove_file(backup) {
            log::warn!("Failed to prune old backup {}: {error}", backup.display());
        }
    }
}

/// If the main file exists, a leftover `.tmp` is stale and can be removed.
/// If the main file is missing, a parseable `.tmp` is the newest copy and is
/// promoted instead of being deleted.
pub fn cleanup_stale_tmp(path: &Path) {
    let tmp = tmp_path(path);
    if !tmp.exists() {
        return;
    }

    if path.exists() {
        let _ = fs::remove_file(&tmp);
        return;
    }

    let parseable = fs::read_to_string(&tmp)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("notes").map(|notes| notes.is_array()))
        .unwrap_or(false);

    if parseable {
        let _ = fs::rename(&tmp, path);
    } else {
        let _ = fs::remove_file(&tmp);
    }
}

pub fn load_db_from_disk(path: &Path) -> LoadOutcome {
    if !path.exists() {
        return LoadOutcome {
            db: Db::default(),
            needs_save: false,
            skipped_notes: 0,
            repaired_ids: 0,
            backup_path: None,
            read_error: None,
            safe_to_write: true,
        };
    }

    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) => {
            let read_error = error.to_string();
            let backup_path = backup_corrupted_file(path).ok();
            log::error!(
                "Cannot read notes database at {}: {read_error}; backup={backup_path:?}",
                path.display()
            );
            return LoadOutcome {
                db: Db::default(),
                needs_save: false,
                skipped_notes: 0,
                repaired_ids: 0,
                backup_path,
                read_error: Some(read_error),
                safe_to_write: false,
            };
        }
    };

    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            let backup_path = backup_corrupted_file(path).ok();
            log::error!("notes.json corrupted, backed up to {backup_path:?}: {error}");
            return LoadOutcome {
                db: Db::default(),
                needs_save: true,
                skipped_notes: 0,
                repaired_ids: 0,
                backup_path,
                read_error: None,
                safe_to_write: true,
            };
        }
    };

    // Future schema versions must never be silently downgraded or overwritten.
    let file_schema_version = parsed
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    if file_schema_version > CURRENT_SCHEMA_VERSION {
        let backup_path = backup_corrupted_file(path).ok();
        let message = format!(
            "notes.json schema version {file_schema_version} is newer than supported version {CURRENT_SCHEMA_VERSION}; refusing to overwrite it"
        );
        log::error!("{message}; backed up to {backup_path:?}");
        return LoadOutcome {
            db: Db::default(),
            needs_save: false,
            skipped_notes: 0,
            repaired_ids: 0,
            backup_path,
            read_error: Some(message),
            safe_to_write: false,
        };
    }

    let Some(notes_value) = parsed.get("notes").and_then(|notes| notes.as_array()) else {
        let backup_path = backup_corrupted_file(path).ok();
        log::error!("notes.json has invalid structure, backed up to {backup_path:?}");
        return LoadOutcome {
            db: Db::default(),
            needs_save: true,
            skipped_notes: 0,
            repaired_ids: 0,
            backup_path,
            read_error: None,
            safe_to_write: true,
        };
    };

    let mut db = Db::default();
    // 文件自带的版本号先落进内存库：0/缺失 = 旧版，随后统一升级。
    db.schema_version = file_schema_version;
    let mut needs_save = false;
    let mut skipped_notes = 0;

    for value in notes_value {
        match serde_json::from_value::<RawNote>(value.clone()) {
            Ok(raw_note) => {
                let (note, changed) = raw_note.normalize();
                needs_save |= changed;
                db.notes.push(note);
            }
            Err(_) => {
                skipped_notes += 1;
                needs_save = true;
            }
        }
    }

    // Duplicate ids would map two windows onto one note; keep the first id and
    // regenerate later duplicates. The original file is backed up below.
    let mut repaired_ids = 0usize;
    let mut seen_ids = std::collections::HashSet::new();
    for note in &mut db.notes {
        if seen_ids.insert(note.id.clone()) {
            continue;
        }
        loop {
            let candidate = make_note_id();
            if seen_ids.insert(candidate.clone()) {
                note.id = candidate;
                break;
            }
        }
        repaired_ids += 1;
        needs_save = true;
    }
    if repaired_ids > 0 {
        log::warn!("Repaired {repaired_ids} duplicate note id(s)");
    }

    // Legacy files carry no version; upgrade in memory and persist on the
    // next successful write.
    if db.schema_version == 0 {
        db.schema_version = CURRENT_SCHEMA_VERSION;
        needs_save = true;
    }

    let backup_path = if skipped_notes > 0 || repaired_ids > 0 {
        let backup = backup_corrupted_file(path).ok();
        log::error!(
            "notes.json needed repair ({skipped_notes} invalid note(s), {repaired_ids} duplicate id(s)), backed up to {backup:?}"
        );
        backup
    } else {
        None
    };

    LoadOutcome {
        db,
        needs_save,
        skipped_notes,
        repaired_ids,
        backup_path,
        read_error: None,
        safe_to_write: true,
    }
}

struct Inner {
    db: Db,
    dirty: bool,
    generation: u64,
    read_only: bool,
    degraded: bool,
    last_success: Option<SystemTime>,
    last_error: Option<String>,
    retry_count: u32,
}

/// 锁中毒恢复：另一线程在持锁期间 panic 会毒化 Mutex，但受保护的数据本身
/// 结构完好，直接取回数据而不是让调用方 panic。
fn lock_inner(inner: &Mutex<Inner>) -> std::sync::MutexGuard<'_, Inner> {
    inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct Store {
    path: PathBuf,
    inner: Arc<Mutex<Inner>>,
    tx: mpsc::Sender<u64>,
    health_tx: Option<mpsc::Sender<StoreHealth>>,
}

const BACKOFF_MS: [u64; 4] = [250, 1000, 5000, 30000];

fn backoff_delay(attempt: u32) -> Duration {
    let index = (attempt as usize).min(BACKOFF_MS.len() - 1);
    Duration::from_millis(BACKOFF_MS[index])
}

fn millis_since_epoch(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn health_snapshot(inner: &Inner) -> StoreHealth {
    StoreHealth {
        dirty: inner.dirty,
        read_only: inner.read_only,
        degraded: inner.degraded,
        last_success: inner.last_success.map(millis_since_epoch),
        last_error: inner.last_error.clone(),
        retry_count: inner.retry_count,
    }
}

fn publish_health(tx: &Option<mpsc::Sender<StoreHealth>>, health: StoreHealth) {
    if let Some(tx) = tx {
        let _ = tx.send(health);
    }
}

impl Store {
    #[cfg(test)]
    pub fn load(path: PathBuf) -> (Self, LoadOutcome) {
        let outcome = load_db_from_disk(&path);
        Self::from_outcome(path, outcome, None)
    }

    pub fn from_outcome(
        path: PathBuf,
        outcome: LoadOutcome,
        health_tx: Option<mpsc::Sender<StoreHealth>>,
    ) -> (Self, LoadOutcome) {
        let read_only = !outcome.safe_to_write;
        let inner = Arc::new(Mutex::new(Inner {
            db: outcome.db.clone(),
            dirty: outcome.needs_save,
            generation: 0,
            read_only,
            degraded: false,
            last_success: None,
            last_error: outcome.read_error.clone(),
            retry_count: 0,
        }));

        let (tx, rx) = mpsc::channel::<u64>();
        let worker_inner = Arc::clone(&inner);
        let worker_path = path.clone();
        let worker_health_tx = health_tx.clone();

        thread::Builder::new()
            .name("miao-memo-store".to_string())
            .spawn(move || {
                while let Ok(mut generation) = rx.recv() {
                    thread::sleep(Duration::from_millis(FLUSH_DELAY_MS));

                    // Coalesce all requests that arrived during the delay.
                    while let Ok(newer) = rx.try_recv() {
                        generation = newer;
                    }

                    let mut guard = lock_inner(&worker_inner);
                    if guard.generation != generation || !guard.dirty || guard.read_only {
                        continue;
                    }

                    let mut attempt = 0u32;
                    loop {
                        if guard.generation != generation || !guard.dirty {
                            break;
                        }

                        match write_db(&worker_path, &guard.db) {
                            Ok(()) => {
                                guard.dirty = false;
                                guard.last_success = Some(SystemTime::now());
                                guard.last_error = None;
                                guard.retry_count = 0;
                                let health = health_snapshot(&guard);
                                drop(guard);
                                publish_health(&worker_health_tx, health);
                                break;
                            }
                            Err(error) => {
                                guard.retry_count = guard.retry_count.saturating_add(1);
                                guard.last_error = Some(error.to_string());
                                let health = health_snapshot(&guard);
                                let delay = backoff_delay(attempt);
                                attempt = attempt.saturating_add(1);
                                drop(guard);
                                log::error!(
                                    "Error writing notes database (retry in {:?}): {error}",
                                    delay
                                );
                                publish_health(&worker_health_tx, health);
                                thread::sleep(delay);
                                guard = lock_inner(&worker_inner);
                                if guard.generation != generation || !guard.dirty {
                                    break;
                                }
                            }
                        }
                    }
                }
            })
            .expect("failed to spawn notes store worker");

        (
            Self {
                path,
                inner,
                tx,
                health_tx,
            },
            LoadOutcome {
                db: outcome.db,
                needs_save: outcome.needs_save,
                skipped_notes: outcome.skipped_notes,
                repaired_ids: outcome.repaired_ids,
                backup_path: outcome.backup_path,
                read_error: outcome.read_error,
                safe_to_write: outcome.safe_to_write,
            },
        )
    }

    /// 通知后台写入线程。通道已关闭（worker panic/退出）时计划写入会静默
    /// 丢失，此时标记 degraded 并由调用线程直接落盘。
    fn send_generation(&self, generation: u64) {
        if self.tx.send(generation).is_err() {
            self.handle_worker_loss();
        }
    }

    fn handle_worker_loss(&self) {
        {
            let mut guard = lock_inner(&self.inner);
            if !guard.degraded {
                guard.degraded = true;
                log::error!("Store worker unavailable; falling back to direct writes");
            }
        }
        if let Err(error) = self.flush_now() {
            log::error!("Direct fallback write after worker loss failed: {error}");
        }
    }

    pub fn schedule(&self) {
        let (generation, became_dirty) = {
            let mut guard = lock_inner(&self.inner);
            if guard.read_only {
                return;
            }
            let became_dirty = !guard.dirty;
            guard.dirty = true;
            guard.generation += 1;
            (guard.generation, became_dirty)
        };
        if became_dirty {
            self.publish_health();
        }
        self.send_generation(generation);
    }

    pub fn flush_now(&self) -> io::Result<bool> {
        let mut guard = lock_inner(&self.inner);
        if guard.read_only {
            let error = io::Error::other("notes database is read-only");
            guard.last_error = Some(error.to_string());
            let health = health_snapshot(&guard);
            drop(guard);
            self.publish_health_snapshot(health);
            return Err(error);
        }
        if !guard.dirty {
            return Ok(false);
        }

        match write_db(&self.path, &guard.db) {
            Ok(()) => {
                guard.dirty = false;
                guard.last_success = Some(SystemTime::now());
                guard.last_error = None;
                guard.retry_count = 0;
                let health = health_snapshot(&guard);
                drop(guard);
                self.publish_health_snapshot(health);
                Ok(true)
            }
            Err(error) => {
                guard.retry_count = guard.retry_count.saturating_add(1);
                guard.last_error = Some(error.to_string());
                let health = health_snapshot(&guard);
                drop(guard);
                self.publish_health_snapshot(health);
                Err(error)
            }
        }
    }

    pub fn health(&self) -> StoreHealth {
        let guard = lock_inner(&self.inner);
        health_snapshot(&guard)
    }

    /// Reload the database after a startup read error, keeping the same store
    /// worker. On success the in-memory database is replaced and the caller can
    /// resume migration/window creation. On failure the store stays read-only.
    pub fn reload_from_disk(&self) -> LoadOutcome {
        let outcome = load_db_from_disk(&self.path);
        let generation = {
            let mut guard = lock_inner(&self.inner);
            guard.read_only = !outcome.safe_to_write;
            guard.last_error = outcome.read_error.clone();
            if outcome.safe_to_write {
                guard.db = outcome.db.clone();
                guard.dirty = outcome.needs_save;
                guard.last_success = None;
                guard.retry_count = 0;
                guard.generation += 1;
                Some(guard.generation)
            } else {
                None
            }
        };
        if let Some(generation) = generation {
            self.send_generation(generation);
        }
        self.publish_health();
        outcome
    }

    fn publish_health(&self) {
        let health = self.health();
        self.publish_health_snapshot(health);
    }

    fn publish_health_snapshot(&self, health: StoreHealth) {
        publish_health(&self.health_tx, health);
    }

    pub fn get_note(&self, id: &str) -> Option<Note> {
        let guard = lock_inner(&self.inner);
        guard.db.notes.iter().find(|note| note.id == id).cloned()
    }

    pub fn all_notes(&self) -> Vec<Note> {
        let guard = lock_inner(&self.inner);
        guard.db.notes.clone()
    }

    pub fn add_note(&self, note: Note) {
        let generation = {
            let mut guard = lock_inner(&self.inner);
            guard.db.notes.push(note);
            guard.dirty = true;
            guard.generation += 1;
            guard.generation
        };
        self.send_generation(generation);
    }

    pub fn remove_note(&self, id: &str) -> bool {
        let generation = {
            let mut guard = lock_inner(&self.inner);
            let before = guard.db.notes.len();
            guard.db.notes.retain(|note| note.id != id);
            if guard.db.notes.len() == before {
                return false;
            }
            guard.dirty = true;
            guard.generation += 1;
            guard.generation
        };
        self.send_generation(generation);
        true
    }

    pub fn remove_if_empty(&self, id: &str) -> bool {
        let mut guard = lock_inner(&self.inner);
        let Some(note) = guard.db.notes.iter().find(|note| note.id == id) else {
            return false;
        };
        if !is_note_empty(note) {
            return false;
        }
        guard.db.notes.retain(|note| note.id != id);
        guard.dirty = true;
        guard.generation += 1;
        let generation = guard.generation;
        drop(guard);
        self.send_generation(generation);
        true
    }

    pub fn update_note(&self, id: &str, fields: &UpdateNoteFields) -> Option<Note> {
        if !validate_update_fields(fields) {
            return None;
        }
        let (snapshot, generation) = {
            let mut guard = lock_inner(&self.inner);
            let note = guard.db.notes.iter_mut().find(|note| note.id == id)?;

            if let Some(pages) = &fields.pages {
                note.pages = pages.clone();
            }

            let max_index = note.pages.len().saturating_sub(1);
            match fields.current_page_index {
                Some(index) => note.current_page_index = index.min(max_index),
                None if note.current_page_index > max_index => {
                    note.current_page_index = max_index;
                }
                None => {}
            }

            if let Some(color) = &fields.color {
                if is_valid_color(color) {
                    note.color = color.clone();
                }
            }

            if let Some(is_pinned) = fields.is_pinned {
                note.is_pinned = is_pinned;
            }

            let snapshot = note.clone();
            guard.dirty = true;
            guard.generation += 1;
            (snapshot, guard.generation)
        };

        self.send_generation(generation);
        Some(snapshot)
    }

    pub fn update_geometry(
        &self,
        id: &str,
        x: Option<f64>,
        y: Option<f64>,
        width: Option<f64>,
        height: Option<f64>,
    ) -> bool {
        let mut guard = lock_inner(&self.inner);
        let Some(note) = guard.db.notes.iter_mut().find(|note| note.id == id) else {
            return false;
        };

        let mut changed = false;
        if let Some(value) = x {
            if value.is_finite() && note.x != value {
                note.x = value;
                changed = true;
            }
        }
        if let Some(value) = y {
            if value.is_finite() && note.y != value {
                note.y = value;
                changed = true;
            }
        }
        if let Some(value) = width {
            if value.is_finite() && value >= MIN_NOTE_WIDTH && note.width != value {
                note.width = value;
                changed = true;
            }
        }
        if let Some(value) = height {
            if value.is_finite() && value >= MIN_NOTE_HEIGHT && note.height != value {
                note.height = value;
                changed = true;
            }
        }

        if !changed {
            return false;
        }

        guard.dirty = true;
        guard.generation += 1;
        let generation = guard.generation;
        drop(guard);
        self.send_generation(generation);
        true
    }

    pub fn migrate(&self, x: f64, y: f64) -> bool {
        let generation = {
            let mut guard = lock_inner(&self.inner);
            if guard.read_only {
                return false;
            }
            if !migrate_db(&mut guard.db, x, y) {
                return false;
            }
            guard.dirty = true;
            guard.generation += 1;
            guard.generation
        };
        self.send_generation(generation);
        true
    }
}

fn write_db(path: &Path, db: &Db) -> io::Result<()> {
    // 落盘时盖当前版本号：旧版文件升级后的第一次写入即携带 schemaVersion。
    let mut stamped = db.clone();
    stamped.schema_version = CURRENT_SCHEMA_VERSION;
    let content = serde_json::to_string_pretty(&stamped).map_err(io::Error::other)?;
    atomic_write_file(path, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("miao-memo-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn db_path(&self) -> PathBuf {
            self.0.join("notes.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn note(id: &str, content: &str) -> Note {
        Note {
            id: id.to_string(),
            pages: vec![Page {
                title: String::new(),
                content: content.to_string(),
            }],
            current_page_index: 0,
            color: "white".to_string(),
            x: 10.0,
            y: 20.0,
            width: DEFAULT_NOTE_WIDTH,
            height: DEFAULT_NOTE_HEIGHT,
            is_pinned: false,
        }
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let temp = TempDir::new();
        let path = temp.db_path();
        atomic_write_file(&path, "one").unwrap();
        atomic_write_file(&path, "two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert!(!tmp_path(&path).exists());
    }

    #[test]
    fn corrupt_json_is_backed_up_and_recovered() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(&path, "{corrupted!!!").unwrap();

        let outcome = load_db_from_disk(&path);
        assert!(outcome.db.notes.is_empty());
        assert!(outcome.needs_save);
        let backup = outcome.backup_path.expect("backup path");
        assert_eq!(fs::read_to_string(backup).unwrap(), "{corrupted!!!");
        assert_eq!(fs::read_to_string(&path).unwrap(), "{corrupted!!!");
    }

    #[test]
    fn structurally_invalid_notes_are_skipped_and_backed_up() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(
            &path,
            r#"{"notes":[{"id":"ok","pages":[{"title":"T","content":"C"}]},{"id":"bad","pages":{}}]}"#,
        )
        .unwrap();

        let outcome = load_db_from_disk(&path);
        assert_eq!(outcome.db.notes.len(), 1);
        assert_eq!(outcome.skipped_notes, 1);
        assert!(outcome.backup_path.is_some());
    }

    #[test]
    fn legacy_string_pages_are_migrated() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(
            &path,
            r##"{"notes":[{"id":"legacy","pages":["# Hello\nworld"],"color":"pink"}]}"##,
        )
        .unwrap();

        let outcome = load_db_from_disk(&path);
        assert_eq!(outcome.db.notes.len(), 1);
        let migrated = &outcome.db.notes[0];
        assert_eq!(migrated.pages[0].title, "Hello");
        assert_eq!(migrated.pages[0].content, "# Hello\nworld");
        assert_eq!(migrated.color, "pink");
        assert!(outcome.needs_save);
    }

    #[test]
    fn missing_or_empty_database_gets_a_welcome_note() {
        let mut db = Db::default();
        assert!(migrate_db(&mut db, 100.0, 100.0));
        assert_eq!(db.notes.len(), 1);
        assert!(db.notes[0].pages[0].title.contains("欢迎使用"));
    }

    #[test]
    fn empty_notes_are_removed_and_welcome_is_added() {
        let mut db = Db {
            notes: vec![Note {
                pages: vec![Page {
                    title: "  ".to_string(),
                    content: "\n".to_string(),
                }],
                ..note("empty", "")
            }],
            ..Db::default()
        };
        assert!(migrate_db(&mut db, 50.0, 50.0));
        assert_eq!(db.notes.len(), 1);
        assert!(db.notes[0].pages[0].title.contains("欢迎使用"));
    }

    #[test]
    fn cleanup_promotes_tmp_when_main_is_missing() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(tmp_path(&path), r#"{"notes":[]}"#).unwrap();
        cleanup_stale_tmp(&path);
        assert!(path.exists());
        assert!(!tmp_path(&path).exists());
    }

    #[test]
    fn cleanup_removes_tmp_when_main_exists() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(&path, r#"{"notes":[]}"#).unwrap();
        fs::write(tmp_path(&path), "half-written").unwrap();
        cleanup_stale_tmp(&path);
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"notes":[]}"#);
        assert!(!tmp_path(&path).exists());
    }

    #[test]
    fn store_debounces_and_persists_note() {
        let temp = TempDir::new();
        let path = temp.db_path();
        let (store, _outcome) = Store::load(path.clone());
        store.add_note(note("debounced", "hello"));

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            if let Ok(raw) = fs::read_to_string(&path) {
                let db: Db = serde_json::from_str(&raw).unwrap();
                if db.notes.iter().any(|note| note.id == "debounced") {
                    break;
                }
            }
            assert!(
                std::time::Instant::now() < deadline,
                "debounced write did not reach disk"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn flush_now_is_a_noop_when_clean() {
        let temp = TempDir::new();
        let (store, _outcome) = Store::load(temp.db_path());
        assert!(!store.flush_now().unwrap());
    }

    #[test]
    fn update_note_clamps_page_index_with_on_disk_oracle() {
        let temp = TempDir::new();
        let (store, _outcome) = Store::load(temp.db_path());
        store.add_note(Note {
            pages: vec![
                Page {
                    title: "one".to_string(),
                    content: "a".to_string(),
                },
                Page {
                    title: "two".to_string(),
                    content: "b".to_string(),
                },
            ],
            ..note("multi", "")
        });

        let updated = store
            .update_note(
                "multi",
                &UpdateNoteFields {
                    current_page_index: Some(99),
                    ..UpdateNoteFields::default()
                },
            )
            .unwrap();

        assert_eq!(updated.current_page_index, 1);

        // On-disk oracle: the debounced write must land with the same values,
        // otherwise a dropped/failed write would still pass this test.
        store.flush_now().unwrap();
        let raw = fs::read_to_string(temp.db_path()).unwrap();
        let db: Db = serde_json::from_str(&raw).unwrap();
        let stored = db.notes.iter().find(|note| note.id == "multi").unwrap();
        assert_eq!(stored.current_page_index, 1);
        assert_eq!(stored.color, "white");
    }

    #[test]
    fn update_note_rejects_invalid_color_without_mutation() {
        let temp = TempDir::new();
        let (store, _outcome) = Store::load(temp.db_path());
        store.add_note(note("colored", "keep"));

        let rejected = store.update_note(
            "colored",
            &UpdateNoteFields {
                color: Some("not-a-color".to_string()),
                ..UpdateNoteFields::default()
            },
        );
        assert!(rejected.is_none());

        store.flush_now().unwrap();
        let raw = fs::read_to_string(temp.db_path()).unwrap();
        let db: Db = serde_json::from_str(&raw).unwrap();
        let stored = db.notes.iter().find(|note| note.id == "colored").unwrap();
        assert_eq!(stored.color, "white");
        assert_eq!(stored.pages[0].content, "keep");
    }

    #[test]
    fn unreadable_database_is_read_only_and_not_overwritten() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::create_dir(&path).unwrap();

        let outcome = load_db_from_disk(&path);
        assert!(!outcome.safe_to_write);
        assert!(outcome.read_error.is_some());
        assert!(path.is_dir(), "the unreadable path must stay untouched");

        let (store, outcome) = Store::load(path.clone());
        assert!(!outcome.safe_to_write);
        assert!(store.health().read_only);
        assert!(store.flush_now().is_err());
        assert!(!store.migrate(50.0, 50.0));
        assert!(store.all_notes().is_empty());
        assert!(path.is_dir(), "read-only mode must not replace the path");
    }

    #[test]
    fn flush_failure_keeps_dirty_and_retains_the_note() {
        let temp = TempDir::new();
        let blocker = temp.0.join("blocker");
        fs::write(&blocker, "not a directory").unwrap();
        let path = blocker.join("notes.json");

        let (store, outcome) = Store::load(path.clone());
        assert!(outcome.safe_to_write);
        store.add_note(note("keep", "hello"));

        let error = store.flush_now().expect_err("write must fail");
        assert!(!error.to_string().is_empty());
        assert!(store.get_note("keep").is_some());
        let health = store.health();
        assert!(health.dirty);
        assert!(health.last_error.is_some());
        assert!(!path.exists(), "failed write must not create the database");
    }

    #[test]
    fn reload_after_read_error_recovers_in_place() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::create_dir(&path).unwrap();

        let (store, outcome) = Store::load(path.clone());
        assert!(!outcome.safe_to_write);
        assert!(store.health().read_only);

        fs::remove_dir(&path).unwrap();
        fs::write(
            &path,
            r#"{"notes":[{"id":"recovered","pages":[{"title":"R","content":"x"}]}]}"#,
        )
        .unwrap();

        let outcome = store.reload_from_disk();
        assert!(outcome.safe_to_write);
        assert!(!store.health().read_only);
        assert!(store.get_note("recovered").is_some());
    }

    #[test]
    fn backoff_delays_are_bounded() {
        assert_eq!(backoff_delay(0), Duration::from_millis(250));
        assert_eq!(backoff_delay(1), Duration::from_millis(1000));
        assert_eq!(backoff_delay(2), Duration::from_millis(5000));
        assert_eq!(backoff_delay(3), Duration::from_millis(30000));
        assert_eq!(backoff_delay(99), Duration::from_millis(30000));
    }

    #[test]
    fn oversized_or_malformed_updates_are_rejected_without_mutation() {
        let temp = TempDir::new();
        let (store, _outcome) = Store::load(temp.db_path());
        store.add_note(note("guarded", "original"));

        let oversized = "x".repeat(MAX_PAGE_CONTENT_CHARS + 1);
        let rejected = store.update_note(
            "guarded",
            &UpdateNoteFields {
                pages: Some(vec![Page {
                    title: String::new(),
                    content: oversized,
                }]),
                ..UpdateNoteFields::default()
            },
        );
        assert!(rejected.is_none());

        let empty_pages = store.update_note(
            "guarded",
            &UpdateNoteFields {
                pages: Some(vec![]),
                ..UpdateNoteFields::default()
            },
        );
        assert!(empty_pages.is_none());

        let too_many = store.update_note(
            "guarded",
            &UpdateNoteFields {
                pages: Some(vec![
                    Page {
                        title: String::new(),
                        content: String::new(),
                    };
                    MAX_PAGES + 1
                ]),
                ..UpdateNoteFields::default()
            },
        );
        assert!(too_many.is_none());

        store.flush_now().unwrap();
        let raw = fs::read_to_string(temp.db_path()).unwrap();
        let db: Db = serde_json::from_str(&raw).unwrap();
        let stored = db.notes.iter().find(|note| note.id == "guarded").unwrap();
        assert_eq!(stored.pages.len(), 1);
        assert_eq!(stored.pages[0].content, "original");
    }

    #[test]
    fn extract_title_preserves_hyphens_and_strips_leading_markers() {
        // 与 tests/test-title-extract.js 共享的用例；JS/Rust 两侧必须一致。
        let shared: &[(&str, &str)] = &[
            ("hello\nworld", "hello"),
            ("# 欢迎使用", "欢迎使用"),
            ("## 二级标题", "二级标题"),
            ("12345678901234567890", "1234567890123456"),
            ("---", ""),
            ("***", ""),
            ("  hi  ", "hi"),
            ("2026-10-27 会议记录", "2026-10-27 会议记录"),
            ("co-op 项目", "co-op 项目"),
            ("***重要***", "重要"),
            ("- [ ] 买牛奶", "买牛奶"),
            ("- 项目", "项目"),
            ("`代码`", "代码"),
            ("A-B *C* 测试", "A-B *C* 测试"),
        ];
        for (input, expected) in shared {
            assert_eq!(
                &extract_title_from_text(input),
                expected,
                "input: {input:?}"
            );
        }
        assert_eq!(extract_title_from_text(""), "");
    }

    #[test]
    fn duplicate_note_ids_are_repaired_with_unique_ids_and_backup() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(
            &path,
            r#"{"notes":[
                {"id":"dup","pages":[{"title":"first","content":"A"}]},
                {"id":"dup","pages":[{"title":"second","content":"B"}]}
            ]}"#,
        )
        .unwrap();

        let outcome = load_db_from_disk(&path);
        assert_eq!(outcome.db.notes.len(), 2);
        assert_eq!(outcome.repaired_ids, 1);
        assert!(outcome.needs_save);
        assert_eq!(
            outcome.db.notes[0].id, "dup",
            "first occurrence keeps its id"
        );
        assert_ne!(
            outcome.db.notes[1].id, "dup",
            "later duplicate is regenerated"
        );
        let backup = outcome
            .backup_path
            .expect("original file must be backed up");
        assert!(backup.exists());

        // 磁盘 oracle：修复后的库写回时 id 唯一。
        let (store, _outcome) = Store::load(path.clone());
        store.flush_now().unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let db: Db = serde_json::from_str(&raw).unwrap();
        let ids: Vec<&str> = db.notes.iter().map(|note| note.id.as_str()).collect();
        assert_eq!(ids.len(), 2);
        assert_eq!(ids[0], "dup");
        assert_ne!(ids[0], ids[1]);
    }

    #[test]
    fn legacy_file_without_schema_version_is_upgraded_and_persisted() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(
            &path,
            r#"{"notes":[{"id":"legacy","pages":[{"title":"T","content":"C"}]}]}"#,
        )
        .unwrap();

        let outcome = load_db_from_disk(&path);
        assert!(outcome.safe_to_write);
        assert_eq!(
            outcome.db.schema_version, CURRENT_SCHEMA_VERSION,
            "upgraded in memory"
        );
        assert!(
            outcome.needs_save,
            "upgrade must be persisted on the next write"
        );

        let (store, _outcome) = Store::load(path.clone());
        store.flush_now().unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let db: Db = serde_json::from_str(&raw).unwrap();
        assert_eq!(db.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn current_schema_version_loads_without_repair() {
        let temp = TempDir::new();
        let path = temp.db_path();
        fs::write(
            &path,
            r#"{"schemaVersion":1,"notes":[{"id":"current","pages":[{"title":"T","content":"C"}],"currentPageIndex":0,"color":"white","x":10.0,"y":20.0,"width":300.0,"height":350.0,"isPinned":false}]}"#,
        )
        .unwrap();

        let outcome = load_db_from_disk(&path);
        assert!(outcome.safe_to_write);
        assert!(
            !outcome.needs_save,
            "clean current-version file must not need a rewrite"
        );
        assert_eq!(outcome.db.schema_version, 1);
        assert_eq!(outcome.db.notes.len(), 1);
    }

    #[test]
    fn future_schema_version_is_refused_without_overwrite() {
        let temp = TempDir::new();
        let path = temp.db_path();
        let original = r#"{"schemaVersion":99,"notes":[{"id":"future","pages":[{"title":"T","content":"C"}]}]}"#;
        fs::write(&path, original).unwrap();

        let outcome = load_db_from_disk(&path);
        assert!(!outcome.safe_to_write, "future version must be read-only");
        assert!(
            outcome.read_error.is_some(),
            "a compatibility error must be reported"
        );
        assert!(
            outcome.db.notes.is_empty(),
            "newer data must not be loaded or mutated"
        );
        assert!(outcome.backup_path.is_some());

        let (store, _outcome) = Store::load(path.clone());
        assert!(store.health().read_only);
        assert!(store.flush_now().is_err(), "must refuse to write");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            original,
            "the future-version file must stay untouched"
        );
    }

    #[test]
    fn backup_pruning_keeps_newest_and_skips_unrelated_files() {
        let temp = TempDir::new();
        let path = temp.db_path();
        assert_eq!(MAX_BACKUPS, 10);

        // 12 份等长时间戳命名的备份（1000..1011，升序 = 从旧到新）。
        for stem in 1000..1012 {
            fs::write(
                temp.0.join(format!("notes.json.corrupt-{stem}.bak")),
                format!("backup {stem}"),
            )
            .unwrap();
        }
        // 非本应用时间戳命名 / 不同基名 / 普通备份：一律不得删除。
        fs::write(temp.0.join("notes.json.corrupt-latest.bak"), "manual").unwrap();
        fs::write(temp.0.join("other.json.corrupt-1005.bak"), "other").unwrap();
        fs::write(temp.0.join("notes.json.bak"), "plain").unwrap();

        prune_backups(&path, MAX_BACKUPS);

        for stem in 1002..1012 {
            assert!(
                temp.0
                    .join(format!("notes.json.corrupt-{stem}.bak"))
                    .exists(),
                "backup {stem} (newest {MAX_BACKUPS}) must survive"
            );
        }
        assert!(!temp.0.join("notes.json.corrupt-1000.bak").exists());
        assert!(!temp.0.join("notes.json.corrupt-1001.bak").exists());
        assert!(temp.0.join("notes.json.corrupt-latest.bak").exists());
        assert!(temp.0.join("other.json.corrupt-1005.bak").exists());
        assert!(temp.0.join("notes.json.bak").exists());
    }

    #[test]
    fn poisoned_lock_is_recovered_and_store_stays_usable() {
        let temp = TempDir::new();
        let path = temp.db_path();
        let (store, _outcome) = Store::load(path.clone());
        store.add_note(note("before", "v1"));

        let inner = Arc::clone(&store.inner);
        let panic_result = std::thread::spawn(move || {
            let _guard = inner.lock().unwrap();
            panic!("deliberate panic while holding the store lock");
        })
        .join();
        assert!(panic_result.is_err(), "the panic must poison the lock");

        // 读写路径不得 panic（lock_inner 恢复），数据照常落盘。
        let health = store.health();
        assert!(health.dirty);
        let updated = store.update_note(
            "before",
            &UpdateNoteFields {
                pages: Some(vec![Page {
                    title: String::new(),
                    content: "v2".to_string(),
                }]),
                ..UpdateNoteFields::default()
            },
        );
        assert!(updated.is_some());
        store.flush_now().unwrap();

        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("v2"), "recovered store must still persist");
    }

    #[test]
    fn closed_worker_channel_degrades_and_writes_directly() {
        let temp = TempDir::new();
        let path = temp.db_path();
        let (tx, rx) = mpsc::channel::<u64>();
        drop(rx); // 模拟 worker 线程死亡 / 通道关闭

        let store = Store {
            path: path.clone(),
            inner: Arc::new(Mutex::new(Inner {
                db: Db::default(),
                dirty: false,
                generation: 0,
                read_only: false,
                degraded: false,
                last_success: None,
                last_error: None,
                retry_count: 0,
            })),
            tx,
            health_tx: None,
        };

        store.add_note(note("direct", "fallback"));

        let health = store.health();
        assert!(health.degraded, "worker loss must surface as degraded");
        assert!(
            !health.dirty,
            "the direct fallback flush must have completed"
        );

        // 磁盘 oracle：直写必须真的落盘。
        let raw = fs::read_to_string(&path).unwrap();
        let db: Db = serde_json::from_str(&raw).unwrap();
        assert!(db.notes.iter().any(|note| note.id == "direct"));
        assert_eq!(db.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn documented_notes_json_examples_load_as_described() {
        let temp = TempDir::new();
        let path = temp.db_path();

        // README「数据格式」旧版示例（无 schemaVersion）。
        let legacy = r##"{
  "notes": [
    { "id": "note-old", "pages": ["# 旧版便签\n正文内容"] }
  ]
}"##;
        fs::write(&path, legacy).unwrap();
        let outcome = load_db_from_disk(&path);
        assert!(outcome.safe_to_write);
        assert!(outcome.needs_save, "legacy example must be upgraded");
        assert_eq!(outcome.db.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(outcome.db.notes[0].pages[0].title, "旧版便签");
        assert_eq!(outcome.db.notes[0].pages[0].content, "# 旧版便签\n正文内容");

        // README「数据格式」新版示例（schemaVersion: 1）。
        let current = r#"{
  "schemaVersion": 1,
  "notes": [
    {
      "id": "note-new",
      "pages": [{ "title": "标题", "content": "- [ ] 任务" }],
      "currentPageIndex": 0,
      "color": "yellow",
      "x": 120.0,
      "y": 90.0,
      "width": 300.0,
      "height": 350.0,
      "isPinned": false
    }
  ]
}"#;
        fs::write(&path, current).unwrap();
        let outcome = load_db_from_disk(&path);
        assert!(outcome.safe_to_write);
        assert!(
            !outcome.needs_save,
            "current example must load without rewrite"
        );
        assert_eq!(outcome.db.notes[0].pages[0].title, "标题");
    }
}
