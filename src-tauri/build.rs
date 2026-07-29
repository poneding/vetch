fn main() {
    const COMMANDS: &[&str] = &[
        "get_settings",
        "save_settings",
        "get_history",
        "probe_url",
        "start_download",
        "cancel_download",
        "pause_download",
        "resume_download",
        "rename_download_title",
        "remove_history_item",
        "clear_finished_history",
        "delete_downloaded_file",
        "get_runtime_info",
        "append_diagnostic_log",
        "open_downloaded_file",
        "reveal_downloaded_file",
        "open_media_browser",
        "get_browser_state",
        "browser_navigate",
        "browser_back",
        "browser_forward",
        "browser_reload",
        "set_browser_media_panel_open",
        "set_browser_media_panel_width",
        "clear_browser_media",
        "select_browser_media",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to build Vetch");
}
