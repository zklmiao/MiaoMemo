#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod store;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use store::{
    create_default_note, make_note_id, Note, Store, UpdateNoteFields, DEFAULT_NOTE_HEIGHT,
    DEFAULT_NOTE_WIDTH,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

struct AppState {
    store: Store,
    quitting: AtomicBool,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Err(error) = show_all_notes(app) {
                eprintln!("Failed to show notes from second instance: {error}");
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_note_data,
            update_note,
            create_note,
            delete_note,
            close_window,
            quit_app
        ])
        .setup(|app| {
            let data_dir = resolve_data_dir(app.handle())?;
            fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("notes.json");

            store::cleanup_stale_tmp(&db_path);
            import_legacy_electron_data(app.handle(), &db_path);

            let (store, outcome) = Store::load(db_path);
            if let Some(backup) = &outcome.backup_path {
                eprintln!(
                    "Recovered notes database; original backed up to {}",
                    backup.display()
                );
            }

            let (x, y) = cascade_position(app.handle());
            let migrated = store.migrate(x, y);

            app.manage(AppState {
                store,
                quitting: AtomicBool::new(false),
            });

            // Persist initialization/migration immediately so the first launch
            // and legacy imports survive even if the app is killed right away.
            if migrated || outcome.needs_save {
                if let Err(error) = app.state::<AppState>().store.flush_now() {
                    eprintln!("Failed to persist initial notes database: {error}");
                }
            }

            setup_tray(app.handle())?;

            if let Some(note) = app.state::<AppState>().store.first_note() {
                if let Err(error) = create_note_window(app.handle(), &note) {
                    eprintln!("Failed to create initial note window: {error}");
                }
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
                        eprintln!("Failed to flush notes on exit: {error}");
                    }
                } else {
                    // Closing the last note should leave MiaoMemo running in the tray.
                    api.prevent_exit();
                }
            }
            RunEvent::Exit => {
                let state = app_handle.state::<AppState>();
                if let Err(error) = state.store.flush_now() {
                    eprintln!("Failed to flush notes on final exit: {error}");
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
                eprintln!(
                    "Imported legacy Electron notes from {}",
                    candidate.display()
                );
            }
            Err(error) => {
                eprintln!(
                    "Failed to import legacy notes from {}: {error}",
                    candidate.display()
                );
            }
        }
        break;
    }
}

fn cascade_position(app: &AppHandle) -> (f64, f64) {
    let open_windows = app.webview_windows().len();
    let (width, height) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
            (size.width, size.height)
        })
        .unwrap_or((1920.0, 1080.0));

    let x = ((width - DEFAULT_NOTE_WIDTH) / 2.0).floor() + (open_windows % 8) as f64 * 30.0 + 150.0;
    let y =
        ((height - DEFAULT_NOTE_HEIGHT) / 2.0).floor() - 100.0 + (open_windows % 8) as f64 * 30.0;

    (x.max(50.0), y.max(50.0))
}

fn create_note_window(app: &AppHandle, note: &Note) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(&note.id) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, &note.id, WebviewUrl::App("index.html".into()))
        .title("MiaoMemo")
        .inner_size(note.width, note.height)
        .position(note.x, note.y)
        .min_inner_size(220.0, 180.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(note.is_pinned)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
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
            WindowEvent::CloseRequested { .. } => {
                // The renderer sends every edit immediately, so the store is
                // current. Empty notes are discarded exactly like the custom
                // close button path.
                state.store.remove_if_empty(&label);
                if let Err(error) = state.store.flush_now() {
                    eprintln!("Failed to flush notes on window close: {error}");
                }
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
    let (x, y) = cascade_position(app);
    let note = create_default_note(make_note_id(), x, y);
    state.store.add_note(note.clone());
    if let Err(error) = state.store.flush_now() {
        eprintln!("Failed to persist new note: {error}");
    }
    spawn_create_note_window(app.clone(), note);
    Ok(())
}

fn show_all_notes(app: &AppHandle) -> tauri::Result<()> {
    let notes = app.state::<AppState>().store.all_notes();
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
            eprintln!("Failed to create note window {}: {error}", note.id);
        }
    });
}

fn spawn_close_window(app: AppHandle, note_id: String) {
    std::thread::spawn(move || {
        if let Some(window) = app.get_webview_window(&note_id) {
            if let Err(error) = window.close() {
                eprintln!("Failed to close note window {note_id}: {error}");
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

fn quit_app_impl(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.quitting.store(true, Ordering::SeqCst);
    if let Err(error) = state.store.flush_now() {
        eprintln!("Failed to flush notes before quit: {error}");
    }
    app.exit(0);
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
                    eprintln!("Failed to create note from tray: {error}");
                }
            }
            "show_all" => {
                if let Err(error) = show_all_notes(app) {
                    eprintln!("Failed to show notes from tray: {error}");
                }
            }
            "quit" => quit_app_impl(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                if let Err(error) = create_new_note(tray.app_handle()) {
                    eprintln!("Failed to create note from tray double-click: {error}");
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
fn get_note_data(note_id: String, state: State<'_, AppState>) -> Option<Note> {
    state.store.get_note(&note_id)
}

#[tauri::command]
fn update_note(
    app: AppHandle,
    note_id: String,
    fields: UpdateNoteFields,
    state: State<'_, AppState>,
) -> bool {
    if state.store.update_note(&note_id, &fields).is_none() {
        return false;
    }

    // Only touch the native window when pin state actually changed; otherwise
    // every keystroke would spawn an unnecessary worker thread.
    if let Some(is_pinned) = fields.is_pinned {
        spawn_set_always_on_top(app, note_id, is_pinned);
    }

    true
}

#[tauri::command]
fn create_note(app: AppHandle, state: State<'_, AppState>) -> Result<Note, String> {
    let (x, y) = cascade_position(&app);
    let note = create_default_note(make_note_id(), x, y);
    state.store.add_note(note.clone());
    if let Err(error) = state.store.flush_now() {
        eprintln!("Failed to persist new note: {error}");
    }
    spawn_create_note_window(app, note.clone());
    Ok(note)
}

#[tauri::command]
fn delete_note(app: AppHandle, note_id: String, state: State<'_, AppState>) -> bool {
    let removed = state.store.remove_note(&note_id);
    if let Err(error) = state.store.flush_now() {
        eprintln!("Failed to persist note deletion: {error}");
    }
    spawn_close_window(app, note_id);
    removed
}

#[tauri::command]
fn close_window(app: AppHandle, note_id: String, state: State<'_, AppState>) -> bool {
    state.store.remove_if_empty(&note_id);
    if let Err(error) = state.store.flush_now() {
        eprintln!("Failed to persist note close: {error}");
    }
    spawn_close_window(app, note_id);
    true
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<'_, AppState>) {
    state.quitting.store(true, Ordering::SeqCst);
    if let Err(error) = state.store.flush_now() {
        eprintln!("Failed to flush notes before quit: {error}");
    }
    app.exit(0);
}
