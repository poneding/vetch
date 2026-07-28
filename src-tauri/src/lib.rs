#[cfg(desktop)]
mod browser;
mod downloader;
mod models;
mod storage;

use std::path::Path;
use std::process::Command;

use downloader::DownloadManager;
use models::{AppSettings, DownloadItem, MediaInfo, RuntimeInfo, StartDownloadRequest};
use storage::Storage;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;

#[cfg(desktop)]
const TRAY_SHOW_ID: &str = "tray-show";
#[cfg(desktop)]
const TRAY_SETTINGS_ID: &str = "tray-settings";
#[cfg(desktop)]
const TRAY_ABOUT_ID: &str = "tray-about";
#[cfg(desktop)]
const TRAY_CHECK_UPDATES_ID: &str = "tray-check-updates";
#[cfg(desktop)]
const TRAY_QUIT_ID: &str = "tray-quit";

#[cfg(desktop)]
struct TrayMenuLabels {
    show: &'static str,
    settings: &'static str,
    about: &'static str,
    check_updates: &'static str,
    quit: &'static str,
}

#[cfg(desktop)]
fn tray_menu_labels(language: &str) -> TrayMenuLabels {
    if language == "zh-CN" {
        TrayMenuLabels {
            show: "显示主界面",
            settings: "设置",
            about: "关于",
            check_updates: "检查更新",
            quit: "退出",
        }
    } else {
        TrayMenuLabels {
            show: "Show main window",
            settings: "Settings",
            about: "About",
            check_updates: "Check for updates",
            quit: "Quit",
        }
    }
}

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

#[cfg(desktop)]
fn open_tray_panel(app: &AppHandle, panel: &str) {
    let _ = show_main_window(app);
    let _ = app.emit_to("main", "tray-action", panel);
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle, language: &str) -> tauri::Result<()> {
    let labels = tray_menu_labels(language);
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, labels.show, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, TRAY_SETTINGS_ID, labels.settings, true, None::<&str>)?;
    let about = MenuItem::with_id(app, TRAY_ABOUT_ID, labels.about, true, None::<&str>)?;
    let check_updates = MenuItem::with_id(
        app,
        TRAY_CHECK_UPDATES_ID,
        labels.check_updates,
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &settings, &about, &check_updates, &separator, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("vetch-tray")
        .tooltip("Vetch")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            if event.id() == TRAY_SHOW_ID {
                let _ = show_main_window(app);
            } else if event.id() == TRAY_SETTINGS_ID {
                open_tray_panel(app, "settings");
            } else if event.id() == TRAY_ABOUT_ID {
                open_tray_panel(app, "about");
            } else if event.id() == TRAY_CHECK_UPDATES_ID {
                // Show main window + open About and run the same check as the About button.
                open_tray_panel(app, "check-updates");
            } else if event.id() == TRAY_QUIT_ID {
                app.exit(0);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[tauri::command]
async fn get_settings(app: AppHandle, storage: State<'_, Storage>) -> Result<AppSettings, String> {
    storage.get_settings(&app).await
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    storage: State<'_, Storage>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let saved = storage.save_settings(&app, settings).await?;
    apply_system_settings(&app, &saved)?;
    #[cfg(desktop)]
    browser::apply_browser_preferences(&app, &saved.language, &saved.theme)?;
    Ok(saved)
}

fn apply_system_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let autostart = app.autolaunch();
    if settings.launch_at_login {
        autostart.enable().map_err(|error| error.to_string())?;
    } else if autostart.is_enabled().map_err(|error| error.to_string())? {
        autostart.disable().map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    app.set_dock_visibility(!settings.hide_dock_icon)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
async fn get_history(storage: State<'_, Storage>) -> Result<Vec<DownloadItem>, String> {
    storage.get_history().await
}

#[tauri::command]
async fn probe_url(
    app: AppHandle,
    url: String,
    referer: Option<String>,
    detail: Option<String>,
) -> Result<MediaInfo, String> {
    let summary = detail.as_deref() == Some("summary");
    downloader::probe_url(&app, &url, referer.as_deref(), summary).await
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    storage: State<'_, Storage>,
    request: StartDownloadRequest,
) -> Result<DownloadItem, String> {
    manager.start(app, storage.inner().clone(), request).await
}

#[tauri::command]
async fn retry_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    storage: State<'_, Storage>,
    id: String,
) -> Result<DownloadItem, String> {
    manager.retry(app, storage.inner().clone(), &id).await
}

#[tauri::command]
async fn cancel_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    storage: State<'_, Storage>,
    id: String,
) -> Result<(), String> {
    manager.cancel(&app, storage.inner(), &id).await;
    Ok(())
}

#[tauri::command]
async fn pause_download(manager: State<'_, DownloadManager>, id: String) -> Result<(), String> {
    manager.pause(&id).await;
    Ok(())
}

#[tauri::command]
async fn resume_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    storage: State<'_, Storage>,
    id: String,
) -> Result<(), String> {
    manager.resume(app, storage.inner().clone(), &id).await
}

#[tauri::command]
async fn rename_download_title(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    storage: State<'_, Storage>,
    id: String,
    title: String,
) -> Result<(), String> {
    manager
        .rename_title(&app, storage.inner(), &id, title)
        .await
}

#[tauri::command]
async fn rename_playlist(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    storage: State<'_, Storage>,
    playlist_id: String,
    title: String,
) -> Result<(), String> {
    manager
        .rename_playlist(&app, storage.inner(), &playlist_id, title)
        .await
}

#[tauri::command]
async fn remove_history_item(storage: State<'_, Storage>, id: String) -> Result<(), String> {
    storage.remove_history_item(&id).await
}

#[tauri::command]
async fn clear_finished_history(storage: State<'_, Storage>) -> Result<(), String> {
    storage.clear_finished_history().await
}

#[tauri::command]
async fn delete_downloaded_file(storage: State<'_, Storage>, id: String) -> Result<(), String> {
    let item = storage
        .get_history()
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "Download history item was not found".to_string())?;
    let path = item
        .file_path
        .ok_or_else(|| "Download history item has no saved file".to_string())?;
    ensure_path_exists(&path)?;
    tokio::fs::remove_file(&path)
        .await
        .map_err(|error| format!("Failed to delete downloaded file: {error}"))?;
    storage.remove_history_item(&id).await
}

#[tauri::command]
fn get_runtime_info(app: AppHandle) -> RuntimeInfo {
    downloader::runtime_info(&app)
}

#[tauri::command]
fn open_downloaded_file(app: AppHandle, path: String) -> Result<(), String> {
    ensure_path_exists(&path)?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| format!("Failed to open path: {error}"))
}

#[tauri::command]
fn reveal_downloaded_file(path: String) -> Result<(), String> {
    ensure_path_exists(&path)?;
    reveal_path(&path)
}

fn ensure_path_exists(path: &str) -> Result<(), String> {
    if Path::new(path).exists() {
        Ok(())
    } else {
        Err("The downloaded file no longer exists".to_string())
    }
}

#[cfg(target_os = "macos")]
fn reveal_path(path: &str) -> Result<(), String> {
    if Path::new(path).is_dir() {
        return spawn_command("open", &[path]);
    }
    spawn_command("open", &["-R", path])
}

#[cfg(target_os = "windows")]
fn reveal_path(path: &str) -> Result<(), String> {
    if Path::new(path).is_dir() {
        return spawn_command("explorer.exe", &[path]);
    }
    spawn_command("explorer.exe", &["/select,", path])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path(path: &str) -> Result<(), String> {
    let path_obj = Path::new(path);
    if path_obj.is_dir() {
        return spawn_command("xdg-open", &[path]);
    }
    let parent = path_obj
        .parent()
        .ok_or_else(|| "The downloaded file has no parent directory".to_string())?;
    let parent = parent.to_string_lossy();
    spawn_command("xdg-open", &[parent.as_ref()])
}

fn spawn_command(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open path: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        let _ = show_main_window(app);
    }));

    builder
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let storage = Storage::new(data_dir);
            let settings = tauri::async_runtime::block_on(storage.get_settings(app.handle()))
                .unwrap_or_default();
            let manager = DownloadManager::default();
            if let Err(error) = tauri::async_runtime::block_on(manager.restore_paused(&storage)) {
                eprintln!("Failed to restore paused downloads: {error}");
            }
            app.manage(storage.clone());
            app.manage(manager);
            #[cfg(desktop)]
            {
                app.manage(browser::BrowserState::default());
                app.manage(browser::BrowserResizeState::default());
            }
            let _ = apply_system_settings(app.handle(), &settings);
            #[cfg(desktop)]
            build_tray(app.handle(), &settings.language)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            browser::handle_window_event(window, event);
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_history,
            probe_url,
            start_download,
            retry_download,
            cancel_download,
            pause_download,
            resume_download,
            rename_download_title,
            rename_playlist,
            remove_history_item,
            clear_finished_history,
            delete_downloaded_file,
            get_runtime_info,
            open_downloaded_file,
            reveal_downloaded_file,
            #[cfg(desktop)]
            browser::open_media_browser,
            #[cfg(desktop)]
            browser::get_browser_state,
            #[cfg(desktop)]
            browser::browser_navigate,
            #[cfg(desktop)]
            browser::browser_back,
            #[cfg(desktop)]
            browser::browser_forward,
            #[cfg(desktop)]
            browser::browser_reload,
            #[cfg(desktop)]
            browser::browser_focus_address,
            #[cfg(desktop)]
            browser::set_browser_media_panel_open,
            #[cfg(desktop)]
            browser::set_browser_media_panel_width,
            #[cfg(desktop)]
            browser::clear_browser_media,
            #[cfg(desktop)]
            browser::select_browser_media
        ])
        .build(tauri::generate_context!())
        .expect("error while building Vetch")
        .run(|app, event| {
            // macOS Dock click while the main window is hidden should bring it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                let _ = show_main_window(app);
            }
        });
}

#[cfg(all(test, desktop))]
mod tray_tests {
    use super::tray_menu_labels;

    #[test]
    fn uses_chinese_tray_labels_for_simplified_chinese() {
        let labels = tray_menu_labels("zh-CN");
        assert_eq!(labels.show, "显示主界面");
        assert_eq!(labels.settings, "设置");
        assert_eq!(labels.about, "关于");
        assert_eq!(labels.check_updates, "检查更新");
        assert_eq!(labels.quit, "退出");
    }

    #[test]
    fn falls_back_to_english_tray_labels() {
        let labels = tray_menu_labels("en");
        assert_eq!(labels.show, "Show main window");
        assert_eq!(labels.settings, "Settings");
        assert_eq!(labels.about, "About");
        assert_eq!(labels.check_updates, "Check for updates");
        assert_eq!(labels.quit, "Quit");
    }
}
