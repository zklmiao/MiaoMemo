#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod flush;
mod store;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    time::Duration,
};

use flush::FlushCoordinator;
use log::{error, info, warn};
use store::{
    create_default_note, make_note_id, Note, Store, StoreHealth, UpdateNoteFields,
    DEFAULT_NOTE_HEIGHT, DEFAULT_NOTE_WIDTH,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_log::{Target, TargetKind};

const CLOSE_FLUSH_TIMEOUT_MS: u64 = 1500;
const QUIT_FLUSH_TIMEOUT_MS: u64 = 2500;
const CASCADE_STEP: f64 = 30.0;
const CASCADE_SLOTS: u64 = 8;

struct AppState {
    store: Store,
    quitting: AtomicBool,
    quit_requested: AtomicBool,
    cascade_slot: AtomicU64,
    flush: FlushCoordinator,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LogicalRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Only the app's own frontend may load in a note webview. Production uses
/// `tauri://localhost`; development uses `http://tauri.localhost`.
fn is_local_origin(url: &tauri::Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

fn monitor_work_area(monitor: &tauri::Monitor) -> LogicalRect {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let position = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    LogicalRect {
        x: position.x,
        y: position.y,
        w: size.width,
        h: size.height,
    }
}

/// Clamps a desired window rectangle into a work area. Returns None when the
/// rectangles do not intersect at all (caller should pick another display).
fn clamp_position_into_work_area(desired: &LogicalRect, work: &LogicalRect) -> Option<(f64, f64)> {
    let overlap_left = desired.x.max(work.x);
    let overlap_top = desired.y.max(work.y);
    let overlap_right = (desired.x + desired.w).min(work.x + work.w);
    let overlap_bottom = (desired.y + desired.h).min(work.y + work.h);
    if overlap_right <= overlap_left || overlap_bottom <= overlap_top {
        return None;
    }

    let w = desired.w.min(work.w);
    let h = desired.h.min(work.h);
    let max_x = (work.x + work.w - w).max(work.x);
    let max_y = (work.y + work.h - h).max(work.y);
    Some((
        desired.x.clamp(work.x, max_x),
        desired.y.clamp(work.y, max_y),
    ))
}

fn cascade_base(work: &LogicalRect, slot: u64) -> (f64, f64) {
    let offset = (slot % CASCADE_SLOTS) as f64 * CASCADE_STEP;
    let desired = LogicalRect {
        x: work.x + ((work.w - DEFAULT_NOTE_WIDTH) / 2.0).floor() + offset + 150.0,
        y: work.y + ((work.h - DEFAULT_NOTE_HEIGHT) / 2.0).floor() - 100.0 + offset,
        w: DEFAULT_NOTE_WIDTH,
        h: DEFAULT_NOTE_HEIGHT,
    };
    clamp_position_into_work_area(&desired, work).unwrap_or((work.x + 50.0, work.y + 50.0))
}

/// Restored bounds are clamped into a connected monitor work area; a window
/// that sits entirely off-screen is moved back to the primary display.
fn clamp_note_position(app: &AppHandle, note: &Note) -> (f64, f64) {
    let desired = LogicalRect {
        x: note.x,
        y: note.y,
        w: note.width.max(1.0),
        h: note.height.max(1.0),
    };

    let monitors = app.available_monitors().unwrap_or_default();
    for monitor in &monitors {
        let work = monitor_work_area(monitor);
        if let Some(position) = clamp_position_into_work_area(&desired, &work) {
            return position;
        }
    }

    if let Ok(Some(primary)) = app.primary_monitor() {
        let work = monitor_work_area(&primary);
        let fallback = LogicalRect {
            x: work.x + 50.0,
            y: work.y + 50.0,
            w: desired.w,
            h: desired.h,
        };
        if let Some(position) = clamp_position_into_work_area(&fallback, &work) {
            return position;
        }
        return (work.x, work.y);
    }

    (note.x.max(50.0), note.y.max(50.0))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Err(error) = show_all_notes(app) {
                error!("Failed to show notes from second instance: {error}");
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("miao-memo".to_string()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_note_data,
            update_note,
            create_note,
            delete_note,
            close_window,
            quit_app,
            flush_ack_close,
            flush_ack_quit,
            get_store_status,
            retry_save
        ])
        .setup(|app| {
            let data_dir = resolve_data_dir(app.handle())?;
            fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("notes.json");
            info!("Starting MiaoMemo; data_dir={}", data_dir.display());

            store::cleanup_stale_tmp(&db_path);
            import_legacy_electron_data(app.handle(), &db_path);

            let (health_tx, health_rx) = mpsc::channel::<StoreHealth>();
            let app_for_health = app.handle().clone();
            std::thread::spawn(move || {
                while let Ok(health) = health_rx.recv() {
                    if let Err(error) = app_for_health.emit("miao-store-health", health) {
                        error!("Failed to emit store health event: {error}");
                    }
                }
            });

            let outcome = store::load_db_from_disk(&db_path);
            let safe_to_write = outcome.safe_to_write;
            if let Some(read_error) = &outcome.read_error {
                error!(
                    "Cannot read notes database at {}: {read_error}",
                    db_path.display()
                );
            }

            let dialog_path = db_path.clone();
            let (store, outcome) = Store::from_outcome(db_path, outcome, Some(health_tx));
            if let Some(backup) = &outcome.backup_path {
                warn!(
                    "Recovered notes database; original backed up to {}",
                    backup.display()
                );
            }
            if outcome.repaired_ids > 0 {
                warn!(
                    "Repaired {} duplicate note id(s) on load",
                    outcome.repaired_ids
                );
            }

            app.manage(AppState {
                store,
                quitting: AtomicBool::new(false),
                quit_requested: AtomicBool::new(false),
                cascade_slot: AtomicU64::new(0),
                flush: FlushCoordinator::new(),
            });

            setup_tray(app.handle())?;

            if !safe_to_write {
                // Setup runs before the event loop. Start the retry loop on a
                // worker thread so blocking_show() is allowed and the Tauri
                // event loop can pump the native dialog.
                show_read_error_dialog(app.handle(), dialog_path);
                return Ok(());
            }

            let (x, y) = cascade_position(app.handle());
            let migrated = app.state::<AppState>().store.migrate(x, y);

            if migrated || outcome.needs_save {
                if let Err(error) = app.state::<AppState>().store.flush_now() {
                    error!("Failed to persist initial notes database: {error}");
                }
            }

            // 启动时恢复所有便签窗口（与旧 Electron 行为一致；重复 id 修复后
            // 每条便签都是独立窗口）。
            for note in app.state::<AppState>().store.all_notes() {
                spawn_create_note_window(app.handle().clone(), note);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building MiaoMemo")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                let state = app_handle.state::<AppState>();
                if state.quitting.load(Ordering::SeqCst) {
                    if let Err(error) = state.store.flush_now() {
                        error!("Failed to flush notes on exit: {error}");
                    }
                } else {
                    // Closing the last note leaves MiaoMemo running in the tray.
                    api.prevent_exit();
                }
            }
            RunEvent::Exit => {
                let state = app_handle.state::<AppState>();
                if let Err(error) = state.store.flush_now() {
                    error!("Failed to flush notes on final exit: {error}");
                }
            }
            _ => {}
        });
}

fn resolve_data_dir(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(custom) = std::env::var("MIAOMEMO_DATA_DIR") {
        let custom = custom.trim().trim_matches('"');
        if !custom.is_empty() {
            return Ok(PathBuf::from(custom));
        }
    }

    for arg in std::env::args() {
        if let Some(custom) = arg.strip_prefix("--user-data-dir=") {
            let custom = custom.trim().trim_matches('"');
            if !custom.is_empty() {
                return Ok(PathBuf::from(custom));
            }
        }
    }

    Ok(app.path().app_data_dir()?)
}

/// Electron stored notes under `%APPDATA%\MiaoMemo` (or `miao-memo`).
/// Copy that database once so upgrading users keep their notes.
fn import_legacy_electron_data(app: &AppHandle, target: &Path) {
    if target.exists() {
        return;
    }

    let Ok(data_dir) = app.path().data_dir() else {
        return;
    };

    for legacy_dir in ["MiaoMemo", "miao-memo"] {
        let candidate = data_dir.join(legacy_dir).join("notes.json");
        if !candidate.exists() {
            continue;
        }
        match fs::copy(&candidate, target) {
            Ok(_) => {
                info!(
                    "Imported legacy Electron notes from {}",
                    candidate.display()
                );
            }
            Err(error) => {
                warn!(
                    "Failed to import legacy notes from {}: {error}",
                    candidate.display()
                );
            }
        }
        break;
    }
}

/// Non-blocking startup error loop. The native dialog is shown with
/// `blocking_show()` on a worker thread (the documented safe context); a
/// successful retry reloads the same Store and resumes migration/window
/// creation. Cancelling exits without touching the unreadable file.
fn show_read_error_dialog(app: &AppHandle, db_path: PathBuf) {
    let app = app.clone();
    std::thread::spawn(move || {
        // Let the Tauri event loop start before opening the native dialog.
        std::thread::sleep(Duration::from_millis(200));

        loop {
            let message = app
                .state::<AppState>()
                .store
                .health()
                .last_error
                .unwrap_or_else(|| "无法读取便签数据库".to_string());

            let retry = app
                .dialog()
                .message(format!(
                    "无法读取便签数据库：\n{}\n\n{}\n\n原始文件不会被覆盖。请修复文件权限或关闭占用后重试。",
                    db_path.display(),
                    message
                ))
                .title("MiaoMemo - 数据库不可读")
                .kind(MessageDialogKind::Error)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "重试".to_string(),
                    "退出".to_string(),
                ))
                .blocking_show();

            if !retry {
                error!("Exiting because the notes database is unreadable");
                let state = app.state::<AppState>();
                state.quitting.store(true, Ordering::SeqCst);
                app.exit(1);
                return;
            }

            let state = app.state::<AppState>();
            let outcome = state.store.reload_from_disk();
            if !outcome.safe_to_write {
                error!(
                    "Retry could not read notes database at {}",
                    db_path.display()
                );
                continue;
            }

            info!("Notes database reloaded after retry");
            if let Some(backup) = &outcome.backup_path {
                warn!(
                    "Recovered notes database; original backed up to {}",
                    backup.display()
                );
            }

            let (x, y) = cascade_position(&app);
            let migrated = state.store.migrate(x, y);
            if migrated || outcome.needs_save {
                if let Err(error) = state.store.flush_now() {
                    error!("Failed to persist notes after reload: {error}");
                }
            }
            for note in state.store.all_notes() {
                spawn_create_note_window(app.clone(), note);
            }
            return;
        }
    });
}

fn cascade_position(app: &AppHandle) -> (f64, f64) {
    let slot = app
        .state::<AppState>()
        .cascade_slot
        .fetch_add(1, Ordering::SeqCst);
    let work = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor_work_area(&monitor))
        .unwrap_or(LogicalRect {
            x: 0.0,
            y: 0.0,
            w: 1920.0,
            h: 1040.0,
        });
    cascade_base(&work, slot)
}

fn create_note_window(app: &AppHandle, note: &Note) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(&note.id) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let (clamped_x, clamped_y) = clamp_note_position(app, note);
    let window = WebviewWindowBuilder::new(app, &note.id, WebviewUrl::App("index.html".into()))
        .title("MiaoMemo")
        .inner_size(note.width, note.height)
        .position(clamped_x, clamped_y)
        .min_inner_size(220.0, 180.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(note.is_pinned)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .on_navigation(|url| is_local_origin(&url))
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Deny)
        .build()?;

    let app_handle = app.clone();
    let label = note.id.clone();
    window.on_window_event(move |event| {
        let state = app_handle.state::<AppState>();

        match event {
            WindowEvent::Moved(position) => {
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let position = position.to_logical::<f64>(scale);
                    if state.store.update_geometry(
                        &label,
                        Some(position.x),
                        Some(position.y),
                        None,
                        None,
                    ) {
                        state.store.schedule();
                    }
                }
            }
            WindowEvent::Resized(size) => {
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let size = size.to_logical::<f64>(scale);
                    if state.store.update_geometry(
                        &label,
                        None,
                        None,
                        Some(size.width),
                        Some(size.height),
                    ) {
                        state.store.schedule();
                    }
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                if state.flush.take_force_close(&label) {
                    return;
                }
                if state.quitting.load(Ordering::SeqCst) {
                    return;
                }

                let Some(request_id) = state.flush.begin_close(&label) else {
                    api.prevent_close();
                    return;
                };
                api.prevent_close();

                if let Err(error) =
                    app_handle.emit_to(label.as_str(), "miao-flush-before-close", request_id)
                {
                    error!("Failed to request close flush for {label}: {error}");
                    state.flush.timeout_close(&label, request_id);
                    state.flush.complete_quit_for_label(&label);
                    state.flush.mark_force_close(&label);
                    spawn_close_window(app_handle.clone(), label.clone());
                    return;
                }

                let app_for_timeout = app_handle.clone();
                let label_for_timeout = label.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(CLOSE_FLUSH_TIMEOUT_MS));
                    let state = app_for_timeout.state::<AppState>();
                    if state.flush.timeout_close(&label_for_timeout, request_id) {
                        warn!(
                            "Close flush timed out for note {label_for_timeout}; keeping the note"
                        );
                        state.flush.complete_quit_for_label(&label_for_timeout);
                        if let Err(error) = state.store.flush_now() {
                            error!("Failed to flush notes after close timeout: {error}");
                        }
                        state.flush.mark_force_close(&label_for_timeout);
                        if let Some(window) = app_for_timeout.get_webview_window(&label_for_timeout)
                        {
                            let _ = window.close();
                        }
                    }
                });
            }
            _ => {}
        }
    });

    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn create_new_note(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    if state.store.health().read_only {
        warn!("Ignoring create-note request: notes database is read-only");
        return Ok(());
    }
    let (x, y) = cascade_position(app);
    let note = create_default_note(make_note_id(), x, y);
    state.store.add_note(note.clone());
    if let Err(error) = state.store.flush_now() {
        error!("Failed to persist new note: {error}");
    }
    spawn_create_note_window(app.clone(), note);
    Ok(())
}

fn show_all_notes(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    if state.store.health().read_only {
        warn!("Ignoring show-all request: notes database is read-only");
        return Ok(());
    }
    let notes = state.store.all_notes();
    if notes.is_empty() {
        return create_new_note(app);
    }

    for note in notes {
        spawn_create_note_window(app.clone(), note);
    }
    Ok(())
}

/// Window operations must not run synchronously on the main thread while a
/// command is being handled: the runtime dispatches creation/closing to the
/// event loop and waiting there deadlocks it. Spawn a worker so commands return
/// immediately and the event loop can finish creating the window.
fn spawn_create_note_window(app: AppHandle, note: Note) {
    std::thread::spawn(move || {
        if let Err(error) = create_note_window(&app, &note) {
            error!("Failed to create note window {}: {error}", note.id);
        }
    });
}

fn spawn_close_window(app: AppHandle, note_id: String) {
    std::thread::spawn(move || {
        if let Some(window) = app.get_webview_window(&note_id) {
            if let Err(error) = window.close() {
                error!("Failed to close note window {note_id}: {error}");
            }
        }
    });
}

fn spawn_set_always_on_top(app: AppHandle, note_id: String, is_pinned: bool) {
    std::thread::spawn(move || {
        if let Some(window) = app.get_webview_window(&note_id) {
            let _ = window.set_always_on_top(is_pinned);
        }
    });
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let new_note = MenuItem::with_id(app, "new_note", "新建便签 (+)", true, None::<&str>)?;
    let show_all = MenuItem::with_id(app, "show_all", "显示所有便签", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 MiaoMemo", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&new_note, &show_all, &separator, &quit])?;
    let icon = match app.default_window_icon().cloned() {
        Some(icon) => icon,
        None => tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?,
    };

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("MiaoMemo 亚克力便签")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "new_note" => {
                if let Err(error) = create_new_note(app) {
                    error!("Failed to create note from tray: {error}");
                }
            }
            "show_all" => {
                if let Err(error) = show_all_notes(app) {
                    error!("Failed to show notes from tray: {error}");
                }
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                if let Err(error) = create_new_note(tray.app_handle()) {
                    error!("Failed to create note from tray double-click: {error}");
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Ask every open note to flush, then exit. The quit can be cancelled when a
/// window times out or the final disk flush fails.
fn request_quit(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        if state.quit_requested.swap(true, Ordering::SeqCst) {
            return;
        }

        let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
        let request_id = state.flush.begin_quit(labels.clone());
        for label in &labels {
            if let Err(error) = app.emit_to(label.as_str(), "miao-flush-before-quit", request_id) {
                error!("Failed to request quit flush for {label}: {error}");
            }
        }

        let timed_out = state
            .flush
            .wait_for_quit(request_id, Duration::from_millis(QUIT_FLUSH_TIMEOUT_MS));
        let flush_result = state.store.flush_now();

        if timed_out || flush_result.is_err() {
            let detail = if timed_out {
                "部分便签未确认保存。"
            } else {
                "最终写入磁盘失败。"
            };
            let proceed = app
                .dialog()
                .message(format!("{detail}\n\n是否仍然退出？未保存的内容可能丢失。"))
                .title("MiaoMemo - 退出确认")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "仍然退出".to_string(),
                    "取消".to_string(),
                ))
                .blocking_show();

            if !proceed {
                state.flush.cancel_quit();
                state.quit_requested.store(false, Ordering::SeqCst);
                info!("User cancelled quit after a flush failure/timeout");
                return;
            }
        }

        state.quitting.store(true, Ordering::SeqCst);
        app.exit(0);
    });
}

/// Rejects note commands whose target note id does not match the calling
/// note window's label.
fn ensure_caller_window(window: &WebviewWindow, note_id: &str) -> Result<(), String> {
    if window.label() == note_id {
        Ok(())
    } else {
        warn!(
            "Rejected note command for {note_id} from window {}",
            window.label()
        );
        Err("note id does not match the calling window".to_string())
    }
}

#[tauri::command]
fn get_note_data(
    window: WebviewWindow,
    note_id: String,
    state: State<'_, AppState>,
) -> Result<Option<Note>, String> {
    ensure_caller_window(&window, &note_id)?;
    Ok(state.store.get_note(&note_id))
}

#[tauri::command]
fn update_note(
    window: WebviewWindow,
    app: AppHandle,
    note_id: String,
    fields: UpdateNoteFields,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    ensure_caller_window(&window, &note_id)?;
    if state.store.health().read_only {
        return Ok(false);
    }
    if state.store.update_note(&note_id, &fields).is_none() {
        return Ok(false);
    }

    // Only touch the native window when pin state actually changed; otherwise
    // every keystroke would spawn an unnecessary worker thread.
    if let Some(is_pinned) = fields.is_pinned {
        spawn_set_always_on_top(app, note_id, is_pinned);
    }

    Ok(true)
}

#[tauri::command]
fn create_note(app: AppHandle, state: State<'_, AppState>) -> Result<Note, String> {
    if state.store.health().read_only {
        return Err("notes database is read-only".to_string());
    }
    let (x, y) = cascade_position(&app);
    let note = create_default_note(make_note_id(), x, y);
    state.store.add_note(note.clone());
    if let Err(error) = state.store.flush_now() {
        error!("Failed to persist new note: {error}");
    }
    spawn_create_note_window(app, note.clone());
    Ok(note)
}

#[tauri::command]
fn delete_note(
    window: WebviewWindow,
    app: AppHandle,
    note_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    ensure_caller_window(&window, &note_id)?;
    let removed = state.store.remove_note(&note_id);
    if let Err(error) = state.store.flush_now() {
        error!("Failed to persist note deletion: {error}");
    }
    state.flush.mark_force_close(&note_id);
    spawn_close_window(app, note_id);
    Ok(removed)
}

#[tauri::command]
fn close_window(app: AppHandle, note_id: String, state: State<'_, AppState>) -> bool {
    // The custom close button already awaited the renderer flush. Destroying
    // the window after this point must not start a second handshake.
    state.store.remove_if_empty(&note_id);
    if let Err(error) = state.store.flush_now() {
        error!("Failed to persist note close: {error}");
    }
    state.flush.mark_force_close(&note_id);
    spawn_close_window(app, note_id);
    true
}

#[tauri::command]
fn quit_app(app: AppHandle, _state: State<'_, AppState>) {
    request_quit(&app);
}

#[tauri::command]
fn flush_ack_close(
    app: AppHandle,
    window: WebviewWindow,
    request_id: u64,
    state: State<'_, AppState>,
) -> bool {
    let label = window.label().to_string();
    if !state.flush.complete_close(&label, request_id) {
        return false;
    }

    // A close acknowledgment also satisfies a pending quit request for this
    // window; otherwise quitting would wait for a window that is already gone.
    state.flush.complete_quit_for_label(&label);
    state.store.remove_if_empty(&label);
    if let Err(error) = state.store.flush_now() {
        error!("Failed to persist note close for {label}: {error}");
    }
    state.flush.mark_force_close(&label);
    spawn_close_window(app, label);
    true
}

#[tauri::command]
fn flush_ack_quit(window: WebviewWindow, request_id: u64, state: State<'_, AppState>) -> bool {
    state.flush.complete_quit(window.label(), request_id)
}

#[tauri::command]
fn get_store_status(state: State<'_, AppState>) -> StoreHealth {
    state.store.health()
}

#[tauri::command]
fn retry_save(state: State<'_, AppState>) -> Result<StoreHealth, String> {
    state.store.flush_now().map_err(|error| error.to_string())?;
    Ok(state.store.health())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> LogicalRect {
        LogicalRect { x, y, w, h }
    }

    #[test]
    fn rapid_cascade_slots_produce_distinct_positions() {
        let work = rect(0.0, 0.0, 1920.0, 1040.0);
        let first = cascade_base(&work, 0);
        let second = cascade_base(&work, 1);
        assert!(
            (first.0 - second.0).abs() >= CASCADE_STEP
                || (first.1 - second.1).abs() >= CASCADE_STEP,
            "consecutive cascade slots must differ by at least one step: {first:?} vs {second:?}"
        );
    }

    #[test]
    fn clamp_keeps_an_on_screen_rect_untouched() {
        let work = rect(0.0, 0.0, 1920.0, 1040.0);
        let desired = rect(120.0, 90.0, 300.0, 350.0);
        assert_eq!(
            clamp_position_into_work_area(&desired, &work),
            Some((120.0, 90.0))
        );
    }

    #[test]
    fn clamp_returns_none_for_a_fully_off_screen_rect() {
        let work = rect(0.0, 0.0, 1920.0, 1040.0);
        let desired = rect(5000.0, 5000.0, 300.0, 350.0);
        assert_eq!(clamp_position_into_work_area(&desired, &work), None);
    }

    #[test]
    fn clamp_pulls_a_taskbar_overlapping_rect_into_the_work_area() {
        // 40px taskbar at the bottom of a 1920x800 display.
        let work = rect(0.0, 0.0, 1920.0, 760.0);
        let desired = rect(100.0, 600.0, 300.0, 350.0);
        let clamped = clamp_position_into_work_area(&desired, &work);
        assert_eq!(clamped, Some((100.0, 760.0 - 350.0)));
    }

    #[test]
    fn clamp_handles_a_window_larger_than_the_work_area() {
        let work = rect(0.0, 0.0, 500.0, 400.0);
        let desired = rect(-50.0, -50.0, 900.0, 900.0);
        assert_eq!(
            clamp_position_into_work_area(&desired, &work),
            Some((0.0, 0.0))
        );
    }

    #[test]
    fn local_origin_predicate_allows_only_the_app_frontend() {
        let tauri_scheme = tauri::Url::parse("tauri://localhost/index.html").unwrap();
        let dev_host = tauri::Url::parse("http://tauri.localhost/index.html").unwrap();
        let remote = tauri::Url::parse("https://evil.example.com/page").unwrap();
        let file = tauri::Url::parse("file:///C:/Windows/notepad.exe").unwrap();

        assert!(is_local_origin(&tauri_scheme));
        assert!(is_local_origin(&dev_host));
        assert!(!is_local_origin(&remote));
        assert!(!is_local_origin(&file));
    }
}
