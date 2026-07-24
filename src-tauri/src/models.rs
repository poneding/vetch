use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub download_path: String,
    pub max_concurrent_downloads: usize,
    pub theme: String,
    pub language: String,
    pub one_click_download: bool,
    pub default_media_type: String,
    pub video_quality: String,
    pub video_container: String,
    pub audio_format: String,
    pub filename_template: String,
    pub create_uploader_folder: bool,
    pub download_subtitles: bool,
    pub embed_subtitles: bool,
    pub embed_metadata: bool,
    pub embed_chapters: bool,
    pub embed_thumbnail: bool,
    pub notifications_enabled: bool,
    pub launch_at_login: bool,
    pub hide_dock_icon: bool,
    pub proxy: String,
    pub cookies_path: String,
    pub config_path: String,
    pub browser_for_cookies: String,
    pub browser_cookies_profile: String,
    pub preferred_audio_language: String,
    pub auto_check_updates: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_path: String::new(),
            max_concurrent_downloads: 3,
            theme: "system".to_string(),
            language: "en".to_string(),
            one_click_download: true,
            default_media_type: "video".to_string(),
            video_quality: "best".to_string(),
            video_container: "auto".to_string(),
            audio_format: "mp3".to_string(),
            filename_template: "%(title)s.%(ext)s".to_string(),
            create_uploader_folder: false,
            download_subtitles: false,
            embed_subtitles: false,
            embed_metadata: true,
            embed_chapters: true,
            embed_thumbnail: false,
            notifications_enabled: true,
            launch_at_login: false,
            hide_dock_icon: false,
            proxy: String::new(),
            cookies_path: String::new(),
            config_path: String::new(),
            browser_for_cookies: "none".to_string(),
            browser_cookies_profile: String::new(),
            preferred_audio_language: String::new(),
            auto_check_updates: true,
        }
    }
}

impl AppSettings {
    pub fn normalize(mut self) -> Self {
        self.max_concurrent_downloads = self.max_concurrent_downloads.clamp(1, 8);
        if !matches!(self.default_media_type.as_str(), "video" | "audio") {
            self.default_media_type = "video".to_string();
        }
        if self.filename_template.trim().is_empty() {
            self.filename_template = Self::default().filename_template;
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub percent: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

impl Default for DownloadProgress {
    fn default() -> Self {
        Self {
            percent: 0.0,
            speed: None,
            eta: None,
            downloaded_bytes: None,
            total_bytes: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub url: String,
    pub referer: Option<String>,
    pub title: String,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
    pub media_type: String,
    pub status: String,
    pub progress: DownloadProgress,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    /// Predicted extension used for in-progress filename display (e.g. "mp3", "mp4").
    #[serde(default)]
    pub expected_extension: Option<String>,
    /// The immutable request used to start, resume, and retry this download.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_request: Option<StartDownloadRequest>,
    /// Exact directory and output template selected before the first attempt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_template: Option<String>,
    /// A requested display/file rename applied only after a paused download completes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_override: Option<String>,
    pub error: Option<String>,
    pub log: String,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub duration: Option<f64>,
    pub playlist_id: Option<String>,
    pub playlist_title: Option<String>,
    /// Original playlist page URL for manual refresh (追更).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playlist_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadRequest {
    pub url: String,
    pub referer: Option<String>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub playlist_id: Option<String>,
    pub playlist_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playlist_url: Option<String>,
    pub media_type: String,
    pub quality: Option<String>,
    pub video_container: Option<String>,
    pub audio_format: Option<String>,
    pub format_id: Option<String>,
    pub download_subtitles: Option<bool>,
    pub custom_download_path: Option<String>,
    pub custom_filename_template: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFormat {
    pub id: String,
    pub extension: String,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub file_size: Option<u64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub url: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub id: String,
    pub title: String,
    pub url: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub description: Option<String>,
    pub is_playlist: bool,
    pub entries: Vec<PlaylistEntry>,
    pub formats: Vec<MediaFormat>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub version: String,
    pub platform: String,
    pub architecture: String,
    pub yt_dlp_ready: bool,
    pub ffmpeg_ready: bool,
}

#[cfg(test)]
mod tests {
    use super::AppSettings;

    #[test]
    fn fills_new_settings_fields_when_loading_older_data() {
        let settings: AppSettings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();

        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.default_media_type, "video");
        assert!(!settings.launch_at_login);
        assert!(!settings.hide_dock_icon);
        assert!(settings.embed_chapters);
        assert!(settings.auto_check_updates);
    }

    #[test]
    fn normalizes_invalid_default_media_type_to_video() {
        let settings = AppSettings {
            default_media_type: "unknown".to_string(),
            ..AppSettings::default()
        }
        .normalize();

        assert_eq!(settings.default_media_type, "video");
    }
}
