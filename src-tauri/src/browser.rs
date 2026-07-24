use std::collections::{hash_map::DefaultHasher, HashMap};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalSize, Rect, State, Theme,
    Url, Webview, WebviewUrl, Window, WindowEvent,
};

const BROWSER_CONTENT_LABEL: &str = "browser-content";
const BROWSER_MEDIA_PANEL_LABEL: &str = "browser-media-panel";
const BROWSER_TOOLBAR_LABEL: &str = "browser-toolbar";
const BROWSER_WINDOW_LABEL: &str = "browser";
const BROWSER_PREFERENCES_EVENT: &str = "vetch-browser-preferences-changed";
const FOCUS_ADDRESS_EVENT: &str = "vetch-focus-address";
const TOOLBAR_HEIGHT: f64 = 44.0;
/// macOS title-bar height under Tauri's default FullSizeContentView layout.
/// Webview y=0 is the top of the window, not below the traffic lights, so the
/// toolbar must start under this inset or the address bar is clipped.
#[cfg(target_os = "macos")]
const WINDOW_TOP_INSET: f64 = 28.0;
#[cfg(not(target_os = "macos"))]
const WINDOW_TOP_INSET: f64 = 0.0;
const MEDIA_PANEL_DEFAULT_WIDTH: f64 = 360.0;
const MEDIA_PANEL_MAX_WIDTH: f64 = 480.0;
const MEDIA_PANEL_MIN_WIDTH: f64 = 300.0;
const BROWSER_CONTENT_MIN_WIDTH: f64 = 420.0;
const BROWSER_RESIZE_INTERVAL: Duration = Duration::from_millis(16);
const BROWSER_WINDOW_WIDTH: f64 = 1180.0;
const BROWSER_WINDOW_HEIGHT: f64 = 800.0;
#[cfg(target_os = "macos")]
const BROWSER_DATA_STORE_IDENTIFIER: [u8; 16] = *b"VetchBrowserV3!!";
#[cfg(target_os = "macos")]
const SAFARI_INFO_PATHS: [&str; 2] = [
    "/Applications/Safari.app/Contents/Info",
    "/System/Applications/Safari.app/Contents/Info",
];
#[cfg(target_os = "macos")]
const SAFARI_USER_AGENT_PREFIX: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/605.1.15 (KHTML, like Gecko)";

#[derive(Debug, Clone, Copy, PartialEq)]
struct BrowserLayout {
    toolbar_x: f64,
    toolbar_y: f64,
    toolbar_width: f64,
    toolbar_height: f64,
    content_x: f64,
    content_y: f64,
    content_width: f64,
    content_height: f64,
    panel_x: f64,
    panel_y: f64,
    panel_width: f64,
    panel_height: f64,
    panel_open: bool,
}

/// Lay out the browser chrome inside the window content area.
///
/// Coordinates are top-left origin relative to the window content view. On
/// macOS the system title bar occupies the top inset of that view, so the
/// toolbar starts below it and the page webview starts strictly below the
/// toolbar — otherwise the page covers the address bar.
fn browser_layout(
    window_width: f64,
    window_height: f64,
    panel_open: bool,
    panel_width: f64,
    top_inset: f64,
) -> BrowserLayout {
    let top_inset = top_inset.max(0.0);
    let toolbar_y = top_inset;
    let toolbar_height = TOOLBAR_HEIGHT.min((window_height - toolbar_y).max(0.0));
    let content_y = toolbar_y + toolbar_height;
    let content_height = (window_height - content_y).max(0.0);
    let available_panel_width = (window_width - BROWSER_CONTENT_MIN_WIDTH).max(0.0);
    let maximum_panel_width = MEDIA_PANEL_MAX_WIDTH.min(available_panel_width);
    let minimum_panel_width = MEDIA_PANEL_MIN_WIDTH.min(maximum_panel_width);
    let resolved_panel_width = if panel_open {
        panel_width.clamp(minimum_panel_width, maximum_panel_width)
    } else {
        0.0
    };
    let content_width = (window_width - resolved_panel_width).max(0.0);

    BrowserLayout {
        toolbar_x: 0.0,
        toolbar_y,
        toolbar_width: window_width.max(0.0),
        toolbar_height,
        content_x: 0.0,
        content_y,
        content_width,
        content_height,
        panel_x: content_width,
        panel_y: content_y,
        panel_width: resolved_panel_width,
        panel_height: content_height,
        panel_open: panel_open && resolved_panel_width > 0.0,
    }
}
const MAX_CANDIDATES: usize = 40;
const MEDIA_POLL_INTERVAL: Duration = Duration::from_millis(750);
const MEDIA_POLL_SCRIPT: &str = r#"
(() => ({
  pageUrl: ['http:', 'https:'].includes(location.protocol) ? location.href : '',
  title: document.title || '',
  reports: typeof window.__VETCH_DRAIN_MEDIA__ === 'function'
    ? window.__VETCH_DRAIN_MEDIA__()
    : []
}))()
"#;
/// Stop in-page media immediately before the browser window tears down.
///
/// wry's macOS Drop retains the WKWebView, so audio/video can keep playing
/// after the window disappears unless we unload the page first.
const MEDIA_SHUTDOWN_SCRIPT: &str = r#"
(() => {
  try {
    for (const el of document.querySelectorAll('video, audio')) {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch (_) {}
    }
    if (typeof window.stop === 'function') window.stop();
  } catch (_) {}
})()
"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaReport {
    url: String,
    page_url: Option<String>,
    title: Option<String>,
    mime_type: Option<String>,
    kind: Option<String>,
    source: String,
    duration: Option<f64>,
    content_length: Option<u64>,
    is_playing: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserPollPayload {
    page_url: String,
    title: String,
    reports: Vec<BrowserMediaReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaCandidate {
    pub id: String,
    pub url: String,
    pub page_url: String,
    pub title: String,
    pub mime_type: Option<String>,
    pub kind: String,
    pub source: String,
    pub duration: Option<f64>,
    pub content_length: Option<u64>,
    pub score: i32,
    pub detected_at: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStateSnapshot {
    pub page_url: String,
    pub title: String,
    pub loading: bool,
    pub media_panel_open: bool,
    pub candidates: Vec<BrowserMediaCandidate>,
}

struct BrowserStateData {
    page_url: String,
    title: String,
    loading: bool,
    media_panel_open: bool,
    media_panel_width: f64,
    /// Full URL of the in-app start page so empty address submissions can return home.
    home_url: Option<String>,
    language: String,
    theme: String,
    candidates: HashMap<String, BrowserMediaCandidate>,
}

impl Default for BrowserStateData {
    fn default() -> Self {
        Self {
            page_url: String::new(),
            title: String::new(),
            loading: false,
            media_panel_open: false,
            media_panel_width: MEDIA_PANEL_DEFAULT_WIDTH,
            home_url: None,
            language: "en".to_string(),
            theme: "system".to_string(),
            candidates: HashMap::new(),
        }
    }
}

#[derive(Default)]
pub struct BrowserState(Mutex<BrowserStateData>);

#[derive(Clone, Copy)]
struct BrowserResizeRequest {
    size: PhysicalSize<u32>,
}

#[derive(Default)]
struct BrowserResizeData {
    pending: Mutex<Option<BrowserResizeRequest>>,
    scheduled: AtomicBool,
    last_layout: Mutex<Option<BrowserLayout>>,
}

#[derive(Clone, Default)]
pub struct BrowserResizeState(Arc<BrowserResizeData>);

impl BrowserResizeState {
    fn reset(&self) {
        self.0
            .pending
            .lock()
            .expect("browser resize state lock poisoned")
            .take();
        self.0
            .last_layout
            .lock()
            .expect("browser resize state lock poisoned")
            .take();
    }
}

impl BrowserState {
    fn snapshot(&self) -> BrowserStateSnapshot {
        let data = self.0.lock().expect("browser state lock poisoned");
        snapshot_from_data(&data)
    }

    fn media_panel_open(&self) -> bool {
        self.0
            .lock()
            .expect("browser state lock poisoned")
            .media_panel_open
    }

    /// The current page URL as a parsed URL, if it is a real web page (not the in-app start view).
    fn current_page_url(&self) -> Option<Url> {
        let page_url = self
            .0
            .lock()
            .expect("browser state lock poisoned")
            .page_url
            .clone();
        parse_web_url(&page_url).ok()
    }

    fn media_panel_width(&self) -> f64 {
        self.0
            .lock()
            .expect("browser state lock poisoned")
            .media_panel_width
    }

    fn reset(&self) -> BrowserStateSnapshot {
        let mut data = self.0.lock().expect("browser state lock poisoned");
        *data = BrowserStateData::default();
        snapshot_from_data(&data)
    }

    fn set_preferences(&self, language: &str, theme: &str) {
        let mut data = self.0.lock().expect("browser state lock poisoned");
        data.language = language.to_string();
        data.theme = theme.to_string();
    }

    fn remember_home_url(&self, home_url: String) {
        let mut data = self.0.lock().expect("browser state lock poisoned");
        data.home_url = Some(home_url);
    }

    fn home_navigation_target(&self) -> Result<Url, String> {
        let data = self.0.lock().expect("browser state lock poisoned");
        if let Some(home_url) = data.home_url.as_deref() {
            return Url::parse(home_url).map_err(|_| "Invalid browser start URL".to_string());
        }
        browser_start_app_url(&data.language, &data.theme)
    }

    fn update_page(
        &self,
        page_url: String,
        title: Option<String>,
        loading: bool,
    ) -> BrowserStateSnapshot {
        let mut data = self.0.lock().expect("browser state lock poisoned");
        let page_changed = data.page_url != page_url;
        data.page_url = page_url;
        data.loading = loading;
        if let Some(title) = title {
            data.title = clean_text(&title, 300);
        } else if page_changed {
            data.title.clear();
        }
        if page_changed {
            data.candidates.clear();
        }
        snapshot_from_data(&data)
    }

    fn set_title(&self, title: String) -> BrowserStateSnapshot {
        let mut data = self.0.lock().expect("browser state lock poisoned");
        data.title = clean_text(&title, 300);
        snapshot_from_data(&data)
    }

    fn set_panel_open(&self, open: bool) -> BrowserStateSnapshot {
        let mut data = self.0.lock().expect("browser state lock poisoned");
        data.media_panel_open = open;
        snapshot_from_data(&data)
    }

    fn set_panel_width(&self, width: f64) -> Result<(), String> {
        if !width.is_finite() {
            return Err("The media panel width must be a finite number".to_string());
        }
        self.0
            .lock()
            .expect("browser state lock poisoned")
            .media_panel_width = width.clamp(MEDIA_PANEL_MIN_WIDTH, MEDIA_PANEL_MAX_WIDTH);
        Ok(())
    }

    fn clear_candidates(&self) -> BrowserStateSnapshot {
        let mut data = self.0.lock().expect("browser state lock poisoned");
        data.candidates.clear();
        snapshot_from_data(&data)
    }

    fn upsert_candidate(
        &self,
        report: BrowserMediaReport,
    ) -> Result<(BrowserMediaCandidate, BrowserStateSnapshot), String> {
        let media_url = parse_web_url(&report.url)?;
        if media_url.as_str().len() > 8192 || is_media_segment(&media_url) {
            return Err("This media URL is not a downloadable stream candidate".to_string());
        }

        let mime_type = report
            .mime_type
            .as_deref()
            .map(|value| clean_text(value, 120))
            .filter(|value| !value.is_empty());
        let kind = classify_media(&media_url, mime_type.as_deref(), report.kind.as_deref())
            .ok_or_else(|| "The detected resource is not recognized media".to_string())?;

        let mut data = self.0.lock().expect("browser state lock poisoned");
        let page_url = report
            .page_url
            .as_deref()
            .and_then(|value| parse_web_url(value).ok())
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| data.page_url.clone());
        let title = report
            .title
            .as_deref()
            .map(|value| clean_text(value, 300))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| data.title.clone());
        let score = candidate_score(
            &kind,
            media_url.as_str(),
            mime_type.as_deref(),
            &report.source,
            report.duration,
            report.is_playing.unwrap_or(false),
            &page_url,
        );
        let id = candidate_id(media_url.as_str());
        let duration = report
            .duration
            .filter(|value| value.is_finite() && *value > 0.0);
        let content_length = report.content_length.filter(|value| *value > 0);
        let mut candidate = BrowserMediaCandidate {
            id: id.clone(),
            url: media_url.to_string(),
            page_url,
            title,
            mime_type,
            kind,
            source: clean_text(&report.source, 80),
            duration,
            content_length,
            score,
            detected_at: timestamp_millis(),
        };

        if let Some(existing) = data.candidates.get(&id) {
            if candidate.score < existing.score {
                // Keep the higher-ranked candidate, but fill in newly observed metadata.
                let mut merged = existing.clone();
                if merged.duration.is_none() {
                    merged.duration = candidate.duration;
                }
                if merged.content_length.is_none() {
                    merged.content_length = candidate.content_length;
                }
                if merged.title.trim().is_empty() && !candidate.title.trim().is_empty() {
                    merged.title = candidate.title;
                }
                data.candidates.insert(id, merged.clone());
                trim_candidates(&mut data.candidates);
                return Ok((merged, snapshot_from_data(&data)));
            }
            if candidate.duration.is_none() {
                candidate.duration = existing.duration;
            }
            if candidate.content_length.is_none() {
                candidate.content_length = existing.content_length;
            }
            if candidate.title.trim().is_empty() && !existing.title.trim().is_empty() {
                candidate.title = existing.title.clone();
            }
        }
        data.candidates.insert(id, candidate.clone());
        trim_candidates(&mut data.candidates);
        Ok((candidate, snapshot_from_data(&data)))
    }

    fn candidate(&self, id: &str) -> Option<BrowserMediaCandidate> {
        self.0
            .lock()
            .expect("browser state lock poisoned")
            .candidates
            .get(id)
            .cloned()
    }
}

fn snapshot_from_data(data: &BrowserStateData) -> BrowserStateSnapshot {
    let mut candidates: Vec<_> = data.candidates.values().cloned().collect();
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.detected_at.cmp(&left.detected_at))
    });
    BrowserStateSnapshot {
        page_url: data.page_url.clone(),
        title: data.title.clone(),
        loading: data.loading,
        media_panel_open: data.media_panel_open,
        candidates,
    }
}

fn trim_candidates(candidates: &mut HashMap<String, BrowserMediaCandidate>) {
    while candidates.len() > MAX_CANDIDATES {
        let Some(id) = candidates
            .values()
            .min_by_key(|candidate| (candidate.score, candidate.detected_at))
            .map(|candidate| candidate.id.clone())
        else {
            break;
        };
        candidates.remove(&id);
    }
}

fn parse_web_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "Invalid browser URL".to_string())?;
    if matches!(url.scheme(), "http" | "https") {
        Ok(url)
    } else {
        Err("Only HTTP and HTTPS browser URLs are allowed".to_string())
    }
}

fn is_allowed_browser_navigation(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "tauri" | "about" | "blob")
}

/// Registrable domain approximated as the last two host labels (e.g. `www.site.com` -> `site.com`).
/// Good enough to tell an ad-network popunder apart from the site's own popups without a public
/// suffix list; multi-part TLDs (`co.uk`) over-match toward same-site, which errs on not breaking
/// legitimate in-site navigation rather than on letting hijacks through.
fn registrable_domain(url: &Url) -> Option<String> {
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() <= 2 {
        return Some(host);
    }
    Some(labels[labels.len() - 2..].join("."))
}

/// Whether a popup/`window.open` target belongs to the same site as the page that opened it.
/// Cross-site popups are the ad-hijack vector, so only same-site ones are allowed to drive the
/// main content view.
fn is_same_site_popup(current: &Url, target: &Url) -> bool {
    match (registrable_domain(current), registrable_domain(target)) {
        (Some(current_domain), Some(target_domain)) => current_domain == target_domain,
        _ => false,
    }
}

fn browser_start_path(language: &str, theme: &str) -> String {
    format!("index.html?view=browser-start&lang={language}&theme={theme}")
}

fn is_browser_start_url(url: &Url) -> bool {
    url.query_pairs()
        .any(|(key, value)| key == "view" && value == "browser-start")
}

fn display_page_url(url: &Url) -> String {
    if is_browser_start_url(url) || !matches!(url.scheme(), "http" | "https") {
        String::new()
    } else {
        url.to_string()
    }
}

/// Fallback when the start page has not loaded yet (dev server or packaged asset origin).
fn browser_start_app_url(language: &str, theme: &str) -> Result<Url, String> {
    let path = browser_start_path(language, theme);
    // Prefer the packaged asset protocol; in dev the first page-load remembers the real origin.
    Url::parse(&format!("tauri://localhost/{path}"))
        .or_else(|_| Url::parse(&format!("http://127.0.0.1:1420/{path}")))
        .map_err(|_| "Invalid browser start URL".to_string())
}

fn normalize_browser_input(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter a website address".to_string());
    }
    if let Ok(url) = parse_web_url(trimmed) {
        return Ok(url);
    }
    if !trimmed.contains(char::is_whitespace) && trimmed.contains('.') {
        return parse_web_url(&format!("https://{trimmed}"));
    }
    Url::parse_with_params("https://www.google.com/search", &[("q", trimmed)])
        .map_err(|_| "Invalid browser search".to_string())
}

fn classify_media(url: &Url, mime_type: Option<&str>, hint: Option<&str>) -> Option<String> {
    let path = url.path().to_ascii_lowercase();
    let mime = mime_type.unwrap_or_default().to_ascii_lowercase();
    if path.ends_with(".m3u8") || mime.contains("mpegurl") {
        return Some("hls".to_string());
    }
    if path.ends_with(".mpd") || mime.contains("dash+xml") {
        return Some("dash".to_string());
    }
    if mime.starts_with("video/")
        || [".mp4", ".webm", ".mov", ".mkv", ".ogv"]
            .iter()
            .any(|extension| path.ends_with(extension))
    {
        return Some("video".to_string());
    }
    if mime.starts_with("audio/")
        || [".m4a", ".mp3", ".aac", ".ogg", ".opus", ".wav", ".flac"]
            .iter()
            .any(|extension| path.ends_with(extension))
    {
        return Some("audio".to_string());
    }
    hint.filter(|value| matches!(*value, "hls" | "dash" | "video" | "audio"))
        .map(ToOwned::to_owned)
}

fn is_media_segment(url: &Url) -> bool {
    let path = url.path().to_ascii_lowercase();
    [".ts", ".m4s", ".cmfv", ".cmfa"]
        .iter()
        .any(|extension| path.ends_with(extension))
}

fn candidate_score(
    kind: &str,
    media_url: &str,
    mime_type: Option<&str>,
    source: &str,
    duration: Option<f64>,
    is_playing: bool,
    page_url: &str,
) -> i32 {
    let mut score = match kind {
        "hls" => 100,
        "dash" => 95,
        "video" => 75,
        _ => 65,
    };
    if is_playing {
        score += 15;
    }
    if mime_type.is_some() {
        score += 10;
    }
    if source.starts_with("dom") {
        score += 8;
    }
    let normalized_url = media_url.to_ascii_lowercase();
    if normalized_url.contains("master") || normalized_url.contains("playlist") {
        score += 8;
    }
    if same_host(media_url, page_url) {
        score += 4;
    }
    if ["/ads/", "advert", "preroll", "promo"]
        .iter()
        .any(|marker| normalized_url.contains(marker))
    {
        score -= 35;
    }
    if duration.is_some_and(|value| value > 0.0 && value < 20.0) {
        score -= 15;
    }
    score.clamp(0, 150)
}

fn same_host(left: &str, right: &str) -> bool {
    let left_host = Url::parse(left)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    let right_host = Url::parse(right)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    left_host.is_some() && left_host == right_host
}

fn candidate_id(url: &str) -> String {
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn clean_text(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(target_os = "macos")]
fn safari_user_agent(version: &str) -> Option<String> {
    let version = version.trim();
    let is_valid_version = !version.is_empty()
        && version.chars().any(|character| character.is_ascii_digit())
        && version
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.');
    if !is_valid_version {
        return None;
    }
    Some(format!(
        "{SAFARI_USER_AGENT_PREFIX} Version/{version} Safari/605.1.15"
    ))
}

#[cfg(target_os = "macos")]
fn system_safari_user_agent() -> Option<String> {
    for info_path in SAFARI_INFO_PATHS {
        let Ok(output) = Command::new("/usr/bin/defaults")
            .args(["read", info_path, "CFBundleShortVersionString"])
            .output()
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let Ok(version) = String::from_utf8(output.stdout) else {
            continue;
        };
        if let Some(user_agent) = safari_user_agent(&version) {
            return Some(user_agent);
        }
    }
    None
}

fn emit_state(app: &AppHandle, snapshot: &BrowserStateSnapshot) {
    let _ = app.emit_to(BROWSER_TOOLBAR_LABEL, "browser-state-changed", snapshot);
    let _ = app.emit_to(BROWSER_MEDIA_PANEL_LABEL, "browser-state-changed", snapshot);
    let _ = app.emit_to("main", "browser-state-changed", snapshot);
}

fn update_page_state(app: &AppHandle, url: &Url, title: Option<String>, loading: bool) {
    let state = app.state::<BrowserState>();
    if is_browser_start_url(url) {
        state.remember_home_url(url.to_string());
    }
    let snapshot = state.update_page(display_page_url(url), title, loading);
    emit_state(app, &snapshot);
}

fn process_browser_poll(app: &AppHandle, raw_payload: &str) {
    let Ok(payload) = serde_json::from_str::<BrowserPollPayload>(raw_payload) else {
        return;
    };
    if payload.page_url.is_empty() {
        return;
    }
    let Ok(page_url) = parse_web_url(&payload.page_url) else {
        return;
    };
    let state = app.state::<BrowserState>();
    if is_browser_start_url(&page_url) {
        state.remember_home_url(page_url.to_string());
    }
    let mut snapshot = state.update_page(display_page_url(&page_url), Some(payload.title), false);
    for report in payload.reports {
        if let Ok((_candidate, updated_snapshot)) = state.upsert_candidate(report) {
            snapshot = updated_snapshot;
        }
    }
    emit_state(app, &snapshot);
}

#[cfg(target_os = "macos")]
fn remove_content_user_scripts(content: &Webview) -> Result<(), String> {
    content
        .with_webview(|platform_webview| unsafe {
            // The controller pointer is owned by the live WKWebView and this runs on its main thread.
            let controller: &objc2_web_kit::WKUserContentController =
                &*platform_webview.controller().cast();
            controller.removeAllUserScripts();
            controller.removeAllScriptMessageHandlers();
        })
        .map_err(|error| error.to_string())
}

/// macOS WKWebView defaults to an opaque white surface. Disable that paint and set
/// under-page color so dark chrome never flashes white before the HTML paints.
#[cfg(target_os = "macos")]
fn apply_macos_webview_background(webview: &Webview, color: Color) {
    use objc2::runtime::{AnyObject, NSObject};
    use objc2_app_kit::NSColor;
    use objc2_foundation::{ns_string, NSNumber, NSObjectNSKeyValueCoding};

    let Color(red, green, blue, alpha) = color;
    let _ = webview.with_webview(move |platform_webview| unsafe {
        let view: &objc2_web_kit::WKWebView = &*platform_webview.inner().cast();
        // Private KVC: stop WKWebView from drawing its default white background.
        let no = NSNumber::numberWithBool(false);
        let object: &NSObject = &*(std::ptr::from_ref(view).cast::<NSObject>());
        object.setValue_forKey(Some(&*no as &AnyObject), ns_string!("drawsBackground"));
        let ns_color = NSColor::colorWithSRGBRed_green_blue_alpha(
            f64::from(red) / 255.0,
            f64::from(green) / 255.0,
            f64::from(blue) / 255.0,
            f64::from(alpha) / 255.0,
        );
        // Public API (macOS 12+): color shown before page paint / overscroll.
        view.setUnderPageBackgroundColor(Some(&ns_color));
    });
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_webview_background(_webview: &Webview, _color: Color) {}

fn start_browser_polling(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(MEDIA_POLL_INTERVAL);
        loop {
            interval.tick().await;
            if app.get_window(BROWSER_WINDOW_LABEL).is_none() {
                break;
            }
            let Some(content) = app.get_webview(BROWSER_CONTENT_LABEL) else {
                continue;
            };
            let callback_app = app.clone();
            let _ = content.eval_with_callback(MEDIA_POLL_SCRIPT, move |raw_payload| {
                process_browser_poll(&callback_app, &raw_payload);
            });
        }
    });
}

fn ensure_webview(webview: &Webview, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&webview.label()) {
        Ok(())
    } else {
        Err("This command is not available from the current view".to_string())
    }
}

fn set_media_panel_open_state(app: &AppHandle, open: bool) -> Result<(), String> {
    let snapshot = app.state::<BrowserState>().set_panel_open(open);
    let window = app
        .get_window(BROWSER_WINDOW_LABEL)
        .ok_or_else(|| "The media browser is not open".to_string())?;
    let resize_state = app.state::<BrowserResizeState>();
    resize_browser_webviews_if_changed(
        app,
        window.inner_size().map_err(|error| error.to_string())?,
        open,
        &resize_state,
    );
    if let Some(panel) = app.get_webview(BROWSER_MEDIA_PANEL_LABEL) {
        if open {
            panel.show().map_err(|error| error.to_string())?;
        } else {
            panel.hide().map_err(|error| error.to_string())?;
        }
    }
    emit_state(app, &snapshot);
    Ok(())
}

fn toggle_media_panel(app: &AppHandle) -> Result<(), String> {
    let open = !app.state::<BrowserState>().media_panel_open();
    set_media_panel_open_state(app, open)
}

fn focus_browser_address(app: &AppHandle) -> Result<(), String> {
    let toolbar = app
        .get_webview(BROWSER_TOOLBAR_LABEL)
        .ok_or_else(|| "The media browser is not open".to_string())?;
    toolbar.set_focus().map_err(|error| error.to_string())?;
    let event_name =
        serde_json::to_string(FOCUS_ADDRESS_EVENT).map_err(|error| error.to_string())?;
    toolbar
        .eval(format!("window.dispatchEvent(new Event({event_name}));"))
        .map_err(|error| error.to_string())
}

/// Handle in-page shortcut bridges (`vetch://toggle-media`) from the content webview.
/// Returns true when the URL was a shortcut bridge and navigation/popup should be denied.
fn handle_browser_content_shortcut(app: &AppHandle, url: &Url) -> bool {
    if url.scheme() != "vetch" {
        return false;
    }
    let action = url.host_str().unwrap_or("").to_ascii_lowercase();
    match action.as_str() {
        "toggle-media" => {
            let _ = toggle_media_panel(app);
        }
        "focus-address" => {
            let _ = focus_browser_address(app);
        }
        _ => {}
    }
    true
}

fn browser_theme(theme: &str) -> Option<Theme> {
    match theme {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// Frontend tokens used before webviews paint so dark mode never flashes white.
/// Keep these aligned with `src/styles.css` (`--background`, `--surface`,
/// `--browser-media-background`).
const BROWSER_DARK_BACKGROUND: Color = Color(0x11, 0x13, 0x17, 255);
const BROWSER_DARK_SURFACE: Color = Color(0x18, 0x1b, 0x20, 255);
const BROWSER_DARK_MEDIA_PANEL: Color = Color(0x28, 0x23, 0x2f, 255);
const BROWSER_LIGHT_BACKGROUND: Color = Color(0xff, 0xff, 0xff, 255);
const BROWSER_LIGHT_SURFACE: Color = Color(0xf7, 0xf8, 0xfa, 255);
const BROWSER_LIGHT_MEDIA_PANEL: Color = Color(0xfa, 0xf8, 0xff, 255);

#[derive(Clone, Copy)]
struct BrowserChromeColors {
    window: Color,
    content: Color,
    toolbar: Color,
    media_panel: Color,
}

fn system_prefers_dark(app: &AppHandle) -> bool {
    // Prefer the live main window theme so "system" matches what the user already sees.
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(theme) = main.theme() {
            return matches!(theme, Theme::Dark);
        }
    }
    if let Some(browser) = app.get_window(BROWSER_WINDOW_LABEL) {
        if let Ok(theme) = browser.theme() {
            return matches!(theme, Theme::Dark);
        }
    }
    false
}

fn browser_is_dark(app: &AppHandle, theme: &str) -> bool {
    match theme {
        "dark" => true,
        "light" => false,
        _ => system_prefers_dark(app),
    }
}

fn browser_chrome_colors(app: &AppHandle, theme: &str) -> BrowserChromeColors {
    if browser_is_dark(app, theme) {
        BrowserChromeColors {
            window: BROWSER_DARK_BACKGROUND,
            content: BROWSER_DARK_BACKGROUND,
            toolbar: BROWSER_DARK_SURFACE,
            media_panel: BROWSER_DARK_MEDIA_PANEL,
        }
    } else {
        BrowserChromeColors {
            window: BROWSER_LIGHT_BACKGROUND,
            content: BROWSER_LIGHT_BACKGROUND,
            toolbar: BROWSER_LIGHT_SURFACE,
            media_panel: BROWSER_LIGHT_MEDIA_PANEL,
        }
    }
}

/// Injected before page scripts so toolbar/panel/start views apply the URL theme
/// without waiting for the Vite module graph.
fn browser_theme_bootstrap_script(theme: &str) -> String {
    let theme = match theme {
        "light" | "dark" => theme,
        _ => "system",
    };
    // Use r## so JS color literals like "#111317" do not terminate the raw string.
    format!(
        r##"(function () {{
  try {{
    var theme = {theme:?};
    var prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = theme === "dark" || (theme === "system" && prefersDark);
    var root = document.documentElement;
    var params = new URLSearchParams(window.location.search);
    var view = params.get("view") || "";
    var pageBackground = dark ? "#111317" : "#ffffff";
    var surfaceBackground = dark ? "#181b20" : "#f7f8fa";
    var mediaBackground = dark ? "#28232f" : "#faf8ff";
    var background = pageBackground;
    if (view === "browser-toolbar") {{
      background = surfaceBackground;
    }} else if (view === "browser-media-panel") {{
      background = mediaBackground;
    }}
    root.classList.toggle("dark", dark);
    root.classList.toggle("light", !dark);
    if (view) {{
      root.setAttribute("data-view", view);
    }}
    root.style.colorScheme = dark ? "dark" : "light";
    root.style.background = background;
    if (document.body) {{
      document.body.style.background = background;
      document.body.style.colorScheme = dark ? "dark" : "light";
    }}
  }} catch (_error) {{}}
}})();"##
    )
}

fn apply_browser_chrome_colors(app: &AppHandle, colors: BrowserChromeColors) {
    if let Some(window) = app.get_window(BROWSER_WINDOW_LABEL) {
        let _ = window.set_background_color(Some(colors.window));
    }
    if let Some(webview) = app.get_webview(BROWSER_CONTENT_LABEL) {
        let _ = webview.set_background_color(Some(colors.content));
        apply_macos_webview_background(&webview, colors.content);
    }
    if let Some(webview) = app.get_webview(BROWSER_TOOLBAR_LABEL) {
        let _ = webview.set_background_color(Some(colors.toolbar));
        apply_macos_webview_background(&webview, colors.toolbar);
    }
    if let Some(webview) = app.get_webview(BROWSER_MEDIA_PANEL_LABEL) {
        let _ = webview.set_background_color(Some(colors.media_panel));
        apply_macos_webview_background(&webview, colors.media_panel);
    }
}

pub fn apply_browser_preferences(
    app: &AppHandle,
    language: &str,
    theme: &str,
) -> Result<(), String> {
    let language = if language == "zh-CN" { "zh-CN" } else { "en" };
    let theme = if matches!(theme, "light" | "dark") {
        theme
    } else {
        "system"
    };
    let Some(window) = app.get_window(BROWSER_WINDOW_LABEL) else {
        return Ok(());
    };

    window
        .set_theme(browser_theme(theme))
        .map_err(|error| error.to_string())?;
    // Always resolve a concrete color, including theme=system, so macOS WKWebView
    // never falls back to its default white under-page background.
    apply_browser_chrome_colors(app, browser_chrome_colors(app, theme));

    let event_name =
        serde_json::to_string(BROWSER_PREFERENCES_EVENT).map_err(|error| error.to_string())?;
    let preferences = serde_json::json!({ "language": language, "theme": theme });
    let script = format!(
        "window.dispatchEvent(new CustomEvent({event_name}, {{ detail: {preferences} }}));"
    );
    for label in [BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL] {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.eval(&script);
        }
    }
    Ok(())
}

fn browser_layout_for_size(
    app: &AppHandle,
    size: PhysicalSize<u32>,
    panel_open: bool,
) -> BrowserLayout {
    let scale_factor = app
        .get_window(BROWSER_WINDOW_LABEL)
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let logical_size = size.to_logical::<f64>(scale_factor);
    browser_layout(
        logical_size.width,
        logical_size.height,
        panel_open,
        app.state::<BrowserState>().media_panel_width(),
        WINDOW_TOP_INSET,
    )
}

fn apply_browser_layout(app: &AppHandle, layout: BrowserLayout) {
    if let Some(toolbar) = app.get_webview(BROWSER_TOOLBAR_LABEL) {
        let _ = toolbar.set_bounds(Rect {
            position: LogicalPosition::new(layout.toolbar_x, layout.toolbar_y).into(),
            size: LogicalSize::new(layout.toolbar_width, layout.toolbar_height).into(),
        });
    }
    if let Some(content) = app.get_webview(BROWSER_CONTENT_LABEL) {
        let _ = content.set_bounds(Rect {
            position: LogicalPosition::new(layout.content_x, layout.content_y).into(),
            size: LogicalSize::new(layout.content_width, layout.content_height).into(),
        });
    }
    if layout.panel_open {
        if let Some(panel) = app.get_webview(BROWSER_MEDIA_PANEL_LABEL) {
            let _ = panel.set_bounds(Rect {
                position: LogicalPosition::new(layout.panel_x, layout.panel_y).into(),
                size: LogicalSize::new(layout.panel_width, layout.panel_height).into(),
            });
        }
    }
}

fn resize_browser_webviews_if_changed(
    app: &AppHandle,
    size: PhysicalSize<u32>,
    panel_open: bool,
    resize_state: &BrowserResizeState,
) {
    let layout = browser_layout_for_size(app, size, panel_open);
    let mut last_layout = resize_state
        .0
        .last_layout
        .lock()
        .expect("browser resize state lock poisoned");
    if last_layout.as_ref() == Some(&layout) {
        return;
    }
    *last_layout = Some(layout);
    drop(last_layout);
    apply_browser_layout(app, layout);
}

fn schedule_browser_resize(window: &Window, size: PhysicalSize<u32>) {
    let resize_state = window.state::<BrowserResizeState>().inner().clone();
    let request = BrowserResizeRequest { size };
    *resize_state
        .0
        .pending
        .lock()
        .expect("browser resize state lock poisoned") = Some(request);
    if resize_state.0.scheduled.swap(true, Ordering::AcqRel) {
        return;
    }

    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(BROWSER_RESIZE_INTERVAL).await;
            let request = resize_state
                .0
                .pending
                .lock()
                .expect("browser resize state lock poisoned")
                .take();
            if let Some(request) = request {
                let current_size = app
                    .get_window(BROWSER_WINDOW_LABEL)
                    .and_then(|browser_window| browser_window.inner_size().ok())
                    .unwrap_or(request.size);
                let panel_open = app.state::<BrowserState>().media_panel_open();
                resize_browser_webviews_if_changed(&app, current_size, panel_open, &resize_state);
                continue;
            }

            resize_state.0.scheduled.store(false, Ordering::Release);
            let has_pending = resize_state
                .0
                .pending
                .lock()
                .expect("browser resize state lock poisoned")
                .is_some();
            if has_pending && !resize_state.0.scheduled.swap(true, Ordering::AcqRel) {
                continue;
            }
            break;
        }
    });
}

/// Pause media and unload the content page so playback cannot continue after close.
fn shutdown_browser_media(app: &AppHandle) {
    let Some(content) = app.get_webview(BROWSER_CONTENT_LABEL) else {
        return;
    };

    // Pause local media elements first so audio stops even if navigation is delayed.
    let _ = content.eval(MEDIA_SHUTDOWN_SCRIPT);

    #[cfg(target_os = "macos")]
    {
        // Native pause covers PiP / Media Session cases JS may miss before unload.
        let _ = content.with_webview(|platform_webview| unsafe {
            let view: &objc2_web_kit::WKWebView = &*platform_webview.inner().cast();
            view.pauseAllMediaPlaybackWithCompletionHandler(None);
            view.closeAllMediaPresentationsWithCompletionHandler(None);
        });
    }

    // Unload the page (including cross-origin iframe players) so retained WKWebViews
    // cannot keep streaming after the window is gone.
    if let Ok(blank) = Url::parse("about:blank") {
        let _ = content.navigate(blank);
    }
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != BROWSER_WINDOW_LABEL {
        return;
    }
    match event {
        WindowEvent::Resized(size) => schedule_browser_resize(window, *size),
        WindowEvent::CloseRequested { .. } => {
            shutdown_browser_media(window.app_handle());
            window.state::<BrowserResizeState>().reset();
            let snapshot = window.state::<BrowserState>().reset();
            emit_state(window.app_handle(), &snapshot);
        }
        WindowEvent::Destroyed => {
            window.state::<BrowserResizeState>().reset();
            let snapshot = window.state::<BrowserState>().reset();
            emit_state(window.app_handle(), &snapshot);
        }
        _ => {}
    }
}

#[tauri::command]
pub fn open_media_browser(
    app: AppHandle,
    webview: Webview,
    language: String,
    theme: String,
    title: String,
) -> Result<(), String> {
    ensure_webview(&webview, &["main"])?;
    let language = if language == "zh-CN" { "zh-CN" } else { "en" };
    let theme = if matches!(theme.as_str(), "light" | "dark") {
        theme.as_str()
    } else {
        "system"
    };
    if let Some(window) = app.get_window(BROWSER_WINDOW_LABEL) {
        app.state::<BrowserState>().set_preferences(language, theme);
        apply_browser_preferences(&app, language, theme)?;
        window
            .set_title(&clean_text(&title, 120))
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let snapshot = app.state::<BrowserState>().reset();
    app.state::<BrowserState>().set_preferences(language, theme);
    emit_state(&app, &snapshot);
    let toolbar_path = PathBuf::from(format!(
        "index.html?view=browser-toolbar&lang={language}&theme={theme}"
    ));
    let media_panel_path = PathBuf::from(format!(
        "index.html?view=browser-media-panel&lang={language}&theme={theme}"
    ));
    let start_path = PathBuf::from(browser_start_path(language, theme));
    // Resolve colors before creating chrome so system+dark never opens on white.
    let colors = browser_chrome_colors(&app, theme);

    // Keep the window hidden until child webviews exist with matching backgrounds.
    // Otherwise the first frame is an empty native surface (often white).
    let window = WindowBuilder::new(&app, BROWSER_WINDOW_LABEL)
        .title(clean_text(&title, 120))
        .inner_size(BROWSER_WINDOW_WIDTH, BROWSER_WINDOW_HEIGHT)
        .min_inner_size(760.0, 560.0)
        .maximizable(true)
        .center()
        .visible(false)
        .theme(browser_theme(theme))
        .background_color(colors.window)
        .visible_on_all_workspaces(true)
        .build()
        .map_err(|error| error.to_string())?;

    let new_window_app = app.clone();
    let navigation_app = app.clone();
    let page_load_app = app.clone();
    let title_app = app.clone();
    let download_app = app.clone();
    let theme_bootstrap = browser_theme_bootstrap_script(theme);
    let content = WebviewBuilder::new(BROWSER_CONTENT_LABEL, WebviewUrl::App(start_path))
        .initialization_script(&theme_bootstrap)
        .background_color(colors.content);
    #[cfg(target_os = "macos")]
    let content = content.data_store_identifier(BROWSER_DATA_STORE_IDENTIFIER);
    #[cfg(target_os = "macos")]
    let content = match system_safari_user_agent() {
        Some(user_agent) => content.user_agent(&user_agent),
        None => content,
    };
    #[cfg(not(target_os = "macos"))]
    let content = content.initialization_script_for_all_frames(include_str!("browser_detector.js"));
    let content = content
        .on_navigation(move |url| {
            if handle_browser_content_shortcut(&navigation_app, url) {
                return false;
            }
            is_allowed_browser_navigation(url)
        })
        .on_new_window(move |url, _features| {
            // Shortcut bridges from the content page (e.g. Cmd/Ctrl+B) open a vetch:// URL so
            // the host can toggle chrome without navigating away from the media page.
            if handle_browser_content_shortcut(&new_window_app, &url) {
                return NewWindowResponse::Deny;
            }
            // Popups drive the single content view since this browser has no tabs, but a
            // cross-site popup is the ad-network popunder/hijack vector (e.g. a video "play"
            // click that opens an ad domain). Only let same-site popups take over the page;
            // deny cross-site ones so the user stays on the video they were watching.
            if matches!(url.scheme(), "http" | "https") {
                let current = new_window_app.state::<BrowserState>().current_page_url();
                let allow = match current {
                    Some(current) => is_same_site_popup(&current, &url),
                    // No page loaded yet (e.g. popup from the start page): allow it through.
                    None => true,
                };
                if allow {
                    if let Some(content) = new_window_app.get_webview(BROWSER_CONTENT_LABEL) {
                        let _ = content.navigate(url.clone());
                    }
                }
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |webview, payload| {
            let loading = payload.event() == PageLoadEvent::Started;
            update_page_state(&page_load_app, payload.url(), None, loading);
            #[cfg(target_os = "macos")]
            if !loading && matches!(payload.url().scheme(), "http" | "https") {
                let _ = webview.eval(include_str!("browser_detector.js"));
            }
        })
        .on_document_title_changed(move |_webview, page_title| {
            let snapshot = title_app.state::<BrowserState>().set_title(page_title);
            emit_state(&title_app, &snapshot);
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { url, .. } = event {
                let report = BrowserMediaReport {
                    url: url.to_string(),
                    page_url: None,
                    title: None,
                    mime_type: None,
                    kind: None,
                    source: "download".to_string(),
                    duration: None,
                    content_length: None,
                    is_playing: Some(false),
                };
                if let Ok((_candidate, snapshot)) = download_app
                    .state::<BrowserState>()
                    .upsert_candidate(report)
                {
                    emit_state(&download_app, &snapshot);
                }
            }
            false
        });
    let initial_layout = browser_layout(
        BROWSER_WINDOW_WIDTH,
        BROWSER_WINDOW_HEIGHT,
        false,
        MEDIA_PANEL_DEFAULT_WIDTH,
        WINDOW_TOP_INSET,
    );
    window
        .add_child(
            content,
            LogicalPosition::new(initial_layout.content_x, initial_layout.content_y),
            LogicalSize::new(initial_layout.content_width, initial_layout.content_height),
        )
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let content = app
            .get_webview(BROWSER_CONTENT_LABEL)
            .ok_or_else(|| "The media browser content view was not created".to_string())?;
        remove_content_user_scripts(&content)?;
    }
    let media_panel =
        WebviewBuilder::new(BROWSER_MEDIA_PANEL_LABEL, WebviewUrl::App(media_panel_path))
            .initialization_script(&theme_bootstrap)
            .background_color(colors.media_panel);
    window
        .add_child(
            media_panel,
            LogicalPosition::new(
                BROWSER_WINDOW_WIDTH - MEDIA_PANEL_DEFAULT_WIDTH,
                initial_layout.panel_y,
            ),
            LogicalSize::new(MEDIA_PANEL_DEFAULT_WIDTH, initial_layout.panel_height),
        )
        .map_err(|error| error.to_string())?;
    if let Some(panel) = app.get_webview(BROWSER_MEDIA_PANEL_LABEL) {
        panel.hide().map_err(|error| error.to_string())?;
    }

    let toolbar = WebviewBuilder::new(BROWSER_TOOLBAR_LABEL, WebviewUrl::App(toolbar_path))
        .initialization_script(&theme_bootstrap)
        .background_color(colors.toolbar);
    window
        .add_child(
            toolbar,
            LogicalPosition::new(initial_layout.toolbar_x, initial_layout.toolbar_y),
            LogicalSize::new(initial_layout.toolbar_width, initial_layout.toolbar_height),
        )
        .map_err(|error| error.to_string())?;
    // Re-apply after children attach: some platforms ignore the builder color until the
    // native view exists, and toolbar/panel need surface colors (not just page bg).
    apply_browser_chrome_colors(&app, colors);
    let resize_state = app.state::<BrowserResizeState>();
    resize_browser_webviews_if_changed(
        &app,
        window.inner_size().map_err(|error| error.to_string())?,
        false,
        &resize_state,
    );
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    start_browser_polling(app);
    Ok(())
}

#[tauri::command]
pub fn get_browser_state(
    webview: Webview,
    state: State<'_, BrowserState>,
) -> Result<BrowserStateSnapshot, String> {
    ensure_webview(
        &webview,
        &["main", BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    Ok(state.snapshot())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, webview: Webview, input: String) -> Result<(), String> {
    ensure_webview(&webview, &[BROWSER_TOOLBAR_LABEL])?;
    let url = if input.trim().is_empty() {
        // Empty address bar returns to the in-app browser start page.
        app.state::<BrowserState>().home_navigation_target()?
    } else {
        normalize_browser_input(&input)?
    };
    app.get_webview(BROWSER_CONTENT_LABEL)
        .ok_or_else(|| "The media browser is not open".to_string())?
        .navigate(url)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_back(app: AppHandle, webview: Webview) -> Result<(), String> {
    ensure_webview(
        &webview,
        &[BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    app.get_webview(BROWSER_CONTENT_LABEL)
        .ok_or_else(|| "The media browser is not open".to_string())?
        .eval("history.back()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_forward(app: AppHandle, webview: Webview) -> Result<(), String> {
    ensure_webview(
        &webview,
        &[BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    app.get_webview(BROWSER_CONTENT_LABEL)
        .ok_or_else(|| "The media browser is not open".to_string())?
        .eval("history.forward()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_reload(app: AppHandle, webview: Webview) -> Result<(), String> {
    ensure_webview(
        &webview,
        &[BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    app.get_webview(BROWSER_CONTENT_LABEL)
        .ok_or_else(|| "The media browser is not open".to_string())?
        .reload()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_focus_address(app: AppHandle, webview: Webview) -> Result<(), String> {
    ensure_webview(
        &webview,
        &[BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    focus_browser_address(&app)
}

#[tauri::command]
pub fn set_browser_media_panel_open(
    app: AppHandle,
    webview: Webview,
    open: bool,
) -> Result<(), String> {
    ensure_webview(
        &webview,
        &[BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    set_media_panel_open_state(&app, open)
}

#[tauri::command]
pub fn set_browser_media_panel_width(
    app: AppHandle,
    webview: Webview,
    state: State<'_, BrowserState>,
    width: f64,
) -> Result<(), String> {
    ensure_webview(&webview, &[BROWSER_MEDIA_PANEL_LABEL])?;
    state.set_panel_width(width)?;
    let window = app
        .get_window(BROWSER_WINDOW_LABEL)
        .ok_or_else(|| "The media browser is not open".to_string())?;
    let resize_state = app.state::<BrowserResizeState>();
    resize_browser_webviews_if_changed(
        &app,
        window.inner_size().map_err(|error| error.to_string())?,
        state.media_panel_open(),
        &resize_state,
    );
    Ok(())
}

#[tauri::command]
pub fn clear_browser_media(
    app: AppHandle,
    webview: Webview,
    state: State<'_, BrowserState>,
) -> Result<(), String> {
    ensure_webview(
        &webview,
        &[BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    let snapshot = state.clear_candidates();
    emit_state(&app, &snapshot);
    Ok(())
}

#[tauri::command]
pub fn select_browser_media(
    app: AppHandle,
    webview: Webview,
    state: State<'_, BrowserState>,
    id: String,
) -> Result<(), String> {
    ensure_webview(
        &webview,
        &[BROWSER_TOOLBAR_LABEL, BROWSER_MEDIA_PANEL_LABEL],
    )?;
    let candidate = state
        .candidate(&id)
        .ok_or_else(|| "The detected media is no longer available".to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|error| error.to_string())?;
        main.unminimize().map_err(|error| error.to_string())?;
        main.set_focus().map_err(|error| error.to_string())?;
    }
    app.emit_to("main", "browser-media-selected", candidate)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::safari_user_agent;
    use super::{
        browser_layout, browser_theme, browser_theme_bootstrap_script, candidate_score,
        classify_media, display_page_url, is_allowed_browser_navigation, is_browser_start_url,
        is_media_segment, is_same_site_popup, normalize_browser_input, BROWSER_DARK_BACKGROUND,
        BROWSER_DARK_SURFACE, BROWSER_LIGHT_BACKGROUND, BROWSER_WINDOW_HEIGHT,
        BROWSER_WINDOW_WIDTH, MEDIA_PANEL_DEFAULT_WIDTH, TOOLBAR_HEIGHT,
    };
    use tauri::{Theme, Url};

    #[test]
    fn maps_browser_theme_preferences_to_native_window_themes() {
        assert_eq!(browser_theme("light"), Some(Theme::Light));
        assert_eq!(browser_theme("dark"), Some(Theme::Dark));
        assert_eq!(browser_theme("system"), None);
        // Native tokens must stay aligned with styles.css to avoid a first-frame flash.
        assert_eq!(BROWSER_DARK_BACKGROUND, tauri::window::Color(0x11, 0x13, 0x17, 255));
        assert_eq!(BROWSER_DARK_SURFACE, tauri::window::Color(0x18, 0x1b, 0x20, 255));
        assert_eq!(BROWSER_LIGHT_BACKGROUND, tauri::window::Color(0xff, 0xff, 0xff, 255));
        let dark_bootstrap = browser_theme_bootstrap_script("dark");
        assert!(dark_bootstrap.contains("#111317"));
        assert!(dark_bootstrap.contains("#181b20"));
        assert!(dark_bootstrap.contains("browser-toolbar"));
        assert!(dark_bootstrap.contains("classList.toggle(\"light\""));
    }

    #[test]
    fn keeps_toolbar_above_content_so_address_bar_is_not_clipped() {
        let layout = browser_layout(
            BROWSER_WINDOW_WIDTH,
            BROWSER_WINDOW_HEIGHT,
            false,
            MEDIA_PANEL_DEFAULT_WIDTH,
            0.0,
        );

        assert_eq!(layout.toolbar_y, 0.0);
        assert_eq!(layout.toolbar_height, TOOLBAR_HEIGHT);
        assert_eq!(layout.content_y, TOOLBAR_HEIGHT);
        assert_eq!(
            layout.content_height,
            BROWSER_WINDOW_HEIGHT - TOOLBAR_HEIGHT
        );
        assert!(layout.content_y + 0.001 >= layout.toolbar_y + layout.toolbar_height);
        assert!(!layout.panel_open);
        assert_eq!(layout.panel_width, 0.0);
    }

    #[test]
    fn offsets_toolbar_below_macos_title_bar_inset() {
        let top_inset = 28.0;
        let layout = browser_layout(
            BROWSER_WINDOW_WIDTH,
            BROWSER_WINDOW_HEIGHT,
            false,
            MEDIA_PANEL_DEFAULT_WIDTH,
            top_inset,
        );

        assert_eq!(layout.toolbar_y, top_inset);
        assert_eq!(layout.toolbar_height, TOOLBAR_HEIGHT);
        assert_eq!(layout.content_y, top_inset + TOOLBAR_HEIGHT);
        assert_eq!(
            layout.content_height,
            BROWSER_WINDOW_HEIGHT - top_inset - TOOLBAR_HEIGHT
        );
        // Page content must never start inside the toolbar band.
        assert!(layout.content_y >= layout.toolbar_y + layout.toolbar_height - 0.001);
    }

    #[test]
    fn reserves_media_panel_width_without_covering_toolbar() {
        let layout = browser_layout(
            BROWSER_WINDOW_WIDTH,
            BROWSER_WINDOW_HEIGHT,
            true,
            MEDIA_PANEL_DEFAULT_WIDTH,
            28.0,
        );

        assert_eq!(layout.toolbar_width, BROWSER_WINDOW_WIDTH);
        assert_eq!(layout.toolbar_height, TOOLBAR_HEIGHT);
        assert_eq!(layout.toolbar_y, 28.0);
        assert_eq!(layout.panel_y, 28.0 + TOOLBAR_HEIGHT);
        assert_eq!(layout.panel_width, MEDIA_PANEL_DEFAULT_WIDTH);
        assert_eq!(
            layout.content_width + layout.panel_width,
            BROWSER_WINDOW_WIDTH
        );
        assert!(layout.panel_open);
    }

    #[test]
    fn classifies_manifests_and_media_responses() {
        let hls = Url::parse("https://cdn.example.com/master.m3u8?token=1").unwrap();
        let dash = Url::parse("https://cdn.example.com/stream?id=1").unwrap();
        let video = Url::parse("https://cdn.example.com/video").unwrap();

        assert_eq!(classify_media(&hls, None, None).as_deref(), Some("hls"));
        assert_eq!(
            classify_media(&dash, Some("application/dash+xml"), None).as_deref(),
            Some("dash")
        );
        assert_eq!(
            classify_media(&video, Some("video/mp4"), None).as_deref(),
            Some("video")
        );
        let page = Url::parse("https://example.com/watch/123").unwrap();
        assert_eq!(
            classify_media(&page, None, Some("video")).as_deref(),
            Some("video")
        );
    }

    #[test]
    fn rejects_segments_and_ranks_playing_manifests_first() {
        let segment = Url::parse("https://cdn.example.com/chunk-10.m4s").unwrap();
        assert!(is_media_segment(&segment));
        let manifest_score = candidate_score(
            "hls",
            "https://cdn.example.com/master.m3u8",
            Some("application/vnd.apple.mpegurl"),
            "fetch",
            Some(600.0),
            true,
            "https://example.com/watch",
        );
        let preview_score = candidate_score(
            "video",
            "https://example.com/ads/preview.mp4",
            Some("video/mp4"),
            "performance",
            Some(10.0),
            false,
            "https://example.com/watch",
        );
        assert!(manifest_score > preview_score);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn builds_a_safari_user_agent_from_the_installed_version() {
        assert_eq!(
            safari_user_agent("26.5\n").as_deref(),
            Some(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
(KHTML, like Gecko) Version/26.5 Safari/605.1.15"
            )
        );
        assert_eq!(safari_user_agent("invalid version"), None);
    }

    #[test]
    fn allows_web_and_challenge_frame_navigation_only() {
        for url in [
            "https://example.com",
            "http://example.com",
            "tauri://localhost",
            "about:blank",
            "blob:https://example.com/1234",
        ] {
            assert!(is_allowed_browser_navigation(&Url::parse(url).unwrap()));
        }
        for url in [
            "file:///tmp/private",
            "javascript:alert(1)",
            "data:text/html,test",
        ] {
            assert!(!is_allowed_browser_navigation(&Url::parse(url).unwrap()));
        }
    }

    #[test]
    fn allows_only_same_site_popups() {
        let same_site = [
            ("https://www.site.com/watch", "https://ads.site.com/x"),
            ("https://site.com/a", "https://site.com/b"),
            ("https://player.site.com", "http://site.com"),
        ];
        for (current, target) in same_site {
            assert!(is_same_site_popup(
                &Url::parse(current).unwrap(),
                &Url::parse(target).unwrap()
            ));
        }
        let cross_site = [
            ("https://www.site.com/watch", "https://endedstrung.com/fcq5"),
            ("https://site.com", "https://other.net"),
        ];
        for (current, target) in cross_site {
            assert!(!is_same_site_popup(
                &Url::parse(current).unwrap(),
                &Url::parse(target).unwrap()
            ));
        }
    }

    #[test]
    fn normalizes_addresses_and_searches() {
        assert_eq!(
            normalize_browser_input("example.com/watch")
                .unwrap()
                .as_str(),
            "https://example.com/watch"
        );
        assert!(normalize_browser_input("video search")
            .unwrap()
            .as_str()
            .starts_with("https://www.google.com/search?q="));
        assert!(normalize_browser_input("").is_err());
    }

    #[test]
    fn hides_browser_start_url_from_address_bar() {
        let start =
            Url::parse("http://127.0.0.1:1420/index.html?view=browser-start&lang=en&theme=system")
                .unwrap();
        let packaged =
            Url::parse("tauri://localhost/index.html?view=browser-start&lang=zh-CN&theme=dark")
                .unwrap();
        let external = Url::parse("https://example.com/watch").unwrap();

        assert!(is_browser_start_url(&start));
        assert!(is_browser_start_url(&packaged));
        assert!(!is_browser_start_url(&external));
        assert_eq!(display_page_url(&start), "");
        assert_eq!(display_page_url(&packaged), "");
        assert_eq!(display_page_url(&external), "https://example.com/watch");
    }
}
