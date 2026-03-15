use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub type ForgeResult<T> = Result<T, ValidationError>;

pub const DEFAULT_API_HOST: &str = "127.0.0.1";
pub const DEFAULT_API_PORT: u16 = 37241;

#[derive(Debug, Error, Clone, Serialize, Deserialize)]
#[error("{message}")]
pub struct ValidationError {
    pub message: String,
}

impl ValidationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    #[default]
    Active,
    Paused,
    Archived,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Inbox,
    #[default]
    Todo,
    Scheduled,
    InProgress,
    Blocked,
    Done,
    Canceled,
}

impl TaskStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Canceled)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    #[default]
    Medium,
    High,
    Urgent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    Meeting,
    WorkBlock,
    Research,
    #[default]
    Implementation,
    Admin,
    Review,
    Personal,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    #[default]
    Ui,
    Cli,
    Api,
    Agent,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub color: String,
    pub workdir_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub project: Project,
    pub open_task_count: i64,
    pub upcoming_event_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRepoStatus {
    pub project_id: i64,
    pub workdir_path: Option<String>,
    pub is_git_repo: bool,
    pub repo_root: Option<String>,
    pub branch: Option<String>,
    pub remote_url: Option<String>,
    pub default_branch: Option<String>,
    pub dirty: bool,
    pub dirty_file_count: i64,
    pub last_commit_sha: Option<String>,
    pub last_commit_summary: Option<String>,
    pub last_commit_at: Option<String>,
    pub status_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub project_id: Option<i64>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub due_at: Option<String>,
    pub scheduled_start: Option<String>,
    pub scheduled_end: Option<String>,
    pub estimate_minutes: Option<i32>,
    pub tags: Vec<String>,
    pub notes: String,
    pub source: SourceKind,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub project_id: Option<i64>,
    pub linked_task_id: Option<i64>,
    pub start_at: String,
    pub end_at: String,
    pub timezone: String,
    pub event_type: EventType,
    pub rrule: Option<String>,
    pub recurrence_exceptions: Vec<String>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusState {
    pub id: i64,
    pub project_id: i64,
    pub task_id: Option<i64>,
    pub started_at: String,
    pub source: SourceKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarOccurrence {
    pub event_id: i64,
    pub title: String,
    pub description: String,
    pub project_id: Option<i64>,
    pub linked_task_id: Option<i64>,
    pub occurrence_start: String,
    pub occurrence_end: String,
    pub timezone: String,
    pub event_type: EventType,
    pub is_recurring: bool,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodaySummary {
    pub date: String,
    pub focus: Option<FocusState>,
    pub today_tasks: Vec<Task>,
    pub overdue_tasks: Vec<Task>,
    pub today_events: Vec<CalendarOccurrence>,
    pub upcoming_work: Vec<CalendarOccurrence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub api_base_url: String,
    pub paths: ForgePaths,
    pub started_at: String,
    pub first_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ForgePaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub config: PathBuf,
    pub logs: PathBuf,
    pub daemon_log: PathBuf,
}

impl ForgePaths {
    pub fn discover() -> ForgeResult<Self> {
        let home = dirs::home_dir()
            .ok_or_else(|| ValidationError::new("failed to locate user home directory"))?;
        Ok(Self::from_root(home.join(".forge")))
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self {
            database: root.join("forge.db"),
            config: root.join("config.toml"),
            logs: root.join("logs"),
            daemon_log: root.join("logs").join("forged.log"),
            root,
        }
    }

    pub fn database_url(&self) -> String {
        sqlite_url_from_path(&self.database)
    }

    pub fn api_base_url(&self, host: &str, port: u16) -> String {
        format!("http://{host}:{port}")
    }

    pub fn health_url(&self, host: &str, port: u16) -> String {
        format!("{}/health", self.api_base_url(host, port))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub status: ProjectStatus,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_project_color")]
    pub color: String,
    pub workdir_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateProjectRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ProjectStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub workdir_path: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub project_id: Option<i64>,
    #[serde(default)]
    pub status: TaskStatus,
    #[serde(default)]
    pub priority: TaskPriority,
    pub due_at: Option<String>,
    pub scheduled_start: Option<String>,
    pub scheduled_end: Option<String>,
    pub estimate_minutes: Option<i32>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub source: SourceKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateTaskRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub project_id: Option<Option<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<TaskPriority>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub due_at: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub scheduled_start: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub scheduled_end: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub estimate_minutes: Option<Option<i32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskListQuery {
    pub project_id: Option<i64>,
    pub inbox_only: Option<bool>,
    pub status: Option<TaskStatus>,
    pub priority: Option<TaskPriority>,
    pub due_today: Option<bool>,
    pub overdue: Option<bool>,
    pub scheduled: Option<bool>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEventRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub project_id: Option<i64>,
    pub linked_task_id: Option<i64>,
    pub start_at: String,
    pub end_at: String,
    pub timezone: String,
    #[serde(default)]
    pub event_type: EventType,
    pub rrule: Option<String>,
    #[serde(default)]
    pub recurrence_exceptions: Vec<String>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateEventRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub project_id: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub linked_task_id: Option<Option<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_type: Option<EventType>,
    #[serde(
        default,
        deserialize_with = "deserialize_patch_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub rrule: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence_exceptions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

fn deserialize_patch_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EventListQuery {
    pub project_id: Option<i64>,
    pub linked_task_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarRangeQuery {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetFocusRequest {
    pub project_id: i64,
    pub task_id: Option<i64>,
    #[serde(default)]
    pub source: SourceKind,
}

pub fn default_project_color() -> String {
    "#4f6a77".to_string()
}

pub fn now_timestamp() -> String {
    Utc::now().to_rfc3339()
}

pub fn parse_rfc3339(value: &str) -> ForgeResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| ValidationError::new(format!("invalid RFC3339 timestamp: {value}")))
}

pub fn parse_date(value: &str) -> ForgeResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| ValidationError::new(format!("invalid date: {value}")))
}

pub fn slugify(input: &str) -> String {
    let mut slug = String::with_capacity(input.len());
    let mut last_dash = false;
    for ch in input.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

pub fn require_non_empty(value: &str, field: &str) -> ForgeResult<()> {
    if value.trim().is_empty() {
        Err(ValidationError::new(format!("{field} must not be empty")))
    } else {
        Ok(())
    }
}

fn sqlite_url_from_path(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    format!("sqlite://{raw}")
}
