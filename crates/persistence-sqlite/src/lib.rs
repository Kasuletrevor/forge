use std::{str::FromStr, sync::Arc};

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use domain::{
    CreateEventRequest, CreateProjectRequest, CreateTaskRequest, Event, EventListQuery,
    FocusState, Project, ProjectSummary, SetFocusRequest, Task, TaskListQuery, TaskStatus,
    UpdateEventRequest, UpdateProjectRequest, UpdateTaskRequest,
};
use serde::{Serialize, de::DeserializeOwned};
use sqlx::{
    FromRow, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

#[derive(Clone)]
pub struct SqliteStore {
    pool: Arc<SqlitePool>,
}

impl SqliteStore {
    pub async fn new(database_url: &str) -> Result<Self> {
        let options = SqliteConnectOptions::from_str(database_url)?
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        Ok(Self {
            pool: Arc::new(pool),
        })
    }

    pub fn pool(&self) -> &SqlitePool {
        self.pool.as_ref()
    }

    pub async fn run_migrations(&self) -> Result<()> {
        sqlx::migrate!("./migrations").run(self.pool()).await?;
        Ok(())
    }

    pub async fn health_check(&self) -> Result<()> {
        sqlx::query("SELECT 1").execute(self.pool()).await?;
        Ok(())
    }

    pub async fn list_projects(&self, include_archived: bool) -> Result<Vec<ProjectSummary>> {
        let now = Utc::now().to_rfc3339();
        let window_end = (Utc::now() + chrono::TimeDelta::days(7)).to_rfc3339();
        let rows = sqlx::query_as::<_, ProjectSummaryRow>(
            r#"
            SELECT
                p.id,
                p.name,
                p.slug,
                p.description,
                p.status,
                p.tags,
                p.color,
                p.created_at,
                p.updated_at,
                (
                    SELECT COUNT(*)
                    FROM tasks t
                    WHERE t.project_id = p.id
                      AND t.status NOT IN ('done', 'canceled')
                ) AS open_task_count,
                (
                    SELECT COUNT(*)
                    FROM events e
                    WHERE e.project_id = p.id
                      AND (
                        (e.rrule IS NULL AND e.end_at >= ?1 AND e.start_at <= ?2)
                        OR e.rrule IS NOT NULL
                      )
                ) AS upcoming_event_count
            FROM projects p
            WHERE (?3 = 1 OR p.status <> 'archived')
            ORDER BY
                CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                p.updated_at DESC
            "#,
        )
        .bind(now)
        .bind(window_end)
        .bind(if include_archived { 1_i64 } else { 0_i64 })
        .fetch_all(self.pool())
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    pub async fn get_project(&self, id: i64) -> Result<Option<Project>> {
        let row = sqlx::query_as::<_, ProjectRow>("SELECT * FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool())
            .await?;
        row.map(TryInto::try_into).transpose()
    }

    pub async fn create_project(&self, input: &CreateProjectRequest) -> Result<Project> {
        let now = domain::now_timestamp();
        let tags = encode_json(&input.tags)?;
        let status = to_db_enum(input.status)?;
        let result = sqlx::query(
            r#"
            INSERT INTO projects (name, slug, description, status, tags, color, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(&input.name)
        .bind(domain::slugify(&input.name))
        .bind(&input.description)
        .bind(status)
        .bind(tags)
        .bind(&input.color)
        .bind(&now)
        .bind(&now)
        .execute(self.pool())
        .await
        .with_context(|| format!("failed to insert project '{}'", input.name))?;

        self.get_project(result.last_insert_rowid())
            .await?
            .context("project inserted but not found")
    }

    pub async fn update_project(
        &self,
        id: i64,
        input: &UpdateProjectRequest,
    ) -> Result<Option<Project>> {
        let Some(mut current) = self.get_project(id).await? else {
            return Ok(None);
        };

        if let Some(name) = &input.name {
            current.name = name.clone();
        }
        if let Some(description) = &input.description {
            current.description = description.clone();
        }
        if let Some(status) = input.status {
            current.status = status;
        }
        if let Some(tags) = &input.tags {
            current.tags = tags.clone();
        }
        if let Some(color) = &input.color {
            current.color = color.clone();
        }
        current.updated_at = domain::now_timestamp();

        sqlx::query(
            r#"
            UPDATE projects
            SET name = ?1, slug = ?2, description = ?3, status = ?4, tags = ?5, color = ?6, updated_at = ?7
            WHERE id = ?8
            "#,
        )
        .bind(&current.name)
        .bind(&current.slug)
        .bind(&current.description)
        .bind(to_db_enum(current.status)?)
        .bind(encode_json(&current.tags)?)
        .bind(&current.color)
        .bind(&current.updated_at)
        .bind(id)
        .execute(self.pool())
        .await?;

        self.get_project(id).await
    }

    pub async fn delete_project(&self, id: i64) -> Result<bool> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_tasks(&self, query: &TaskListQuery) -> Result<Vec<Task>> {
        let rows = sqlx::query_as::<_, TaskRow>("SELECT * FROM tasks ORDER BY updated_at DESC")
            .fetch_all(self.pool())
            .await?;

        let mut tasks = Vec::with_capacity(rows.len());
        let today = Utc::now().date_naive();
        for row in rows {
            let task: Task = row.try_into()?;
            if let Some(project_id) = query.project_id {
                if task.project_id != Some(project_id) {
                    continue;
                }
            }
            if matches!(query.inbox_only, Some(true)) && task.project_id.is_some() {
                continue;
            }
            if let Some(status) = query.status {
                if task.status != status {
                    continue;
                }
            }
            if let Some(priority) = query.priority {
                if task.priority != priority {
                    continue;
                }
            }
            if let Some(search) = &query.search {
                let haystack = format!("{} {} {}", task.title, task.description, task.notes).to_lowercase();
                if !haystack.contains(&search.to_lowercase()) {
                    continue;
                }
            }
            if matches!(query.scheduled, Some(true))
                && task.scheduled_start.is_none()
                && task.scheduled_end.is_none()
            {
                continue;
            }
            if matches!(query.scheduled, Some(false))
                && (task.scheduled_start.is_some() || task.scheduled_end.is_some())
            {
                continue;
            }
            if matches!(query.overdue, Some(true)) {
                let Some(due_at) = &task.due_at else {
                    continue;
                };
                let due_date = domain::parse_rfc3339(due_at)?.date_naive();
                if due_date >= today || task.status.is_terminal() {
                    continue;
                }
            }
            if matches!(query.due_today, Some(true)) {
                let matches_today = task
                    .due_at
                    .as_deref()
                    .and_then(|value| domain::parse_rfc3339(value).ok())
                    .map(|value| value.date_naive() == today)
                    .unwrap_or(false)
                    || task
                        .scheduled_start
                        .as_deref()
                        .and_then(|value| domain::parse_rfc3339(value).ok())
                        .map(|value| value.date_naive() == today)
                        .unwrap_or(false);
                if !matches_today {
                    continue;
                }
            }
            tasks.push(task);
        }

        Ok(tasks)
    }

    pub async fn get_task(&self, id: i64) -> Result<Option<Task>> {
        let row = sqlx::query_as::<_, TaskRow>("SELECT * FROM tasks WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool())
            .await?;
        row.map(TryInto::try_into).transpose()
    }

    pub async fn create_task(&self, input: &CreateTaskRequest) -> Result<Task> {
        let now = domain::now_timestamp();
        let result = sqlx::query(
            r#"
            INSERT INTO tasks (
                title, description, project_id, status, priority, due_at, scheduled_start,
                scheduled_end, estimate_minutes, tags, notes, source, created_at, updated_at, completed_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL)
            "#,
        )
        .bind(&input.title)
        .bind(&input.description)
        .bind(input.project_id)
        .bind(to_db_enum(input.status)?)
        .bind(to_db_enum(input.priority)?)
        .bind(&input.due_at)
        .bind(&input.scheduled_start)
        .bind(&input.scheduled_end)
        .bind(input.estimate_minutes)
        .bind(encode_json(&input.tags)?)
        .bind(&input.notes)
        .bind(to_db_enum(input.source)?)
        .bind(&now)
        .bind(&now)
        .execute(self.pool())
        .await?;

        self.get_task(result.last_insert_rowid())
            .await?
            .context("task inserted but not found")
    }

    pub async fn update_task(&self, id: i64, input: &UpdateTaskRequest) -> Result<Option<Task>> {
        let Some(mut current) = self.get_task(id).await? else {
            return Ok(None);
        };

        if let Some(title) = &input.title {
            current.title = title.clone();
        }
        if let Some(description) = &input.description {
            current.description = description.clone();
        }
        if let Some(project_id) = input.project_id {
            current.project_id = project_id;
        }
        if let Some(status) = input.status {
            current.status = status;
            if status.is_terminal() && current.completed_at.is_none() {
                current.completed_at = Some(domain::now_timestamp());
            }
            if !status.is_terminal() {
                current.completed_at = None;
            }
        }
        if let Some(priority) = input.priority {
            current.priority = priority;
        }
        if let Some(due_at) = &input.due_at {
            current.due_at = due_at.clone();
        }
        if let Some(start) = &input.scheduled_start {
            current.scheduled_start = start.clone();
        }
        if let Some(end) = &input.scheduled_end {
            current.scheduled_end = end.clone();
        }
        if let Some(estimate) = input.estimate_minutes {
            current.estimate_minutes = estimate;
        }
        if let Some(tags) = &input.tags {
            current.tags = tags.clone();
        }
        if let Some(notes) = &input.notes {
            current.notes = notes.clone();
        }
        if let Some(source) = input.source {
            current.source = source;
        }
        current.updated_at = domain::now_timestamp();

        sqlx::query(
            r#"
            UPDATE tasks
            SET title = ?1, description = ?2, project_id = ?3, status = ?4, priority = ?5,
                due_at = ?6, scheduled_start = ?7, scheduled_end = ?8, estimate_minutes = ?9,
                tags = ?10, notes = ?11, source = ?12, updated_at = ?13, completed_at = ?14
            WHERE id = ?15
            "#,
        )
        .bind(&current.title)
        .bind(&current.description)
        .bind(current.project_id)
        .bind(to_db_enum(current.status)?)
        .bind(to_db_enum(current.priority)?)
        .bind(&current.due_at)
        .bind(&current.scheduled_start)
        .bind(&current.scheduled_end)
        .bind(current.estimate_minutes)
        .bind(encode_json(&current.tags)?)
        .bind(&current.notes)
        .bind(to_db_enum(current.source)?)
        .bind(&current.updated_at)
        .bind(&current.completed_at)
        .bind(id)
        .execute(self.pool())
        .await?;

        self.get_task(id).await
    }

    pub async fn delete_task(&self, id: i64) -> Result<bool> {
        sqlx::query("DELETE FROM events WHERE linked_task_id = ?")
            .bind(id)
            .execute(self.pool())
            .await?;
        let result = sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn complete_task(&self, id: i64) -> Result<Option<Task>> {
        let update = UpdateTaskRequest {
            status: Some(TaskStatus::Done),
            ..Default::default()
        };
        self.update_task(id, &update).await
    }

    pub async fn clear_done_tasks(&self) -> Result<u64> {
        let result = sqlx::query("DELETE FROM tasks WHERE status = 'done'")
            .execute(self.pool())
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn list_events(&self, query: &EventListQuery) -> Result<Vec<Event>> {
        let rows = sqlx::query_as::<_, EventRow>("SELECT * FROM events ORDER BY start_at ASC")
            .fetch_all(self.pool())
            .await?;

        let mut events = Vec::with_capacity(rows.len());
        for row in rows {
            let event: Event = row.try_into()?;
            if let Some(project_id) = query.project_id {
                if event.project_id != Some(project_id) {
                    continue;
                }
            }
            if let Some(task_id) = query.linked_task_id {
                if event.linked_task_id != Some(task_id) {
                    continue;
                }
            }
            events.push(event);
        }

        Ok(events)
    }

    pub async fn get_event(&self, id: i64) -> Result<Option<Event>> {
        let row = sqlx::query_as::<_, EventRow>("SELECT * FROM events WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool())
            .await?;
        row.map(TryInto::try_into).transpose()
    }

    pub async fn create_event(&self, input: &CreateEventRequest) -> Result<Event> {
        let now = domain::now_timestamp();
        let result = sqlx::query(
            r#"
            INSERT INTO events (
                title, description, project_id, linked_task_id, start_at, end_at, timezone,
                event_type, rrule, recurrence_exceptions, notes, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#,
        )
        .bind(&input.title)
        .bind(&input.description)
        .bind(input.project_id)
        .bind(input.linked_task_id)
        .bind(&input.start_at)
        .bind(&input.end_at)
        .bind(&input.timezone)
        .bind(to_db_enum(input.event_type)?)
        .bind(&input.rrule)
        .bind(encode_json(&input.recurrence_exceptions)?)
        .bind(&input.notes)
        .bind(&now)
        .bind(&now)
        .execute(self.pool())
        .await?;

        self.get_event(result.last_insert_rowid())
            .await?
            .context("event inserted but not found")
    }

    pub async fn update_event(
        &self,
        id: i64,
        input: &UpdateEventRequest,
    ) -> Result<Option<Event>> {
        let Some(mut current) = self.get_event(id).await? else {
            return Ok(None);
        };

        if let Some(title) = &input.title {
            current.title = title.clone();
        }
        if let Some(description) = &input.description {
            current.description = description.clone();
        }
        if let Some(project_id) = input.project_id {
            current.project_id = project_id;
        }
        if let Some(linked_task_id) = input.linked_task_id {
            current.linked_task_id = linked_task_id;
        }
        if let Some(start_at) = &input.start_at {
            current.start_at = start_at.clone();
        }
        if let Some(end_at) = &input.end_at {
            current.end_at = end_at.clone();
        }
        if let Some(timezone) = &input.timezone {
            current.timezone = timezone.clone();
        }
        if let Some(event_type) = input.event_type {
            current.event_type = event_type;
        }
        if let Some(rrule) = &input.rrule {
            current.rrule = rrule.clone();
        }
        if let Some(exceptions) = &input.recurrence_exceptions {
            current.recurrence_exceptions = exceptions.clone();
        }
        if let Some(notes) = &input.notes {
            current.notes = notes.clone();
        }
        current.updated_at = domain::now_timestamp();

        sqlx::query(
            r#"
            UPDATE events
            SET title = ?1, description = ?2, project_id = ?3, linked_task_id = ?4,
                start_at = ?5, end_at = ?6, timezone = ?7, event_type = ?8, rrule = ?9,
                recurrence_exceptions = ?10, notes = ?11, updated_at = ?12
            WHERE id = ?13
            "#,
        )
        .bind(&current.title)
        .bind(&current.description)
        .bind(current.project_id)
        .bind(current.linked_task_id)
        .bind(&current.start_at)
        .bind(&current.end_at)
        .bind(&current.timezone)
        .bind(to_db_enum(current.event_type)?)
        .bind(&current.rrule)
        .bind(encode_json(&current.recurrence_exceptions)?)
        .bind(&current.notes)
        .bind(&current.updated_at)
        .bind(id)
        .execute(self.pool())
        .await?;

        self.get_event(id).await
    }

    pub async fn delete_event(&self, id: i64) -> Result<bool> {
        let result = sqlx::query("DELETE FROM events WHERE id = ?")
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn get_focus(&self) -> Result<Option<FocusState>> {
        let row = sqlx::query_as::<_, FocusRow>("SELECT * FROM focus_state WHERE id = 1")
            .fetch_optional(self.pool())
            .await?;
        row.map(TryInto::try_into).transpose()
    }

    pub async fn set_focus(&self, input: &SetFocusRequest) -> Result<FocusState> {
        let started_at = domain::now_timestamp();
        sqlx::query(
            r#"
            INSERT INTO focus_state (id, project_id, task_id, started_at, source)
            VALUES (1, ?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE
            SET project_id = excluded.project_id,
                task_id = excluded.task_id,
                started_at = excluded.started_at,
                source = excluded.source
            "#,
        )
        .bind(input.project_id)
        .bind(input.task_id)
        .bind(&started_at)
        .bind(to_db_enum(input.source)?)
        .execute(self.pool())
        .await?;

        self.get_focus()
            .await?
            .context("focus upsert completed but row missing")
    }

    pub async fn clear_focus(&self) -> Result<()> {
        sqlx::query("DELETE FROM focus_state WHERE id = 1")
            .execute(self.pool())
            .await?;
        Ok(())
    }
}

#[derive(Debug, FromRow)]
struct ProjectRow {
    id: i64,
    name: String,
    slug: String,
    description: String,
    status: String,
    tags: String,
    color: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct ProjectSummaryRow {
    id: i64,
    name: String,
    slug: String,
    description: String,
    status: String,
    tags: String,
    color: String,
    created_at: String,
    updated_at: String,
    open_task_count: i64,
    upcoming_event_count: i64,
}

#[derive(Debug, FromRow)]
struct TaskRow {
    id: i64,
    title: String,
    description: String,
    project_id: Option<i64>,
    status: String,
    priority: String,
    due_at: Option<String>,
    scheduled_start: Option<String>,
    scheduled_end: Option<String>,
    estimate_minutes: Option<i32>,
    tags: String,
    notes: String,
    source: String,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
}

#[derive(Debug, FromRow)]
struct EventRow {
    id: i64,
    title: String,
    description: String,
    project_id: Option<i64>,
    linked_task_id: Option<i64>,
    start_at: String,
    end_at: String,
    timezone: String,
    event_type: String,
    rrule: Option<String>,
    recurrence_exceptions: String,
    notes: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct FocusRow {
    id: i64,
    project_id: i64,
    task_id: Option<i64>,
    started_at: String,
    source: String,
}

impl TryFrom<ProjectRow> for Project {
    type Error = anyhow::Error;

    fn try_from(value: ProjectRow) -> Result<Self> {
        Ok(Self {
            id: value.id,
            name: value.name,
            slug: value.slug,
            description: value.description,
            status: from_db_enum(&value.status)?,
            tags: decode_json(&value.tags)?,
            color: value.color,
            created_at: value.created_at,
            updated_at: value.updated_at,
        })
    }
}

impl TryFrom<ProjectSummaryRow> for ProjectSummary {
    type Error = anyhow::Error;

    fn try_from(value: ProjectSummaryRow) -> Result<Self> {
        Ok(Self {
            project: Project {
                id: value.id,
                name: value.name,
                slug: value.slug,
                description: value.description,
                status: from_db_enum(&value.status)?,
                tags: decode_json(&value.tags)?,
                color: value.color,
                created_at: value.created_at,
                updated_at: value.updated_at,
            },
            open_task_count: value.open_task_count,
            upcoming_event_count: value.upcoming_event_count,
        })
    }
}

impl TryFrom<TaskRow> for Task {
    type Error = anyhow::Error;

    fn try_from(value: TaskRow) -> Result<Self> {
        Ok(Self {
            id: value.id,
            title: value.title,
            description: value.description,
            project_id: value.project_id,
            status: from_db_enum(&value.status)?,
            priority: from_db_enum(&value.priority)?,
            due_at: value.due_at,
            scheduled_start: value.scheduled_start,
            scheduled_end: value.scheduled_end,
            estimate_minutes: value.estimate_minutes,
            tags: decode_json(&value.tags)?,
            notes: value.notes,
            source: from_db_enum(&value.source)?,
            created_at: value.created_at,
            updated_at: value.updated_at,
            completed_at: value.completed_at,
        })
    }
}

impl TryFrom<EventRow> for Event {
    type Error = anyhow::Error;

    fn try_from(value: EventRow) -> Result<Self> {
        Ok(Self {
            id: value.id,
            title: value.title,
            description: value.description,
            project_id: value.project_id,
            linked_task_id: value.linked_task_id,
            start_at: value.start_at,
            end_at: value.end_at,
            timezone: value.timezone,
            event_type: from_db_enum(&value.event_type)?,
            rrule: value.rrule,
            recurrence_exceptions: decode_json(&value.recurrence_exceptions)?,
            notes: value.notes,
            created_at: value.created_at,
            updated_at: value.updated_at,
        })
    }
}

impl TryFrom<FocusRow> for FocusState {
    type Error = anyhow::Error;

    fn try_from(value: FocusRow) -> Result<Self> {
        Ok(Self {
            id: value.id,
            project_id: value.project_id,
            task_id: value.task_id,
            started_at: value.started_at,
            source: from_db_enum(&value.source)?,
        })
    }
}

fn encode_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(Into::into)
}

fn decode_json<T: DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_str(value).map_err(Into::into)
}

fn to_db_enum<T: Serialize>(value: T) -> Result<String> {
    serde_json::to_value(value)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow!("enum serialization did not produce a string"))
}

fn from_db_enum<T: DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_value(serde_json::Value::String(value.to_string())).map_err(Into::into)
}
