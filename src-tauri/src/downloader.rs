use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex, Notify};

use crate::models::{
    AppSettings, DownloadItem, DownloadProgress, MediaFormat, MediaInfo, PlaylistEntry,
    RuntimeInfo, StartDownloadRequest,
};
use crate::storage::Storage;

const LOG_LIMIT: usize = 30_000;
const DOWNLOAD_UPDATE_INTERVAL: Duration = Duration::from_millis(100);
const PROBE_TIMEOUT_SECONDS: u64 = 90;

/// Why a running download was interrupted. `Cancel` abandons the task, while
/// `Pause` keeps the partial `.part` file so yt-dlp can continue it on resume.
#[derive(Clone, Copy)]
enum StopReason {
    Cancel,
    Pause,
}

/// The outcome of a download attempt once its process has exited.
enum Outcome {
    Finished,
    Stopped(StopReason),
}

#[derive(Clone)]
struct PausedTask {
    item: DownloadItem,
    request: StartDownloadRequest,
}

struct DownloadPlan {
    directory: String,
    output_template: String,
    reservation_key: PathBuf,
}

#[derive(Clone, Default)]
pub struct DownloadManager {
    stops: Arc<Mutex<HashMap<String, oneshot::Sender<StopReason>>>>,
    active_urls: Arc<Mutex<HashSet<String>>>,
    active_count: Arc<Mutex<usize>>,
    slot_available: Arc<Notify>,
    paused: Arc<Mutex<HashMap<String, PausedTask>>>,
    title_overrides: Arc<Mutex<HashMap<String, String>>>,
    filename_reservations: Arc<Mutex<HashSet<PathBuf>>>,
    playlist_operations: Arc<Mutex<()>>,
}

impl DownloadManager {
    pub async fn start(
        &self,
        app: AppHandle,
        storage: Storage,
        request: StartDownloadRequest,
    ) -> Result<DownloadItem, String> {
        validate_request(&request)?;
        let settings = storage.get_settings(&app).await?;
        let id = uuid::Uuid::new_v4().to_string();
        let _playlist_guard = self.playlist_operations.lock().await;
        self.enqueue_new(app, storage, request, settings, id, timestamp_millis())
            .await
    }

    /// Re-run a failed/cancelled history item with its exact persisted request.
    pub async fn retry(
        &self,
        app: AppHandle,
        storage: Storage,
        id: &str,
    ) -> Result<DownloadItem, String> {
        let _playlist_guard = self.playlist_operations.lock().await;
        let existing = storage
            .get_history_item(id)
            .await?
            .ok_or_else(|| "Download history item was not found".to_string())?;
        if !matches!(existing.status.as_str(), "error" | "cancelled") {
            return Err("Only failed or cancelled downloads can be retried".to_string());
        }
        let request = existing.original_request.clone().ok_or_else(|| {
            "The original download request is unavailable; this item cannot be retried".to_string()
        })?;
        validate_request(&request)?;
        let settings = storage.get_settings(&app).await?;
        let normalized_url = request.url.trim().to_string();
        self.claim_url(&normalized_url).await?;

        let plan = match self.plan_for_retry(&existing, &request, &settings).await {
            Ok(plan) => plan,
            Err(error) => {
                self.release_url(&normalized_url).await;
                return Err(error);
            }
        };
        let pending = pending_item_from_existing(&existing, &request, &plan);
        if let Err(error) = storage
            .transition_history_item(id, &["error", "cancelled"], pending.clone())
            .await
        {
            self.release_plan(&plan.reservation_key).await;
            self.release_url(&normalized_url).await;
            return Err(error);
        }

        self.restore_title_override(&pending).await;
        self.spawn_task(app, storage, pending.clone(), request)
            .await;
        Ok(pending)
    }

    async fn enqueue_new(
        &self,
        app: AppHandle,
        storage: Storage,
        request: StartDownloadRequest,
        settings: AppSettings,
        id: String,
        created_at: u64,
    ) -> Result<DownloadItem, String> {
        let normalized_url = request.url.trim().to_string();
        self.claim_url(&normalized_url).await?;
        let plan = match self.create_download_plan(&id, &request, &settings).await {
            Ok(plan) => plan,
            Err(error) => {
                self.release_url(&normalized_url).await;
                return Err(error);
            }
        };
        let item = create_pending_item(&id, created_at, &request, &settings, &plan);
        if let Err(error) = storage.upsert_history(item.clone()).await {
            self.release_plan(&plan.reservation_key).await;
            self.release_url(&normalized_url).await;
            return Err(error);
        }
        self.spawn_task(app, storage, item.clone(), request).await;
        Ok(item)
    }

    async fn spawn_task(
        &self,
        app: AppHandle,
        storage: Storage,
        item: DownloadItem,
        request: StartDownloadRequest,
    ) {
        let (stop_sender, stop_receiver) = oneshot::channel();
        self.stops.lock().await.insert(item.id.clone(), stop_sender);
        emit_item(&app, &item, &self.title_overrides).await;

        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            manager
                .run_queued(app, storage, item, request, stop_receiver)
                .await;
        });
    }

    pub async fn rename_title(
        &self,
        app: &AppHandle,
        storage: &Storage,
        id: &str,
        title: String,
    ) -> Result<(), String> {
        let normalized = title.trim().to_string();
        if normalized.is_empty() {
            return Err("Filename cannot be empty".to_string());
        }
        let existing = storage
            .get_history_item(id)
            .await?
            .ok_or_else(|| "Download history item was not found".to_string())?;
        let defers_physical_rename = matches!(
            existing.status.as_str(),
            "pending" | "downloading" | "processing" | "paused" | "error" | "cancelled"
        );

        let (next_title, next_path, title_override) = if defers_physical_rename {
            (normalized.clone(), None, Some(normalized.clone()))
        } else if let Some(file_path) = existing.file_path.as_deref() {
            let new_path = rename_download_file(file_path, &normalized).await?;
            (file_name_only(&new_path), Some(new_path), None)
        } else {
            (normalized.clone(), None, None)
        };

        let renamed = storage
            .rename_history_item(id, &next_title, next_path, title_override.clone())
            .await?
            .ok_or_else(|| "Download history item was not found".to_string())?;
        if let Some(override_title) = title_override {
            self.title_overrides
                .lock()
                .await
                .insert(id.to_string(), override_title);
        } else {
            self.title_overrides.lock().await.remove(id);
        }
        if existing.status == "paused" {
            if let Some(paused) = self.paused.lock().await.get_mut(id) {
                paused.item = renamed.clone();
            }
        }
        emit_item(app, &renamed, &self.title_overrides).await;
        Ok(())
    }

    pub async fn rename_playlist(
        &self,
        app: &AppHandle,
        storage: &Storage,
        playlist_id: &str,
        title: String,
    ) -> Result<(), String> {
        let normalized = title.trim().to_string();
        if normalized.is_empty() {
            return Err("Playlist name cannot be empty".to_string());
        }
        let _playlist_guard = self.playlist_operations.lock().await;
        let history = storage.get_history().await?;
        let matching: Vec<&DownloadItem> = history
            .iter()
            .filter(|item| item.playlist_id.as_deref() == Some(playlist_id))
            .collect();
        if matching.is_empty() {
            return Err("Playlist history was not found".to_string());
        }
        if matching.iter().any(|item| is_playlist_active(&item.status)) {
            return Err("A playlist with active downloads cannot be renamed".to_string());
        }

        let old_title = matching
            .iter()
            .find_map(|item| item.playlist_title.as_deref())
            .unwrap_or("Playlist");
        let old_identity = playlist_folder_name(old_title, playlist_id);
        let legacy_identity = sanitize_path_component(old_title);
        let new_identity = playlist_folder_name(&normalized, playlist_id);
        let sample_directory = matching
            .iter()
            .find_map(|item| item.download_directory.as_deref().map(PathBuf::from));
        let sample_path = matching
            .iter()
            .find_map(|item| item.file_path.as_deref().map(PathBuf::from));
        let old_folder = sample_directory.or_else(|| {
            sample_path.as_deref().and_then(|path| {
                find_ancestor_named(path, &old_identity)
                    .or_else(|| find_ancestor_named(path, &legacy_identity))
            })
        });

        let mut renamed_folder = None;
        let new_folder = if let Some(old_folder) = old_folder.as_ref() {
            let target = old_folder.with_file_name(&new_identity);
            if target != *old_folder && old_folder.is_dir() {
                if target.exists() {
                    return Err("A folder with that playlist name already exists".to_string());
                }
                tokio::fs::rename(old_folder, &target)
                    .await
                    .map_err(|error| format!("Failed to rename playlist folder: {error}"))?;
                renamed_folder = Some((old_folder.clone(), target.clone()));
            }
            Some(target)
        } else {
            None
        };

        let updated = match storage
            .rename_playlist_history(
                playlist_id,
                &normalized,
                old_folder.as_deref(),
                new_folder.as_deref(),
            )
            .await
        {
            Ok(updated) => updated,
            Err(error) => {
                if let Some((old_folder, target)) = renamed_folder {
                    if let Err(rollback_error) = tokio::fs::rename(&target, &old_folder).await {
                        return Err(format!(
                            "{error}; failed to restore playlist folder: {rollback_error}"
                        ));
                    }
                }
                return Err(error);
            }
        };
        for item in &updated {
            emit_item(app, item, &self.title_overrides).await;
        }
        Ok(())
    }

    pub async fn cancel(&self, app: &AppHandle, storage: &Storage, id: &str) {
        if let Some(paused) = self.paused.lock().await.remove(id) {
            let PausedTask { mut item, request } = paused;
            finish_cancelled(app, storage, &mut item, &self.title_overrides).await;
            self.release_download_state(&item, &request).await;
            return;
        }
        if let Some(sender) = self.stops.lock().await.remove(id) {
            let _ = sender.send(StopReason::Cancel);
        }
    }

    pub async fn pause(&self, id: &str) {
        if let Some(sender) = self.stops.lock().await.remove(id) {
            let _ = sender.send(StopReason::Pause);
        }
    }

    pub async fn resume(&self, app: AppHandle, storage: Storage, id: &str) -> Result<(), String> {
        let _playlist_guard = self.playlist_operations.lock().await;
        let paused = self
            .paused
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| "This download is not paused".to_string())?;
        let mut pending = paused.item.clone();
        reset_pending_item(&mut pending);
        storage
            .transition_history_item(id, &["paused"], pending.clone())
            .await?;
        self.paused.lock().await.remove(id);
        self.spawn_task(app, storage, pending, paused.request).await;
        Ok(())
    }

    /// Restore only paused tasks with their exact persisted request and execution plan.
    pub async fn restore_paused(&self, storage: &Storage) -> Result<(), String> {
        let history = storage.get_history().await?;
        for mut item in history {
            if matches!(
                item.status.as_str(),
                "pending" | "downloading" | "processing"
            ) {
                item.status = "error".to_string();
                item.error = Some("The previous download was interrupted".to_string());
                item.completed_at = Some(timestamp_millis());
                storage.upsert_history(item).await?;
                continue;
            }
            if item.status != "paused" {
                continue;
            }
            let Some(request) = item.original_request.clone() else {
                item.status = "error".to_string();
                item.error = Some(
                    "The original download request is unavailable; this item cannot be resumed"
                        .to_string(),
                );
                item.completed_at = Some(timestamp_millis());
                storage.upsert_history(item).await?;
                continue;
            };
            if item.download_directory.is_none() || item.output_template.is_none() {
                item.status = "error".to_string();
                item.error = Some(
                    "The original download execution plan is unavailable; this item cannot be resumed"
                        .to_string(),
                );
                item.completed_at = Some(timestamp_millis());
                storage.upsert_history(item).await?;
                continue;
            }
            validate_request(&request)?;
            let key = reservation_key_for_item(&item, &request)?;
            self.filename_reservations.lock().await.insert(key);
            self.active_urls
                .lock()
                .await
                .insert(request.url.trim().to_string());
            self.restore_title_override(&item).await;
            self.paused
                .lock()
                .await
                .insert(item.id.clone(), PausedTask { item, request });
        }
        Ok(())
    }

    async fn run_queued(
        &self,
        app: AppHandle,
        storage: Storage,
        mut item: DownloadItem,
        request: StartDownloadRequest,
        mut stop_receiver: oneshot::Receiver<StopReason>,
    ) {
        let settings = match storage.get_settings(&app).await {
            Ok(settings) => settings,
            Err(error) => {
                finish_with_error(&app, &storage, &mut item, error, &self.title_overrides).await;
                self.stops.lock().await.remove(&item.id);
                self.release_download_state(&item, &request).await;
                return;
            }
        };

        match self
            .wait_for_slot(settings.max_concurrent_downloads, &mut stop_receiver)
            .await
        {
            SlotOutcome::Acquired => {}
            SlotOutcome::Stopped(StopReason::Cancel) => {
                finish_cancelled(&app, &storage, &mut item, &self.title_overrides).await;
                self.release_download_state(&item, &request).await;
                return;
            }
            SlotOutcome::Stopped(StopReason::Pause) => {
                if let Err(error) = self
                    .park_paused(&app, &storage, item.clone(), request.clone())
                    .await
                {
                    finish_with_error(
                        &app,
                        &storage,
                        &mut item,
                        format!("Failed to persist paused download: {error}"),
                        &self.title_overrides,
                    )
                    .await;
                    self.release_download_state(&item, &request).await;
                }
                return;
            }
        }

        let result = execute_download(
            &app,
            &storage,
            &mut item,
            &request,
            &settings,
            &mut stop_receiver,
            &self.title_overrides,
        )
        .await;

        self.release_slot().await;
        match result {
            Ok(Outcome::Finished) => {
                self.title_overrides.lock().await.remove(&item.id);
            }
            Ok(Outcome::Stopped(StopReason::Cancel)) => {
                finish_cancelled(&app, &storage, &mut item, &self.title_overrides).await;
                self.title_overrides.lock().await.remove(&item.id);
            }
            Ok(Outcome::Stopped(StopReason::Pause)) => {
                if self
                    .park_paused(&app, &storage, item.clone(), request.clone())
                    .await
                    .is_ok()
                {
                    return;
                }
                finish_with_error(
                    &app,
                    &storage,
                    &mut item,
                    "Failed to persist paused download".to_string(),
                    &self.title_overrides,
                )
                .await;
            }
            Err(error) => {
                finish_with_error(&app, &storage, &mut item, error, &self.title_overrides).await;
                self.title_overrides.lock().await.remove(&item.id);
            }
        }

        self.stops.lock().await.remove(&item.id);
        self.release_download_state(&item, &request).await;
    }

    async fn wait_for_slot(
        &self,
        max_concurrent: usize,
        stop_receiver: &mut oneshot::Receiver<StopReason>,
    ) -> SlotOutcome {
        loop {
            {
                let mut active_count = self.active_count.lock().await;
                if *active_count < max_concurrent {
                    *active_count += 1;
                    return SlotOutcome::Acquired;
                }
            }

            tokio::select! {
                _ = self.slot_available.notified() => {}
                reason = &mut *stop_receiver => {
                    return SlotOutcome::Stopped(reason.unwrap_or(StopReason::Cancel));
                }
            }
        }
    }

    async fn release_slot(&self) {
        let mut active_count = self.active_count.lock().await;
        *active_count = active_count.saturating_sub(1);
        drop(active_count);
        self.slot_available.notify_waiters();
    }

    async fn park_paused(
        &self,
        app: &AppHandle,
        storage: &Storage,
        mut item: DownloadItem,
        request: StartDownloadRequest,
    ) -> Result<(), String> {
        item.status = "paused".to_string();
        item.progress.speed = None;
        item.progress.eta = None;
        apply_title_override(&mut item, &self.title_overrides).await;
        storage.upsert_history(item.clone()).await?;
        self.paused.lock().await.insert(
            item.id.clone(),
            PausedTask {
                item: item.clone(),
                request,
            },
        );
        emit_item(app, &item, &self.title_overrides).await;
        Ok(())
    }

    async fn create_download_plan(
        &self,
        id: &str,
        request: &StartDownloadRequest,
        settings: &AppSettings,
    ) -> Result<DownloadPlan, String> {
        let base_path = request
            .custom_download_path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
            .unwrap_or(&settings.download_path);
        let directory = resolve_download_directory(
            base_path,
            request.playlist_title.as_deref(),
            request.playlist_id.as_deref(),
        );
        let base_template = request
            .custom_filename_template
            .as_deref()
            .filter(|template| !template.trim().is_empty())
            .unwrap_or(&settings.filename_template);
        let mut output_template = if settings.create_uploader_folder {
            format!("%(uploader)s/{base_template}")
        } else {
            base_template.to_string()
        };
        let base_key = reservation_key(&directory, request, settings.create_uploader_folder, None);
        let disk_conflict = filename_stem_exists(&base_key).await?;
        let mut reservations = self.filename_reservations.lock().await;
        let reservation_conflict = reservations.contains(&base_key);
        let reservation_key = if disk_conflict || reservation_conflict {
            output_template = add_id_to_output_template(&output_template, id);
            reservation_key(
                &directory,
                request,
                settings.create_uploader_folder,
                Some(id),
            )
        } else {
            base_key
        };
        if reservations.contains(&reservation_key) {
            return Err("The selected output filename is already in use".to_string());
        }
        reservations.insert(reservation_key.clone());
        Ok(DownloadPlan {
            directory,
            output_template,
            reservation_key,
        })
    }

    async fn plan_for_retry(
        &self,
        item: &DownloadItem,
        request: &StartDownloadRequest,
        settings: &AppSettings,
    ) -> Result<DownloadPlan, String> {
        if let (Some(directory), Some(output_template)) = (
            item.download_directory.clone(),
            item.output_template.clone(),
        ) {
            let reservation_key = reservation_key_for_item(item, request)?;
            let mut reservations = self.filename_reservations.lock().await;
            if !reservations.insert(reservation_key.clone()) {
                return Err("The selected output filename is already in use".to_string());
            }
            return Ok(DownloadPlan {
                directory,
                output_template,
                reservation_key,
            });
        }
        self.create_download_plan(&item.id, request, settings).await
    }

    async fn claim_url(&self, url: &str) -> Result<(), String> {
        if self.active_urls.lock().await.insert(url.to_string()) {
            Ok(())
        } else {
            Err("This URL is already in the download queue".to_string())
        }
    }

    async fn release_url(&self, url: &str) {
        self.active_urls.lock().await.remove(url);
    }

    async fn release_plan(&self, reservation_key: &Path) {
        self.filename_reservations
            .lock()
            .await
            .remove(reservation_key);
    }

    async fn release_download_state(&self, item: &DownloadItem, request: &StartDownloadRequest) {
        self.release_url(request.url.trim()).await;
        if let Ok(key) = reservation_key_for_item(item, request) {
            self.release_plan(&key).await;
        }
    }

    async fn restore_title_override(&self, item: &DownloadItem) {
        if let Some(title) = item.title_override.as_ref() {
            self.title_overrides
                .lock()
                .await
                .insert(item.id.clone(), title.clone());
        }
    }
}

/// Result of waiting for a concurrency slot.
enum SlotOutcome {
    Acquired,
    Stopped(StopReason),
}

pub fn runtime_info(app: &AppHandle) -> RuntimeInfo {
    RuntimeInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        yt_dlp_ready: resolve_binary(app, BinaryKind::YtDlp).is_ok(),
        ffmpeg_ready: resolve_binary(app, BinaryKind::Ffmpeg).is_ok(),
    }
}

pub async fn probe_url(
    app: &AppHandle,
    url: &str,
    referer: Option<&str>,
    summary: bool,
) -> Result<MediaInfo, String> {
    validate_url(url)?;
    if let Some(referer) = referer {
        validate_url(referer)?;
    }
    let executable = resolve_binary(app, BinaryKind::YtDlp)?;
    let mut args = vec![
        "--dump-single-json".to_string(),
        "--skip-download".to_string(),
        "--no-warnings".to_string(),
        "--playlist-end".to_string(),
        "200".to_string(),
    ];
    if summary {
        args.push("--flat-playlist".to_string());
    }
    append_referer(&mut args, referer);
    append_javascript_runtime(app, &mut args);
    args.push(url.to_string());
    let mut command = Command::new(executable);
    command
        .args(args)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(PROBE_TIMEOUT_SECONDS),
        command.output(),
    )
    .await
    .map_err(|_| "Reading media information timed out".to_string())?
    .map_err(|error| format!("Failed to start yt-dlp: {error}"))?;

    if !output.status.success() {
        return Err(clean_error(&String::from_utf8_lossy(&output.stderr)));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("yt-dlp returned invalid media information: {error}"))?;
    parse_media_info(&value, url)
}

async fn execute_download(
    app: &AppHandle,
    storage: &Storage,
    item: &mut DownloadItem,
    request: &StartDownloadRequest,
    settings: &AppSettings,
    stop_receiver: &mut oneshot::Receiver<StopReason>,
    title_overrides: &Mutex<HashMap<String, String>>,
) -> Result<Outcome, String> {
    let executable = resolve_binary(app, BinaryKind::YtDlp)?;
    let download_path = item
        .download_directory
        .as_deref()
        .ok_or_else(|| "The download directory is unavailable".to_string())?;
    let output_template = item
        .output_template
        .as_deref()
        .ok_or_else(|| "The output template is unavailable".to_string())?;
    tokio::fs::create_dir_all(download_path)
        .await
        .map_err(|error| format!("Failed to create download directory: {error}"))?;

    let args = build_download_args(app, request, settings, download_path, output_template);
    append_log(item, &format!("yt-dlp {}", args.join(" ")));
    item.status = "downloading".to_string();
    item.started_at = Some(timestamp_millis());
    emit_item(app, item, title_overrides).await;

    let mut command = Command::new(executable);
    command
        .args(&args)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start yt-dlp: {error}"))?;

    let (line_sender, mut line_receiver) = mpsc::channel::<String>(128);
    if let Some(stdout) = child.stdout.take() {
        tauri::async_runtime::spawn(read_lines(stdout, line_sender.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(read_lines(stderr, line_sender.clone()));
    }
    drop(line_sender);

    let mut output_open = true;
    let mut pending_update = false;
    let mut update_interval = tokio::time::interval(DOWNLOAD_UPDATE_INTERVAL);
    update_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    update_interval.tick().await;
    let (exit_status, stopped) = loop {
        tokio::select! {
            status = child.wait() => {
                break (Some(status.map_err(|error| format!("Failed to wait for yt-dlp: {error}"))?), None);
            }
            reason = &mut *stop_receiver => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                break (None, Some(reason.unwrap_or(StopReason::Cancel)));
            }
            _ = update_interval.tick(), if pending_update => {
                emit_item(app, item, title_overrides).await;
                pending_update = false;
            }
            line = line_receiver.recv(), if output_open => {
                if let Some(line) = line {
                    process_output_line(item, &line);
                    pending_update = true;
                } else {
                    output_open = false;
                }
            }
        }
    };

    while let Ok(line) = line_receiver.try_recv() {
        process_output_line(item, &line);
    }

    if let Some(reason) = stopped {
        return Ok(Outcome::Stopped(reason));
    }

    if exit_status.is_some_and(|status| status.success()) {
        item.status = "completed".to_string();
        item.progress.percent = 100.0;
        item.completed_at = Some(timestamp_millis());
        sync_completed_filename(item, title_overrides).await;
        storage.upsert_history(item.clone()).await?;
        emit_item(app, item, title_overrides).await;
        if settings.notifications_enabled {
            let _ = app
                .notification()
                .builder()
                .title("Vetch")
                .body(format!("Download complete: {}", item.title))
                .show();
        }
        return Ok(Outcome::Finished);
    }

    Err(last_log_line(&item.log).unwrap_or_else(|| "yt-dlp exited with an error".to_string()))
}

fn build_download_args(
    app: &AppHandle,
    request: &StartDownloadRequest,
    settings: &AppSettings,
    download_path: &str,
    output_template: &str,
) -> Vec<String> {
    let mut args = vec![
        "--newline".to_string(),
        "--no-color".to_string(),
        "--progress".to_string(),
        "--no-playlist".to_string(),
        "--progress-template".to_string(),
        "download:vetch-progress:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s".to_string(),
        "--print".to_string(),
        "after_move:vetch-file:%(filepath)s".to_string(),
        "--paths".to_string(),
        download_path.to_string(),
        "--output".to_string(),
        output_template.to_string(),
        "--no-overwrites".to_string(),
    ];

    if request.media_type == "audio" {
        if let Some(format_id) = request
            .format_id
            .as_deref()
            .filter(|format_id| !format_id.trim().is_empty())
        {
            args.extend([
                "--format".to_string(),
                format!("{format_id}/bestaudio/best"),
            ]);
        }
        args.extend([
            "--extract-audio".to_string(),
            "--audio-format".to_string(),
            request
                .audio_format
                .clone()
                .unwrap_or_else(|| settings.audio_format.clone()),
            "--audio-quality".to_string(),
            "0".to_string(),
        ]);
    } else {
        let format = request
            .format_id
            .as_deref()
            .filter(|format_id| !format_id.trim().is_empty())
            .map(|format_id| format!("{format_id}+bestaudio/{format_id}/bestvideo*+bestaudio/best"))
            .unwrap_or_else(|| {
                let quality = request
                    .quality
                    .as_deref()
                    .unwrap_or(&settings.video_quality);
                format_selector(quality)
            });
        args.extend(["--format".to_string(), format]);
        let container = request
            .video_container
            .as_deref()
            .unwrap_or(&settings.video_container);
        if container != "auto" {
            args.extend(["--merge-output-format".to_string(), container.to_string()]);
        }
    }

    let download_subtitles = request
        .download_subtitles
        .unwrap_or(settings.download_subtitles);
    if download_subtitles {
        args.extend([
            "--write-subs".to_string(),
            "--write-auto-subs".to_string(),
            "--sub-langs".to_string(),
            "all,-live_chat".to_string(),
        ]);
        if settings.embed_subtitles {
            args.push("--embed-subs".to_string());
        }
    }
    if settings.embed_metadata {
        args.push("--embed-metadata".to_string());
    }
    if settings.embed_chapters {
        args.push("--embed-chapters".to_string());
    }
    if settings.embed_thumbnail {
        args.push("--embed-thumbnail".to_string());
    }
    if !settings.proxy.trim().is_empty() {
        args.extend(["--proxy".to_string(), settings.proxy.trim().to_string()]);
    }
    if !settings.config_path.trim().is_empty() {
        args.extend([
            "--config-locations".to_string(),
            settings.config_path.trim().to_string(),
        ]);
    }
    if !settings.cookies_path.trim().is_empty() {
        args.extend([
            "--cookies".to_string(),
            settings.cookies_path.trim().to_string(),
        ]);
    } else if settings.browser_for_cookies != "none" {
        let browser_setting = if settings.browser_cookies_profile.trim().is_empty() {
            settings.browser_for_cookies.clone()
        } else {
            format!(
                "{}:{}",
                settings.browser_for_cookies,
                settings.browser_cookies_profile.trim()
            )
        };
        args.extend(["--cookies-from-browser".to_string(), browser_setting]);
    }
    if !settings.preferred_audio_language.trim().is_empty() {
        args.extend([
            "--format-sort".to_string(),
            format!("lang:{}", settings.preferred_audio_language.trim()),
        ]);
    }
    if request
        .start_time
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || request
            .end_time
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        let start = request
            .start_time
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("0");
        let end = request
            .end_time
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("inf");
        args.extend([
            "--download-sections".to_string(),
            format!("*{start}-{end}"),
            "--force-keyframes-at-cuts".to_string(),
        ]);
    }
    append_referer(&mut args, request.referer.as_deref());
    append_preferred_title(&mut args, request.title.as_deref());
    if let Ok(ffmpeg_path) = resolve_binary(app, BinaryKind::Ffmpeg) {
        let ffmpeg_location = ffmpeg_path.parent().unwrap_or(&ffmpeg_path);
        args.extend([
            "--ffmpeg-location".to_string(),
            ffmpeg_location.to_string_lossy().into_owned(),
        ]);
    }
    append_javascript_runtime(app, &mut args);
    args.push(request.url.clone());
    args
}

fn append_referer(args: &mut Vec<String>, referer: Option<&str>) {
    if let Some(referer) = referer.map(str::trim).filter(|value| !value.is_empty()) {
        args.extend(["--referer".to_string(), referer.to_string()]);
    }
}

/// Force yt-dlp's title metadata (and therefore %(title)s in the output template)
/// when the UI already resolved a better title — e.g. the page title for raw m3u8.
fn append_preferred_title(args: &mut Vec<String>, title: Option<&str>) {
    let Some(title) = title.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    // Skip placeholder titles so we don't override a better probe result later.
    let lowered = title.to_ascii_lowercase();
    if matches!(
        lowered.as_str(),
        "preparing download..." | "untitled media" | "unknown" | "na" | "n/a"
    ) {
        return;
    }
    // Strip a media extension so "%(title)s.%(ext)s" does not become "song.mp3.mp3".
    let title = stem_for_template(title);
    // IMPORTANT: do not use ".*" here. Python's re.sub matches an extra empty
    // string after the full match, so the replacement is applied twice and the
    // title gets doubled in the output filename.
    args.extend([
        "--replace-in-metadata".to_string(),
        "title".to_string(),
        r"^[\s\S]*$".to_string(),
        title,
    ]);
}

fn expected_extension_for_request(
    request: &StartDownloadRequest,
    settings: &AppSettings,
) -> Option<String> {
    if request.media_type == "audio" {
        let format = request
            .audio_format
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(settings.audio_format.as_str())
            .trim()
            .trim_start_matches('.')
            .to_ascii_lowercase();
        return if format.is_empty() {
            Some("mp3".to_string())
        } else {
            Some(format)
        };
    }

    let container = request
        .video_container
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(settings.video_container.as_str())
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if container.is_empty() || container == "auto" {
        // Best-effort guess until yt-dlp reports the real path.
        Some("mp4".to_string())
    } else {
        Some(container)
    }
}

fn resolve_download_directory(
    base_path: &str,
    playlist_title: Option<&str>,
    playlist_id: Option<&str>,
) -> String {
    let title = playlist_title
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let id = playlist_id.map(str::trim).filter(|value| !value.is_empty());
    let folder_name = match (title, id) {
        (Some(title), Some(id)) => playlist_folder_name(title, id),
        (None, Some(id)) => playlist_folder_name("Playlist", id),
        (Some(title), None) => sanitize_path_component(title),
        (None, None) => return base_path.to_string(),
    };
    PathBuf::from(base_path)
        .join(folder_name)
        .to_string_lossy()
        .into_owned()
}

fn playlist_folder_name(title: &str, playlist_id: &str) -> String {
    format!(
        "{} [{}]",
        sanitize_path_component(title),
        sanitize_path_component(playlist_id)
    )
}

fn validate_request(request: &StartDownloadRequest) -> Result<(), String> {
    validate_url(&request.url)?;
    if let Some(referer) = request.referer.as_deref() {
        validate_url(referer)?;
    }
    if !matches!(request.media_type.as_str(), "video" | "audio") {
        return Err("Media type must be video or audio".to_string());
    }
    Ok(())
}

fn create_pending_item(
    id: &str,
    created_at: u64,
    request: &StartDownloadRequest,
    settings: &AppSettings,
    plan: &DownloadPlan,
) -> DownloadItem {
    let base_title = request
        .title
        .clone()
        .filter(|title| !title.trim().is_empty())
        .map(|title| stem_for_template(&title))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "Preparing download...".to_string());
    DownloadItem {
        id: id.to_string(),
        url: request.url.clone(),
        referer: request.referer.clone(),
        title: base_title,
        thumbnail: request.thumbnail.clone(),
        uploader: request.uploader.clone(),
        media_type: request.media_type.clone(),
        status: "pending".to_string(),
        progress: DownloadProgress::default(),
        file_path: None,
        file_size: None,
        expected_extension: expected_extension_for_request(request, settings),
        original_request: Some(request.clone()),
        download_directory: Some(plan.directory.clone()),
        output_template: Some(plan.output_template.clone()),
        title_override: None,
        error: None,
        log: String::new(),
        created_at,
        started_at: None,
        completed_at: None,
        duration: request.duration,
        playlist_id: request.playlist_id.clone(),
        playlist_title: request.playlist_title.clone(),
        playlist_url: request.playlist_url.clone(),
    }
}

fn pending_item_from_existing(
    existing: &DownloadItem,
    request: &StartDownloadRequest,
    plan: &DownloadPlan,
) -> DownloadItem {
    let mut pending = existing.clone();
    reset_pending_item(&mut pending);
    pending.original_request = Some(request.clone());
    pending.download_directory = Some(plan.directory.clone());
    pending.output_template = Some(plan.output_template.clone());
    pending
}

fn reset_pending_item(item: &mut DownloadItem) {
    item.status = "pending".to_string();
    item.progress = DownloadProgress::default();
    item.file_path = None;
    item.file_size = None;
    item.error = None;
    item.log.clear();
    item.started_at = None;
    item.completed_at = None;
}

fn is_playlist_active(status: &str) -> bool {
    matches!(status, "pending" | "downloading" | "processing" | "paused")
}

fn reservation_key(
    directory: &str,
    request: &StartDownloadRequest,
    create_uploader_folder: bool,
    suffix: Option<&str>,
) -> PathBuf {
    let mut parent = PathBuf::from(directory);
    if create_uploader_folder {
        if let Some(uploader) = request
            .uploader
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            parent.push(sanitize_path_component(uploader));
        }
    }
    let title = request
        .title
        .as_deref()
        .map(stem_for_template)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "download".to_string());
    let stem = match suffix {
        Some(suffix) => format!("{} [{}]", sanitize_path_component(&title), suffix),
        None => sanitize_path_component(&title),
    };
    parent.join(stem)
}

fn reservation_key_for_item(
    item: &DownloadItem,
    request: &StartDownloadRequest,
) -> Result<PathBuf, String> {
    let directory = item
        .download_directory
        .as_deref()
        .ok_or_else(|| "The download directory is unavailable".to_string())?;
    let output_template = item
        .output_template
        .as_deref()
        .ok_or_else(|| "The output template is unavailable".to_string())?;
    let create_uploader_folder = output_template.starts_with("%(uploader)s/");
    let suffix = output_template
        .contains(&format!("[{}]", item.id))
        .then_some(item.id.as_str());
    Ok(reservation_key(
        directory,
        request,
        create_uploader_folder,
        suffix,
    ))
}

async fn filename_stem_exists(reservation_key: &Path) -> Result<bool, String> {
    let Some(parent) = reservation_key.parent() else {
        return Ok(false);
    };
    if !parent.is_dir() {
        return Ok(false);
    }
    let Some(stem) = reservation_key.file_name().and_then(|value| value.to_str()) else {
        return Ok(false);
    };
    let prefix = format!("{stem}.");
    let mut entries = tokio::fs::read_dir(parent)
        .await
        .map_err(|error| format!("Failed to inspect download directory: {error}"))?;
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("Failed to inspect download directory: {error}"))?
    {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == stem || name.starts_with(&prefix) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn add_id_to_output_template(template: &str, id: &str) -> String {
    if let Some(index) = template.rfind("%(ext)s") {
        let prefix = template[..index].trim_end_matches('.');
        let suffix = &template[index + "%(ext)s".len()..];
        return format!("{prefix} [{id}].%(ext)s{suffix}");
    }
    format!("{template} [{id}]")
}

async fn sync_completed_filename(
    item: &mut DownloadItem,
    title_overrides: &Mutex<HashMap<String, String>>,
) {
    let override_title = title_overrides.lock().await.get(&item.id).cloned();
    let Some(file_path) = item.file_path.clone() else {
        if let Some(title) = override_title {
            item.title = title;
        }
        return;
    };

    if let Some(desired) = override_title {
        match rename_download_file(&file_path, &desired).await {
            Ok(new_path) => {
                item.file_path = Some(new_path.clone());
                item.title = file_name_only(&new_path);
            }
            Err(_) => {
                item.title = file_name_only(&file_path);
            }
        }
    } else {
        item.title = file_name_only(&file_path);
    }

    item.title_override = None;
    if let Some(path) = item.file_path.as_deref() {
        item.file_size = tokio::fs::metadata(path)
            .await
            .ok()
            .map(|metadata| metadata.len());
    }
}

async fn rename_download_file(current_path: &str, desired_name: &str) -> Result<String, String> {
    let current = PathBuf::from(current_path);
    if !current.is_file() {
        return Err("The downloaded file no longer exists".to_string());
    }
    let parent = current
        .parent()
        .ok_or_else(|| "The downloaded file has no parent directory".to_string())?;
    let target_name = build_target_file_name(desired_name, &current);
    let target = parent.join(&target_name);
    if target == current {
        return Ok(current_path.to_string());
    }
    if target.exists() {
        return Err("A file with that name already exists".to_string());
    }
    tokio::fs::rename(&current, &target)
        .await
        .map_err(|error| format!("Failed to rename file: {error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

fn build_target_file_name(desired_name: &str, current_path: &std::path::Path) -> String {
    let sanitized = sanitize_path_component(desired_name);
    let desired = PathBuf::from(&sanitized);
    let has_media_ext = desired
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(is_media_extension);
    if has_media_ext {
        return sanitized;
    }
    if let Some(extension) = current_path.extension().and_then(|value| value.to_str()) {
        return format!("{sanitized}.{extension}");
    }
    sanitized
}

fn stem_for_template(name: &str) -> String {
    let trimmed = name.trim();
    let path = PathBuf::from(trimmed);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(is_media_extension)
    {
        return path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(trimmed)
            .to_string();
    }
    trimmed.to_string()
}

fn file_name_only(path: &str) -> String {
    PathBuf::from(path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn sanitize_path_component(value: &str) -> String {
    let mut result: String = value
        .trim()
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();
    while result.ends_with('.') || result.ends_with(' ') {
        result.pop();
    }
    while result.starts_with('.') || result.starts_with(' ') {
        result.remove(0);
    }
    if result.is_empty() {
        "download".to_string()
    } else {
        result
    }
}

fn is_media_extension(extension: &str) -> bool {
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "mp3"
            | "m4a"
            | "aac"
            | "flac"
            | "wav"
            | "opus"
            | "ogg"
            | "wma"
            | "mp4"
            | "mkv"
            | "webm"
            | "mov"
            | "avi"
            | "flv"
            | "m4v"
            | "ts"
            | "m2ts"
    )
}

fn find_ancestor_named(path: &std::path::Path, name: &str) -> Option<PathBuf> {
    let mut current = path.parent()?;
    loop {
        if current
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value == name)
        {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}

fn append_javascript_runtime(app: &AppHandle, args: &mut Vec<String>) {
    if let Ok(deno_path) = resolve_binary(app, BinaryKind::Deno) {
        args.extend([
            "--js-runtimes".to_string(),
            format!("deno:{}", deno_path.to_string_lossy()),
        ]);
    }
}

fn format_selector(quality: &str) -> String {
    if quality == "best" {
        return "bestvideo*+bestaudio/best".to_string();
    }
    format!("bestvideo*[height<={quality}]+bestaudio/best[height<={quality}]/best")
}

fn process_output_line(item: &mut DownloadItem, line: &str) {
    if let Some(progress) = line.strip_prefix("vetch-progress:") {
        let fields: Vec<&str> = progress.split('|').collect();
        item.progress.percent = fields
            .first()
            .and_then(|value| value.trim().trim_end_matches('%').parse::<f64>().ok())
            .unwrap_or(item.progress.percent);
        item.progress.speed = clean_optional_field(fields.get(1).copied());
        item.progress.eta = clean_optional_field(fields.get(2).copied());
        item.progress.downloaded_bytes = parse_optional_u64(fields.get(3).copied());
        item.progress.total_bytes = parse_optional_u64(fields.get(4).copied());
        if item.progress.percent >= 100.0 {
            item.status = "processing".to_string();
        }
        return;
    }
    if let Some(file_path) = line.strip_prefix("vetch-file:") {
        item.file_path = Some(file_path.trim().to_string());
        item.status = "processing".to_string();
        return;
    }
    append_log(item, line);
}

fn clean_optional_field(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "NA" && *value != "Unknown")
        .map(ToOwned::to_owned)
}

fn parse_optional_u64(value: Option<&str>) -> Option<u64> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "NA")
        .and_then(|value| value.parse::<u64>().ok())
}

fn append_log(item: &mut DownloadItem, line: &str) {
    if line.trim().is_empty() {
        return;
    }
    if !item.log.is_empty() {
        item.log.push('\n');
    }
    item.log.push_str(line);
    if item.log.len() > LOG_LIMIT {
        let mut start = item.log.len() - LOG_LIMIT;
        while !item.log.is_char_boundary(start) {
            start += 1;
        }
        item.log = item.log[start..].to_string();
    }
}

async fn read_lines<R>(reader: R, sender: mpsc::Sender<String>)
where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if sender.send(line).await.is_err() {
            break;
        }
    }
}

async fn finish_cancelled(
    app: &AppHandle,
    storage: &Storage,
    item: &mut DownloadItem,
    title_overrides: &Mutex<HashMap<String, String>>,
) {
    item.status = "cancelled".to_string();
    item.completed_at = Some(timestamp_millis());
    apply_title_override(item, title_overrides).await;
    let _ = storage.upsert_history(item.clone()).await;
    emit_item(app, item, title_overrides).await;
}

async fn finish_with_error(
    app: &AppHandle,
    storage: &Storage,
    item: &mut DownloadItem,
    error: String,
    title_overrides: &Mutex<HashMap<String, String>>,
) {
    append_log(item, &error);
    item.status = "error".to_string();
    item.error = Some(error);
    item.completed_at = Some(timestamp_millis());
    apply_title_override(item, title_overrides).await;
    let _ = storage.upsert_history(item.clone()).await;
    emit_item(app, item, title_overrides).await;
}

async fn apply_title_override(
    item: &mut DownloadItem,
    title_overrides: &Mutex<HashMap<String, String>>,
) {
    if let Some(title) = title_overrides.lock().await.get(&item.id) {
        item.title = title.clone();
        item.title_override = Some(title.clone());
    }
}

async fn emit_item(
    app: &AppHandle,
    item: &DownloadItem,
    title_overrides: &Mutex<HashMap<String, String>>,
) {
    let mut next = item.clone();
    apply_title_override(&mut next, title_overrides).await;
    let _ = app.emit("download-updated", next);
}

fn parse_media_info(value: &Value, requested_url: &str) -> Result<MediaInfo, String> {
    let entries_value = value.get("entries").and_then(Value::as_array);
    let is_playlist = value.get("_type").and_then(Value::as_str) == Some("playlist")
        || entries_value.is_some_and(|entries| !entries.is_empty());
    let id = string_field(value, "id").unwrap_or_else(|| requested_url.to_string());
    let title = string_field(value, "title").unwrap_or_else(|| "Untitled media".to_string());
    let url = string_field(value, "webpage_url").unwrap_or_else(|| requested_url.to_string());

    let entries = entries_value
        .map(|values| {
            values
                .iter()
                .filter_map(|entry| parse_playlist_entry(entry, requested_url))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if is_playlist && entries.is_empty() {
        return Err("No downloadable items were found in this playlist".to_string());
    }

    let formats = value
        .get("formats")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(parse_format).collect())
        .unwrap_or_default();

    Ok(MediaInfo {
        id,
        title,
        url,
        thumbnail: thumbnail_field(value),
        duration: number_field(value, "duration"),
        uploader: string_field(value, "uploader").or_else(|| string_field(value, "channel")),
        description: string_field(value, "description"),
        is_playlist,
        entries,
        formats,
    })
}

fn parse_playlist_entry(value: &Value, playlist_url: &str) -> Option<PlaylistEntry> {
    let id = string_field(value, "id")?;
    let raw_url = string_field(value, "webpage_url")
        .or_else(|| string_field(value, "original_url"))
        .or_else(|| string_field(value, "url"));
    let url = match raw_url {
        Some(url) if url.starts_with("http://") || url.starts_with("https://") => url,
        _ if string_field(value, "ie_key").as_deref() == Some("Youtube") => {
            format!("https://www.youtube.com/watch?v={id}")
        }
        _ => playlist_url.to_string(),
    };
    Some(PlaylistEntry {
        id,
        title: string_field(value, "title").unwrap_or_else(|| "Untitled media".to_string()),
        url,
        thumbnail: thumbnail_field(value),
        duration: number_field(value, "duration"),
    })
}

fn parse_format(value: &Value) -> Option<MediaFormat> {
    Some(MediaFormat {
        id: string_field(value, "format_id")?,
        extension: string_field(value, "ext").unwrap_or_default(),
        width: value.get("width").and_then(Value::as_u64),
        height: value.get("height").and_then(Value::as_u64),
        fps: number_field(value, "fps"),
        video_codec: string_field(value, "vcodec"),
        audio_codec: string_field(value, "acodec"),
        file_size: value
            .get("filesize")
            .and_then(Value::as_u64)
            .or_else(|| value.get("filesize_approx").and_then(Value::as_u64)),
        note: string_field(value, "format_note"),
    })
}

fn thumbnail_field(value: &Value) -> Option<String> {
    string_field(value, "thumbnail").or_else(|| {
        value
            .get("thumbnails")
            .and_then(Value::as_array)
            .and_then(|values| values.last())
            .and_then(|thumbnail| string_field(thumbnail, "url"))
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn number_field(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn validate_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        return Ok(());
    }
    Err("Enter a valid http or https URL".to_string())
}

fn clean_error(stderr: &str) -> String {
    stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().trim_start_matches("ERROR: ").to_string())
        .unwrap_or_else(|| "yt-dlp could not read this URL".to_string())
}

fn last_log_line(log: &str) -> Option<String> {
    log.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().trim_start_matches("ERROR: ").to_string())
}

#[derive(Clone, Copy)]
enum BinaryKind {
    YtDlp,
    Ffmpeg,
    Deno,
}

fn resolve_binary(app: &AppHandle, kind: BinaryKind) -> Result<PathBuf, String> {
    let environment_name = match kind {
        BinaryKind::YtDlp => "VETCH_YTDLP_PATH",
        BinaryKind::Ffmpeg => "VETCH_FFMPEG_PATH",
        BinaryKind::Deno => "VETCH_DENO_PATH",
    };
    if let Ok(path) = std::env::var(environment_name) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let file_name = binary_file_name(kind);
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend([
            resource_dir.join("bin").join(file_name),
            resource_dir.join("resources").join("bin").join(file_name),
        ]);
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("resources").join("bin").join(file_name));
    candidates.push(
        manifest_dir
            .join("../../desktop/resources")
            .join(original_resource_file_name(kind)),
    );
    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return Ok(path);
    }

    let command_name = match kind {
        BinaryKind::YtDlp => {
            if cfg!(windows) {
                "yt-dlp.exe"
            } else {
                "yt-dlp"
            }
        }
        BinaryKind::Ffmpeg => {
            if cfg!(windows) {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            }
        }
        BinaryKind::Deno => {
            if cfg!(windows) {
                "deno.exe"
            } else {
                "deno"
            }
        }
    };
    if let Some(path) = executable_in_path(command_name) {
        return Ok(path);
    }

    let label = match kind {
        BinaryKind::YtDlp => "yt-dlp",
        BinaryKind::Ffmpeg => "FFmpeg",
        BinaryKind::Deno => "Deno",
    };
    Err(format!(
        "{label} was not found. Run `pnpm --filter vetch setup` before starting Vetch."
    ))
}

fn binary_file_name(kind: BinaryKind) -> &'static str {
    match kind {
        BinaryKind::YtDlp if cfg!(windows) => "yt-dlp.exe",
        BinaryKind::YtDlp => "yt-dlp",
        BinaryKind::Ffmpeg if cfg!(windows) => "ffmpeg.exe",
        BinaryKind::Ffmpeg => "ffmpeg",
        BinaryKind::Deno if cfg!(windows) => "deno.exe",
        BinaryKind::Deno => "deno",
    }
}

fn original_resource_file_name(kind: BinaryKind) -> &'static str {
    match kind {
        BinaryKind::YtDlp if cfg!(target_os = "macos") => "yt-dlp_macos",
        BinaryKind::YtDlp if cfg!(windows) => "yt-dlp.exe",
        BinaryKind::YtDlp => "yt-dlp_linux",
        BinaryKind::Ffmpeg if cfg!(windows) => "ffmpeg/ffmpeg.exe",
        BinaryKind::Ffmpeg => "ffmpeg/ffmpeg",
        BinaryKind::Deno if cfg!(windows) => "deno.exe",
        BinaryKind::Deno => "deno",
    }
}

fn executable_in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{
        add_id_to_output_template, append_preferred_title, append_referer, build_target_file_name,
        filename_stem_exists, format_selector, parse_media_info, process_output_line,
        resolve_download_directory,
    };
    use crate::models::{DownloadItem, DownloadProgress};
    use std::path::PathBuf;

    #[test]
    fn builds_bounded_quality_selector() {
        assert_eq!(
            format_selector("1080"),
            "bestvideo*[height<=1080]+bestaudio/best[height<=1080]/best"
        );
    }

    #[test]
    fn includes_source_referer_for_detected_media() {
        let mut args = Vec::new();
        append_referer(&mut args, Some("https://example.com/watch"));
        assert_eq!(args, vec!["--referer", "https://example.com/watch"]);
    }

    #[test]
    fn forces_preferred_title_for_filename_template() {
        let mut args = Vec::new();
        append_preferred_title(&mut args, Some("Episode 12: Final Fight"));
        assert_eq!(
            args,
            vec![
                "--replace-in-metadata",
                "title",
                r"^[\s\S]*$",
                "Episode 12: Final Fight"
            ]
        );

        let mut with_extension = Vec::new();
        append_preferred_title(&mut with_extension, Some("Track Name.mp3"));
        assert_eq!(
            with_extension,
            vec!["--replace-in-metadata", "title", r"^[\s\S]*$", "Track Name"]
        );

        let mut skipped = Vec::new();
        append_preferred_title(&mut skipped, Some("Untitled media"));
        append_preferred_title(&mut skipped, Some("   "));
        assert!(skipped.is_empty());
    }

    #[test]
    fn isolates_playlist_instances_in_sanitized_folders() {
        assert_eq!(
            resolve_download_directory(
                "/downloads",
                Some("My Playlist / Live"),
                Some("instance:1")
            ),
            "/downloads/My Playlist _ Live [instance_1]"
        );
        assert_ne!(
            resolve_download_directory("/downloads", Some("Playlist"), Some("instance-1")),
            resolve_download_directory("/downloads", Some("Playlist"), Some("instance-2"))
        );
        assert_eq!(
            resolve_download_directory("/downloads", None, None),
            "/downloads"
        );
    }

    #[test]
    fn adds_download_id_before_the_extension_placeholder() {
        assert_eq!(
            add_id_to_output_template("%(title)s.%(ext)s", "download-1"),
            "%(title)s [download-1].%(ext)s"
        );
        assert_eq!(
            add_id_to_output_template("%(uploader)s/%(title)s.%(ext)s", "download-1"),
            "%(uploader)s/%(title)s [download-1].%(ext)s"
        );
    }

    #[tokio::test]
    async fn detects_existing_final_and_partial_filenames() {
        let directory = tempfile::tempdir().unwrap();
        let key = directory.path().join("Episode 1");
        assert!(!filename_stem_exists(&key).await.unwrap());
        tokio::fs::write(directory.path().join("Episode 1.mp4.part"), b"partial")
            .await
            .unwrap();
        assert!(filename_stem_exists(&key).await.unwrap());
    }

    #[test]
    fn builds_target_file_name_preserving_extension() {
        let current = PathBuf::from("/downloads/old.mp3");
        assert_eq!(
            build_target_file_name("new title", &current),
            "new title.mp3"
        );
        assert_eq!(
            build_target_file_name("new title.m4a", &current),
            "new title.m4a"
        );
    }

    #[test]
    fn parses_single_video_information() {
        let value = serde_json::json!({
            "id": "abc",
            "title": "A video",
            "webpage_url": "https://example.com/watch/abc",
            "duration": 42.0,
            "formats": [{"format_id": "1", "ext": "mp4", "height": 720}]
        });
        let info = parse_media_info(&value, "https://example.com/watch/abc").unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.title, "A video");
        assert_eq!(info.formats.len(), 1);
    }

    #[test]
    fn parses_playlist_identity_and_entries() {
        let value = serde_json::json!({
            "_type": "playlist",
            "id": "playlist-1",
            "title": "A playlist",
            "entries": [
                {
                    "id": "video-1",
                    "title": "First video",
                    "ie_key": "Youtube"
                }
            ]
        });

        let info = parse_media_info(&value, "https://example.com/playlist").unwrap();

        assert!(info.is_playlist);
        assert_eq!(info.id, "playlist-1");
        assert_eq!(info.entries.len(), 1);
        assert_eq!(
            info.entries[0].url,
            "https://www.youtube.com/watch?v=video-1"
        );
    }

    #[test]
    fn parses_download_progress_and_processing_state() {
        let mut item = DownloadItem {
            id: "test".to_string(),
            url: "https://example.com/video".to_string(),
            referer: None,
            title: "Test".to_string(),
            thumbnail: None,
            uploader: None,
            media_type: "video".to_string(),
            status: "downloading".to_string(),
            progress: DownloadProgress::default(),
            file_path: None,
            file_size: None,
            expected_extension: Some("mp4".to_string()),
            original_request: None,
            download_directory: None,
            output_template: None,
            title_override: None,
            error: None,
            log: String::new(),
            created_at: 0,
            started_at: None,
            completed_at: None,
            duration: None,
            playlist_id: None,
            playlist_title: None,
            playlist_url: None,
        };

        process_output_line(
            &mut item,
            "vetch-progress:100.0%|4.07MiB/s|00:00|3086521|3086521",
        );

        assert_eq!(item.progress.percent, 100.0);
        assert_eq!(item.progress.speed.as_deref(), Some("4.07MiB/s"));
        assert_eq!(item.progress.downloaded_bytes, Some(3_086_521));
        assert_eq!(item.status, "processing");
    }
}
