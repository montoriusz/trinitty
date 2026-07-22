pub mod chat;
mod jsonl_store;
mod osc133;
mod recorder;
mod settings;
mod shell;
mod terminal;

use chat::ChatSession;
use tauri::Manager;

/// Workaround for Wayland environments on Linux:
/// After hiding and showing a window, the title bar buttons
/// (close, minimize, maximize) may stop working.
/// Toggling the resizable property appears to resolve this.
///
/// Registered globally via [`tauri::Builder::on_window_event`] so it applies to
/// every window, including ones created later from the frontend.
///
/// Issue: <https://github.com/tauri-apps/tauri/issues/11856>
#[cfg(target_os = "linux")]
fn apply_wayland_titlebar_fix(window: &tauri::Window, event: &tauri::WindowEvent) {
    // Perform fix every time the window is focused.
    if let tauri::WindowEvent::Focused(true) = event {
        // Fix (toggle resizable property off and then on).
        let _ = window.set_resizable(false);
        let _ = window.set_resizable(true);
    }
}

/// Initialize the `tracing` logging subscriber.
///
/// Defaults to `app_lib::chat::generation=debug` in debug builds and `off` in
/// release builds. `RUST_LOG` (read from the environment via `dotenvy` in
/// `main.rs`) always wins when present, enabling opt-in logging for release or
/// opt-out for dev. Uses `try_init` so repeated initialization (e.g. in tests)
/// is a no-op rather than a panic.
fn init_logging() {
    use tracing_subscriber::{EnvFilter, fmt};

    let default_directive = if cfg!(debug_assertions) {
        "app_lib::chat::generation=debug"
    } else {
        "off"
    };

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_directive));

    let _ = fmt().with_env_filter(filter).try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    let terminal_session = terminal::build_session();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Create chat session. The terminal reader is spawned lazily by
            // `create_shell`, so dev HMR can re-point the channel without
            // respawning the shell.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let chat_session = ChatSession::new(&data_dir).expect("failed to create chat session");
            app.manage(chat_session);

            let config_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app config dir");
            let settings_state =
                settings::SettingsState::load(&config_dir).expect("failed to load settings state");
            app.manage(settings_state);

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "linux")]
            apply_wayland_titlebar_fix(window, event);
        })
        .manage(terminal_session)
        .invoke_handler(tauri::generate_handler![
            terminal::write_to_pty,
            terminal::resize_pty,
            terminal::create_shell,
            terminal::get_live_section_raw,
            chat::get_chat_session,
            chat::read_chat_messages,
            chat::send_chat_message,
            settings::get_settings,
            settings::get_settings_by_categories,
            settings::save_settings,
            settings::llm_providers::all_model_names,
            settings::llm_providers::get_providers,
            settings::llm_providers::new_provider_id,
            settings::llm_providers::list_available_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
