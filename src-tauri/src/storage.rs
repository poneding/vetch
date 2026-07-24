use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::models::{AppSettings, DownloadItem};

const PLAYLIST_ACTIVE_STATUSES: [&str; 4] = ["pending", "downloading", "processing", "paused"];

#[derive(Clone)]
pub struct Storage {
    data_dir: PathBuf,
    settings_lock: Arc<Mutex<()>>,
    history_lock: Arc<Mutex<()>>,
}

impl Storage {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            settings_lock: Arc::new(Mutex::new(())),
            history_lock: Arc::new(Mutex::new(())),
        }
    }

    fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    fn history_path(&self) -> PathBuf {
        self.data_dir.join("history.json")
    }

    pub async fn get_settings(&self, app: &AppHandle) -> Result<AppSettings, String> {
        let _guard = self.settings_lock.lock().await;
        let mut settings = read_json::<AppSettings>(&self.settings_path())
            .await?
            .unwrap_or_default()
            .normalize();
        if settings.download_path.trim().is_empty() {
            settings.download_path = app
                .path()
                .download_dir()
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .into_owned();
        }
        Ok(settings)
    }

    pub async fn save_settings(
        &self,
        app: &AppHandle,
        settings: AppSettings,
    ) -> Result<AppSettings, String> {
        let _guard = self.settings_lock.lock().await;
        let mut normalized = settings.normalize();
        if normalized.download_path.trim().is_empty() {
            normalized.download_path = app
                .path()
                .download_dir()
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .into_owned();
        }
        tokio::fs::create_dir_all(&normalized.download_path)
            .await
            .map_err(|error| format!("Failed to create download directory: {error}"))?;
        write_json(&self.settings_path(), &normalized).await?;
        Ok(normalized)
    }

    pub async fn get_history(&self) -> Result<Vec<DownloadItem>, String> {
        let _guard = self.history_lock.lock().await;
        Ok(read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default())
    }

    pub async fn get_history_item(&self, id: &str) -> Result<Option<DownloadItem>, String> {
        let _guard = self.history_lock.lock().await;
        let history = read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default();
        Ok(history.into_iter().find(|item| item.id == id))
    }

    pub async fn upsert_history(&self, item: DownloadItem) -> Result<(), String> {
        let _guard = self.history_lock.lock().await;
        let mut history = read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default();
        upsert_item(&mut history, item);
        write_json(&self.history_path(), &history).await
    }

    /// Replace one existing row in a single locked history write.
    pub async fn transition_history_item(
        &self,
        id: &str,
        allowed_statuses: &[&str],
        replacement: DownloadItem,
    ) -> Result<(), String> {
        let _guard = self.history_lock.lock().await;
        let mut history = read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default();
        let existing = history
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| "Download history item was not found".to_string())?;
        if !allowed_statuses.contains(&existing.status.as_str()) {
            return Err(format!(
                "Download cannot transition from status {}",
                existing.status
            ));
        }
        if replacement.id != id {
            return Err("Replacement download id does not match history item".to_string());
        }
        *existing = replacement;
        sort_history(&mut history);
        write_json(&self.history_path(), &history).await
    }

    pub async fn remove_history_item(&self, id: &str) -> Result<(), String> {
        let _guard = self.history_lock.lock().await;
        let mut history = read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default();
        history.retain(|item| item.id != id);
        write_json(&self.history_path(), &history).await
    }

    pub async fn rename_history_item(
        &self,
        id: &str,
        title: &str,
        file_path: Option<String>,
        title_override: Option<String>,
    ) -> Result<Option<DownloadItem>, String> {
        let _guard = self.history_lock.lock().await;
        let mut history = read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default();
        let Some(item) = history.iter_mut().find(|entry| entry.id == id) else {
            return Ok(None);
        };
        item.title = title.to_string();
        item.title_override = title_override;
        if let Some(path) = file_path {
            item.file_path = Some(path);
        }
        let renamed = item.clone();
        write_json(&self.history_path(), &history).await?;
        Ok(Some(renamed))
    }

    pub async fn rename_playlist_history(
        &self,
        playlist_id: &str,
        playlist_title: &str,
        old_folder: Option<&Path>,
        new_folder: Option<&Path>,
    ) -> Result<Vec<DownloadItem>, String> {
        let _guard = self.history_lock.lock().await;
        let mut history = read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default();
        if history.iter().any(|item| {
            item.playlist_id.as_deref() == Some(playlist_id)
                && PLAYLIST_ACTIVE_STATUSES.contains(&item.status.as_str())
        }) {
            return Err("A playlist with active downloads cannot be renamed".to_string());
        }

        let mut updated = Vec::new();
        for item in &mut history {
            if item.playlist_id.as_deref() != Some(playlist_id) {
                continue;
            }
            item.playlist_title = Some(playlist_title.to_string());
            if let (Some(old_folder), Some(new_folder)) = (old_folder, new_folder) {
                if let Some(file_path) = item.file_path.as_ref() {
                    if let Some(next_path) = rewrite_path_prefix(file_path, old_folder, new_folder)
                    {
                        item.file_path = Some(next_path);
                    }
                }
                if let Some(download_directory) = item.download_directory.as_ref() {
                    if let Some(next_path) =
                        rewrite_path_prefix(download_directory, old_folder, new_folder)
                    {
                        item.download_directory = Some(next_path);
                    }
                }
            }
            updated.push(item.clone());
        }
        if !updated.is_empty() {
            write_json(&self.history_path(), &history).await?;
        }
        Ok(updated)
    }

    pub async fn clear_finished_history(&self) -> Result<(), String> {
        let _guard = self.history_lock.lock().await;
        let mut history = read_json::<Vec<DownloadItem>>(&self.history_path())
            .await?
            .unwrap_or_default();
        history.retain(|item| !matches!(item.status.as_str(), "completed" | "error" | "cancelled"));
        write_json(&self.history_path(), &history).await
    }
}

fn upsert_item(history: &mut Vec<DownloadItem>, item: DownloadItem) {
    if let Some(existing) = history.iter_mut().find(|entry| entry.id == item.id) {
        *existing = item;
    } else {
        history.push(item);
    }
    sort_history(history);
}

fn sort_history(history: &mut [DownloadItem]) {
    history.sort_by_key(|item| std::cmp::Reverse(item.created_at));
}

fn rewrite_path_prefix(path: &str, old_folder: &Path, new_folder: &Path) -> Option<String> {
    let current = Path::new(path);
    if !current.starts_with(old_folder) {
        return None;
    }
    let relative = current.strip_prefix(old_folder).ok()?;
    Some(new_folder.join(relative).to_string_lossy().into_owned())
}

async fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = tokio::fs::read_to_string(path)
        .await
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

async fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let path = path.to_path_buf();
    let path_display = path.display().to_string();
    let contents = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to serialize data: {error}"))?;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| format!("Failed to create temporary data file: {error}"))?;
        temporary
            .write_all(&contents)
            .map_err(|error| format!("Failed to write temporary data file: {error}"))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| format!("Failed to sync temporary data file: {error}"))?;
        temporary
            .persist(&path)
            .map_err(|error| format!("Failed to replace {}: {}", path.display(), error.error))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Failed to write {path_display}: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::Storage;
    use crate::models::{DownloadItem, DownloadProgress, StartDownloadRequest};

    fn request() -> StartDownloadRequest {
        StartDownloadRequest {
            url: "https://example.com/video".to_string(),
            referer: Some("https://example.com/watch".to_string()),
            title: Some("Example".to_string()),
            thumbnail: None,
            uploader: Some("Uploader".to_string()),
            duration: Some(42.0),
            playlist_id: None,
            playlist_title: None,
            playlist_url: None,
            media_type: "video".to_string(),
            quality: Some("1080".to_string()),
            video_container: Some("mkv".to_string()),
            audio_format: None,
            format_id: Some("137".to_string()),
            download_subtitles: Some(true),
            custom_download_path: Some("/custom".to_string()),
            custom_filename_template: Some("%(title)s custom.%(ext)s".to_string()),
            start_time: Some("00:10".to_string()),
            end_time: Some("00:20".to_string()),
        }
    }

    fn item(status: &str) -> DownloadItem {
        DownloadItem {
            id: "download-1".to_string(),
            url: "https://example.com/video".to_string(),
            referer: None,
            title: "Example".to_string(),
            thumbnail: None,
            uploader: None,
            media_type: "video".to_string(),
            status: status.to_string(),
            progress: DownloadProgress::default(),
            file_path: None,
            file_size: None,
            expected_extension: Some("mkv".to_string()),
            original_request: Some(request()),
            download_directory: Some("/custom".to_string()),
            output_template: Some("%(title)s.%(ext)s".to_string()),
            title_override: None,
            error: None,
            log: String::new(),
            created_at: 1,
            started_at: None,
            completed_at: None,
            duration: Some(42.0),
            playlist_id: None,
            playlist_title: None,
            playlist_url: None,
        }
    }

    #[tokio::test]
    async fn persists_the_complete_original_request() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::new(directory.path().to_path_buf());
        storage.upsert_history(item("pending")).await.unwrap();

        let restored = storage
            .get_history_item("download-1")
            .await
            .unwrap()
            .unwrap();
        let restored_request = restored.original_request.unwrap();
        assert_eq!(restored_request.format_id.as_deref(), Some("137"));
        assert_eq!(
            restored_request.custom_download_path.as_deref(),
            Some("/custom")
        );
        assert_eq!(restored_request.start_time.as_deref(), Some("00:10"));
        assert_eq!(restored_request.end_time.as_deref(), Some("00:20"));
    }

    #[tokio::test]
    async fn replaces_a_terminal_row_with_pending_in_one_transition() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::new(directory.path().to_path_buf());
        storage.upsert_history(item("error")).await.unwrap();
        let pending = item("pending");

        storage
            .transition_history_item("download-1", &["error", "cancelled"], pending)
            .await
            .unwrap();

        let history = storage.get_history().await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "download-1");
        assert_eq!(history[0].status, "pending");
        assert_eq!(
            history[0]
                .original_request
                .as_ref()
                .and_then(|request| request.format_id.as_deref()),
            Some("137")
        );
    }

    #[tokio::test]
    async fn rejects_playlist_rename_while_any_item_is_active() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::new(directory.path().to_path_buf());
        let mut playlist_item = item("paused");
        playlist_item.playlist_id = Some("playlist-1".to_string());
        playlist_item.playlist_title = Some("Playlist".to_string());
        storage.upsert_history(playlist_item).await.unwrap();

        let result = storage
            .rename_playlist_history("playlist-1", "Renamed", None, None)
            .await;

        assert!(result.is_err());
        assert_eq!(
            storage
                .get_history_item("download-1")
                .await
                .unwrap()
                .unwrap()
                .playlist_title
                .as_deref(),
            Some("Playlist")
        );
    }

    #[tokio::test]
    async fn rejected_transition_leaves_the_original_row_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::new(directory.path().to_path_buf());
        storage.upsert_history(item("completed")).await.unwrap();

        let result = storage
            .transition_history_item("download-1", &["error", "cancelled"], item("pending"))
            .await;

        assert!(result.is_err());
        assert_eq!(
            storage
                .get_history_item("download-1")
                .await
                .unwrap()
                .unwrap()
                .status,
            "completed"
        );
    }
}
