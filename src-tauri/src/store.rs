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
pub struct Db {
    pub notes: Vec<Note>,
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
    pub backup_path: Option<PathBuf>,
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

pub fn extract_title_from_text(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    text.trim()
        .split('\n')
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| !matches!(c, '#' | '*' | '`' | '_' | '-'))
        .collect::<String>()
        .trim()
        .chars()
        .take(16)
        .collect()
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
    Ok(backup)
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
            backup_path: None,
        };
    }

    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) => {
            eprintln!("Error reading notes database: {error}");
            return LoadOutcome {
                db: Db::default(),
                needs_save: false,
                skipped_notes: 0,
                backup_path: None,
            };
        }
    };

    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            let backup_path = backup_corrupted_file(path).ok();
            eprintln!("notes.json corrupted, backed up to {backup_path:?}: {error}");
            return LoadOutcome {
                db: Db::default(),
                needs_save: true,
                skipped_notes: 0,
                backup_path,
            };
        }
    };

    let Some(notes_value) = parsed.get("notes").and_then(|notes| notes.as_array()) else {
        let backup_path = backup_corrupted_file(path).ok();
        eprintln!("notes.json has invalid structure, backed up to {backup_path:?}");
        return LoadOutcome {
            db: Db::default(),
            needs_save: true,
            skipped_notes: 0,
            backup_path,
        };
    };

    let mut db = Db::default();
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

    let backup_path = if skipped_notes > 0 {
        let backup = backup_corrupted_file(path).ok();
        eprintln!("notes.json had {skipped_notes} invalid note(s), backed up to {backup:?}");
        backup
    } else {
        None
    };

    LoadOutcome {
        db,
        needs_save,
        skipped_notes,
        backup_path,
    }
}

struct Inner {
    db: Db,
    dirty: bool,
    generation: u64,
}

pub struct Store {
    path: PathBuf,
    inner: Arc<Mutex<Inner>>,
    tx: mpsc::Sender<u64>,
}

impl Store {
    pub fn load(path: PathBuf) -> (Self, LoadOutcome) {
        let outcome = load_db_from_disk(&path);
        let inner = Arc::new(Mutex::new(Inner {
            db: outcome.db.clone(),
            dirty: outcome.needs_save,
            generation: 0,
        }));

        let (tx, rx) = mpsc::channel::<u64>();
        let worker_inner = Arc::clone(&inner);
        let worker_path = path.clone();

        thread::Builder::new()
            .name("miao-memo-store".to_string())
            .spawn(move || {
                while let Ok(mut generation) = rx.recv() {
                    thread::sleep(Duration::from_millis(FLUSH_DELAY_MS));

                    // Coalesce all requests that arrived during the delay.
                    while let Ok(newer) = rx.try_recv() {
                        generation = newer;
                    }

                    let mut guard = worker_inner.lock().unwrap();
                    if guard.generation != generation || !guard.dirty {
                        continue;
                    }

                    match write_db(&worker_path, &guard.db) {
                        Ok(()) => {
                            guard.dirty = false;
                        }
                        Err(error) => {
                            eprintln!("Error writing notes database: {error}");
                            // Keep dirty and retry once after a short delay.
                            drop(guard);
                            thread::sleep(Duration::from_millis(500));
                            let mut guard = worker_inner.lock().unwrap();
                            if guard.generation == generation && guard.dirty {
                                match write_db(&worker_path, &guard.db) {
                                    Ok(()) => guard.dirty = false,
                                    Err(error) => {
                                        eprintln!("Retry writing notes database failed: {error}")
                                    }
                                }
                            }
                        }
                    }
                }
            })
            .expect("failed to spawn notes store worker");

        (
            Self { path, inner, tx },
            LoadOutcome {
                db: outcome.db,
                needs_save: outcome.needs_save,
                skipped_notes: outcome.skipped_notes,
                backup_path: outcome.backup_path,
            },
        )
    }

    pub fn schedule(&self) {
        let generation = {
            let mut guard = self.inner.lock().unwrap();
            guard.dirty = true;
            guard.generation += 1;
            guard.generation
        };
        let _ = self.tx.send(generation);
    }

    pub fn flush_now(&self) -> io::Result<bool> {
        let mut guard = self.inner.lock().unwrap();
        if !guard.dirty {
            return Ok(false);
        }
        write_db(&self.path, &guard.db)?;
        guard.dirty = false;
        Ok(true)
    }

    pub fn get_note(&self, id: &str) -> Option<Note> {
        let guard = self.inner.lock().unwrap();
        guard.db.notes.iter().find(|note| note.id == id).cloned()
    }

    pub fn all_notes(&self) -> Vec<Note> {
        let guard = self.inner.lock().unwrap();
        guard.db.notes.clone()
    }

    pub fn first_note(&self) -> Option<Note> {
        let guard = self.inner.lock().unwrap();
        guard.db.notes.first().cloned()
    }

    pub fn add_note(&self, note: Note) {
        let generation = {
            let mut guard = self.inner.lock().unwrap();
            guard.db.notes.push(note);
            guard.dirty = true;
            guard.generation += 1;
            guard.generation
        };
        let _ = self.tx.send(generation);
    }

    pub fn remove_note(&self, id: &str) -> bool {
        let generation = {
            let mut guard = self.inner.lock().unwrap();
            let before = guard.db.notes.len();
            guard.db.notes.retain(|note| note.id != id);
            if guard.db.notes.len() == before {
                return false;
            }
            guard.dirty = true;
            guard.generation += 1;
            guard.generation
        };
        let _ = self.tx.send(generation);
        true
    }

    pub fn remove_if_empty(&self, id: &str) -> bool {
        let mut guard = self.inner.lock().unwrap();
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
        let _ = self.tx.send(generation);
        true
    }

    pub fn update_note(&self, id: &str, fields: &UpdateNoteFields) -> Option<Note> {
        let (snapshot, generation) = {
            let mut guard = self.inner.lock().unwrap();
            let note = guard.db.notes.iter_mut().find(|note| note.id == id)?;

            if let Some(pages) = &fields.pages {
                if !pages.is_empty() {
                    note.pages = pages.clone();
                }
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

        let _ = self.tx.send(generation);
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
        let mut guard = self.inner.lock().unwrap();
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
        let _ = self.tx.send(generation);
        true
    }

    pub fn migrate(&self, x: f64, y: f64) -> bool {
        let generation = {
            let mut guard = self.inner.lock().unwrap();
            if !migrate_db(&mut guard.db, x, y) {
                return false;
            }
            guard.dirty = true;
            guard.generation += 1;
            guard.generation
        };
        let _ = self.tx.send(generation);
        true
    }
}

fn write_db(path: &Path, db: &Db) -> io::Result<()> {
    let content = serde_json::to_string_pretty(db).map_err(io::Error::other)?;
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
    fn update_note_clamps_page_index_and_validates_color() {
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
                    color: Some("not-a-color".to_string()),
                    ..UpdateNoteFields::default()
                },
            )
            .unwrap();

        assert_eq!(updated.current_page_index, 1);
        assert_eq!(updated.color, "white");
    }
}
