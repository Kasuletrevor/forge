use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use chrono_tz::Tz as ChronoTz;
use domain::{
    CalendarOccurrence, CalendarRangeQuery, CreateEventRequest, CreateProjectRequest,
    CreateTaskRequest, Event, EventListQuery, EventType, FocusState, ForgeResult, HealthResponse,
    Project, ProjectSummary, SetFocusRequest, SourceKind, Task, TaskListQuery, TaskStatus,
    TodaySummary, UpdateEventRequest, UpdateProjectRequest, UpdateTaskRequest, ValidationError,
    parse_rfc3339, require_non_empty,
};
use persistence_sqlite::SqliteStore;
use rrule::{RRuleSet, Tz};
use thiserror::Error;
use tracing::instrument;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(&'static str),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<ValidationError> for AppError {
    fn from(value: ValidationError) -> Self {
        Self::Validation(value.message)
    }
}

#[derive(Clone)]
pub struct ForgeService {
    store: SqliteStore,
}

impl ForgeService {
    pub fn new(store: SqliteStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &SqliteStore {
        &self.store
    }

    #[instrument(skip(self))]
    pub async fn health(&self) -> AppResult<HealthResponse> {
        self.store.health_check().await.map_err(Self::map_store_error)?;
        Ok(HealthResponse {
            status: "ok".to_string(),
        })
    }

    #[instrument(skip(self))]
    pub async fn list_projects(&self, include_archived: bool) -> AppResult<Vec<ProjectSummary>> {
        self.store
            .list_projects(include_archived)
            .await
            .map_err(Self::map_store_error)
    }

    #[instrument(skip(self))]
    pub async fn get_project(&self, id: i64) -> AppResult<Project> {
        self.store
            .get_project(id)
            .await
            .map_err(Self::map_store_error)?
            .ok_or(AppError::NotFound("project"))
    }

    #[instrument(skip(self, input))]
    pub async fn create_project(&self, input: CreateProjectRequest) -> AppResult<Project> {
        require_non_empty(&input.name, "project.name")?;
        require_non_empty(&input.color, "project.color")?;
        self.store
            .create_project(&input)
            .await
            .map_err(Self::map_store_error)
    }

    #[instrument(skip(self, input))]
    pub async fn update_project(
        &self,
        id: i64,
        input: UpdateProjectRequest,
    ) -> AppResult<Project> {
        if let Some(name) = &input.name {
            require_non_empty(name, "project.name")?;
        }
        if let Some(color) = &input.color {
            require_non_empty(color, "project.color")?;
        }
        self.store
            .update_project(id, &input)
            .await
            .map_err(Self::map_store_error)?
            .ok_or(AppError::NotFound("project"))
    }

    #[instrument(skip(self))]
    pub async fn delete_project(&self, id: i64) -> AppResult<()> {
        let _ = self.get_project(id).await?;
        if self
            .get_focus()
            .await?
            .map(|focus| focus.project_id == id)
            .unwrap_or(false)
        {
            self.clear_focus().await?;
        }

        let deleted = self
            .store
            .delete_project(id)
            .await
            .map_err(Self::map_store_error)?;

        if deleted {
            Ok(())
        } else {
            Err(AppError::NotFound("project"))
        }
    }

    #[instrument(skip(self, query))]
    pub async fn list_tasks(&self, query: TaskListQuery) -> AppResult<Vec<Task>> {
        self.store
            .list_tasks(&query)
            .await
            .map_err(Self::map_store_error)
    }

    #[instrument(skip(self))]
    pub async fn get_task(&self, id: i64) -> AppResult<Task> {
        self.store
            .get_task(id)
            .await
            .map_err(Self::map_store_error)?
            .ok_or(AppError::NotFound("task"))
    }

    #[instrument(skip(self, input))]
    pub async fn create_task(&self, mut input: CreateTaskRequest) -> AppResult<Task> {
        require_non_empty(&input.title, "task.title")?;
        validate_timestamp_pair(input.scheduled_start.as_deref(), input.scheduled_end.as_deref())?;
        if let Some(project_id) = input.project_id {
            let _ = self.get_project(project_id).await?;
        }

        if input.status == TaskStatus::Todo && input.scheduled_start.is_some() {
            input.status = TaskStatus::Scheduled;
        }
        validate_task_state(
            input.project_id,
            input.status,
            input.scheduled_start.as_deref(),
            input.scheduled_end.as_deref(),
        )?;

        self.store
            .create_task(&input)
            .await
            .map_err(Self::map_store_error)
    }

    #[instrument(skip(self, input))]
    pub async fn update_task(&self, id: i64, mut input: UpdateTaskRequest) -> AppResult<Task> {
        let current = self.get_task(id).await?;
        if let Some(title) = &input.title {
            require_non_empty(title, "task.title")?;
        }
        validate_timestamp_pair(
            input.scheduled_start.as_ref().and_then(|value| value.as_deref()),
            input.scheduled_end.as_ref().and_then(|value| value.as_deref()),
        )?;

        if let Some(Some(project_id)) = input.project_id {
            let _ = self.get_project(project_id).await?;
        }

        if input.status.is_none() && input.scheduled_start.is_some() {
            input.status = Some(TaskStatus::Scheduled);
        }
        let effective_project_id = input.project_id.unwrap_or(current.project_id);
        let effective_status = input.status.unwrap_or(current.status);
        let effective_scheduled_start = input
            .scheduled_start
            .as_ref()
            .cloned()
            .unwrap_or(current.scheduled_start);
        let effective_scheduled_end = input
            .scheduled_end
            .as_ref()
            .cloned()
            .unwrap_or(current.scheduled_end);
        validate_task_state(
            effective_project_id,
            effective_status,
            effective_scheduled_start.as_deref(),
            effective_scheduled_end.as_deref(),
        )?;

        self.store
            .update_task(id, &input)
            .await
            .map_err(Self::map_store_error)?
            .ok_or(AppError::NotFound("task"))
    }

    #[instrument(skip(self))]
    pub async fn delete_task(&self, id: i64) -> AppResult<()> {
        let _ = self.get_task(id).await?;
        if self
            .get_focus()
            .await?
            .map(|focus| focus.task_id == Some(id))
            .unwrap_or(false)
        {
            self.clear_focus().await?;
        }
        let deleted = self
            .store
            .delete_task(id)
            .await
            .map_err(Self::map_store_error)?;
        if deleted {
            Ok(())
        } else {
            Err(AppError::NotFound("task"))
        }
    }

    #[instrument(skip(self))]
    pub async fn complete_task(&self, id: i64) -> AppResult<Task> {
        self.store
            .complete_task(id)
            .await
            .map_err(Self::map_store_error)?
            .ok_or(AppError::NotFound("task"))
    }

    #[instrument(skip(self))]
    pub async fn clear_done_tasks(&self) -> AppResult<u64> {
        self.store
            .clear_done_tasks()
            .await
            .map_err(Self::map_store_error)
    }

    #[instrument(skip(self, query))]
    pub async fn list_events(&self, query: EventListQuery) -> AppResult<Vec<Event>> {
        self.store
            .list_events(&query)
            .await
            .map_err(Self::map_store_error)
    }

    #[instrument(skip(self))]
    pub async fn get_event(&self, id: i64) -> AppResult<Event> {
        self.store
            .get_event(id)
            .await
            .map_err(Self::map_store_error)?
            .ok_or(AppError::NotFound("event"))
    }

    #[instrument(skip(self, input))]
    pub async fn create_event(&self, mut input: CreateEventRequest) -> AppResult<Event> {
        input.timezone = input.timezone.trim().to_string();
        if let Some(rule) = input.rrule.as_mut() {
            *rule = rule.trim().to_string();
        }
        require_non_empty(&input.title, "event.title")?;
        validate_timestamp_pair(Some(&input.start_at), Some(&input.end_at))?;
        validate_recurrence(&input)?;
        if let Some(project_id) = input.project_id {
            let _ = self.get_project(project_id).await?;
        }
        if let Some(task_id) = input.linked_task_id {
            let _ = self.get_task(task_id).await?;
        }

        let event = self
            .store
            .create_event(&input)
            .await
            .map_err(Self::map_store_error)?;

        self.refresh_linked_task_schedule(event.linked_task_id).await?;

        Ok(event)
    }

    #[instrument(skip(self, input))]
    pub async fn update_event(&self, id: i64, mut input: UpdateEventRequest) -> AppResult<Event> {
        if let Some(timezone) = input.timezone.as_mut() {
            *timezone = timezone.trim().to_string();
        }
        if let Some(Some(rule)) = input.rrule.as_mut() {
            *rule = rule.trim().to_string();
        }
        let existing = self.get_event(id).await?;
        if let Some(title) = &input.title {
            require_non_empty(title, "event.title")?;
        }
        validate_timestamp_pair(input.start_at.as_deref(), input.end_at.as_deref())?;

        if let Some(Some(project_id)) = input.project_id {
            let _ = self.get_project(project_id).await?;
        }
        if let Some(Some(task_id)) = input.linked_task_id {
            let _ = self.get_task(task_id).await?;
        }

        let updated = apply_event_patch(&existing, &input);
        validate_timestamp_pair(Some(&updated.start_at), Some(&updated.end_at))?;
        validate_recurrence_event(&updated)?;

        let persisted = self
            .store
            .update_event(id, &input)
            .await
            .map_err(Self::map_store_error)?
            .ok_or(AppError::NotFound("event"))?;

        if existing.linked_task_id != persisted.linked_task_id {
            self.refresh_linked_task_schedule(existing.linked_task_id).await?;
        }
        self.refresh_linked_task_schedule(persisted.linked_task_id).await?;

        Ok(persisted)
    }

    #[instrument(skip(self))]
    pub async fn delete_event(&self, id: i64) -> AppResult<()> {
        let event = self.get_event(id).await?;
        let deleted = self
            .store
            .delete_event(id)
            .await
            .map_err(Self::map_store_error)?;
        if deleted {
            self.refresh_linked_task_schedule(event.linked_task_id).await?;
            Ok(())
        } else {
            Err(AppError::NotFound("event"))
        }
    }

    #[instrument(skip(self, query))]
    pub async fn calendar_range(
        &self,
        query: CalendarRangeQuery,
    ) -> AppResult<Vec<CalendarOccurrence>> {
        let range_start = parse_rfc3339(&query.start)?;
        let range_end = parse_rfc3339(&query.end)?;
        if range_end <= range_start {
            return Err(AppError::Validation(
                "calendar range end must be after start".to_string(),
            ));
        }

        let events = self
            .store
            .list_events(&EventListQuery::default())
            .await
            .map_err(Self::map_store_error)?;
        let mut occurrences = Vec::new();
        for event in events {
            occurrences.extend(expand_event(&event, range_start, range_end)?);
        }
        occurrences.sort_by(|a, b| a.occurrence_start.cmp(&b.occurrence_start));
        Ok(occurrences)
    }

    #[instrument(skip(self))]
    pub async fn get_focus(&self) -> AppResult<Option<FocusState>> {
        self.store.get_focus().await.map_err(Self::map_store_error)
    }

    #[instrument(skip(self, input))]
    pub async fn set_focus(&self, input: SetFocusRequest) -> AppResult<FocusState> {
        let _ = self.get_project(input.project_id).await?;
        if let Some(task_id) = input.task_id {
            let _ = self.get_task(task_id).await?;
        }
        self.store
            .set_focus(&input)
            .await
            .map_err(Self::map_store_error)
    }

    #[instrument(skip(self))]
    pub async fn clear_focus(&self) -> AppResult<()> {
        self.store.clear_focus().await.map_err(Self::map_store_error)
    }

    #[instrument(skip(self))]
    pub async fn today(&self) -> AppResult<TodaySummary> {
        let now = Utc::now();
        let day_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
        let day_end = day_start + Duration::days(1);
        let week_end = now + Duration::days(7);

        let tasks = self
            .store
            .list_tasks(&TaskListQuery::default())
            .await
            .map_err(Self::map_store_error)?;
        let today_tasks = tasks
            .iter()
            .filter(|task| {
                !task.status.is_terminal() && task_matches_day(task, now.date_naive())
            })
            .cloned()
            .collect();
        let overdue_tasks = tasks
            .iter()
            .filter(|task| {
                !task.status.is_terminal()
                    && task
                        .due_at
                        .as_deref()
                        .and_then(|value| parse_rfc3339(value).ok())
                        .map(|due| due.date_naive() < now.date_naive())
                        .unwrap_or(false)
            })
            .cloned()
            .collect();

        let today_events = self
            .calendar_range(CalendarRangeQuery {
                start: day_start.to_rfc3339(),
                end: day_end.to_rfc3339(),
            })
            .await?;
        let upcoming_work = self
            .calendar_range(CalendarRangeQuery {
                start: now.to_rfc3339(),
                end: week_end.to_rfc3339(),
            })
            .await?
            .into_iter()
            .filter(|event| {
                matches!(
                    event.event_type,
                    EventType::WorkBlock
                        | EventType::Research
                        | EventType::Implementation
                        | EventType::Review
                        | EventType::Admin
                )
            })
            .collect();

        Ok(TodaySummary {
            date: now.format("%Y-%m-%d").to_string(),
            focus: self.get_focus().await?,
            today_tasks,
            overdue_tasks,
            today_events,
            upcoming_work,
        })
    }

    async fn refresh_linked_task_schedule(
        &self,
        task_id: Option<i64>,
    ) -> AppResult<()> {
        let Some(task_id) = task_id else {
            return Ok(());
        };

        let Ok(task) = self.get_task(task_id).await else {
            return Ok(());
        };

        let mut events = self
            .list_events(EventListQuery {
                project_id: None,
                linked_task_id: Some(task_id),
            })
            .await?;
        events.sort_by(|left, right| left.start_at.cmp(&right.start_at));

        if let Some(event) = events.first() {
            let status = if task.status.is_terminal() {
                None
            } else {
                Some(TaskStatus::Scheduled)
            };
            let _ = self
                .update_task(
                    task_id,
                    UpdateTaskRequest {
                        scheduled_start: Some(Some(event.start_at.clone())),
                        scheduled_end: Some(Some(event.end_at.clone())),
                        status,
                        source: Some(SourceKind::System),
                        ..Default::default()
                    },
                )
                .await?;
            return Ok(());
        }

        let status = if task.status.is_terminal() {
            None
        } else {
            Some(TaskStatus::Todo)
        };
        let _ = self
            .update_task(
                task_id,
                UpdateTaskRequest {
                    scheduled_start: Some(None),
                    scheduled_end: Some(None),
                    status,
                    source: Some(SourceKind::System),
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    fn map_store_error(error: anyhow::Error) -> AppError {
        let message = error.to_string();
        if message.contains("UNIQUE constraint failed") {
            return AppError::Conflict(message);
        }
        AppError::Internal(error)
    }
}

fn task_matches_day(task: &Task, day: chrono::NaiveDate) -> bool {
    task.due_at
        .as_deref()
        .and_then(|value| parse_rfc3339(value).ok())
        .map(|due| due.date_naive() == day)
        .unwrap_or(false)
        || task
            .scheduled_start
            .as_deref()
            .and_then(|value| parse_rfc3339(value).ok())
            .map(|start| start.date_naive() == day)
            .unwrap_or(false)
}

fn validate_timestamp_pair(start: Option<&str>, end: Option<&str>) -> AppResult<()> {
    match (start, end) {
        (Some(start), Some(end)) => {
            let start = parse_rfc3339(start)?;
            let end = parse_rfc3339(end)?;
            if end <= start {
                return Err(AppError::Validation(
                    "end timestamp must be after start timestamp".to_string(),
                ));
            }
            Ok(())
        }
        (None, None) => Ok(()),
        _ => Err(AppError::Validation(
            "start and end timestamps must both be present".to_string(),
        )),
    }
}

fn validate_task_state(
    project_id: Option<i64>,
    status: TaskStatus,
    scheduled_start: Option<&str>,
    scheduled_end: Option<&str>,
) -> AppResult<()> {
    if status == TaskStatus::Inbox && project_id.is_some() {
        return Err(AppError::Validation(
            "inbox tasks cannot belong to a project".to_string(),
        ));
    }
    if status == TaskStatus::Scheduled && (scheduled_start.is_none() || scheduled_end.is_none()) {
        return Err(AppError::Validation(
            "scheduled tasks must include both scheduled_start and scheduled_end".to_string(),
        ));
    }
    Ok(())
}

fn validate_recurrence(input: &CreateEventRequest) -> AppResult<()> {
    validate_recurrence_payload(
        &input.start_at,
        &input.end_at,
        &input.timezone,
        input.rrule.as_deref(),
        &input.recurrence_exceptions,
    )
}

fn validate_recurrence_event(event: &Event) -> AppResult<()> {
    validate_recurrence_payload(
        &event.start_at,
        &event.end_at,
        &event.timezone,
        event.rrule.as_deref(),
        &event.recurrence_exceptions,
    )
}

fn validate_recurrence_payload(
    start_at: &str,
    end_at: &str,
    timezone: &str,
    rrule: Option<&str>,
    recurrence_exceptions: &[String],
) -> AppResult<()> {
    parse_rfc3339(start_at)?;
    parse_rfc3339(end_at)?;
    let _ = parse_timezone(timezone)?;

    if rrule.is_none() && !recurrence_exceptions.is_empty() {
        return Err(AppError::Validation(
            "recurrence exceptions require an RRULE".to_string(),
        ));
    }

    for exception in recurrence_exceptions {
        parse_rfc3339(exception)?;
    }
    if let Some(rule) = rrule {
        if rule.trim().is_empty() {
            return Err(AppError::Validation(
                "recurrence rule must not be empty".to_string(),
            ));
        }
        let _ = build_rrule_set(start_at, timezone, rule.trim(), recurrence_exceptions)?;
    }
    Ok(())
}

fn expand_event(
    event: &Event,
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
) -> AppResult<Vec<CalendarOccurrence>> {
    let event_start = parse_rfc3339(&event.start_at)?;
    let event_end = parse_rfc3339(&event.end_at)?;
    let duration = event_end - event_start;

    if let Some(rule) = &event.rrule {
        let after = to_rrule_utc(range_start - duration)?;
        let before = to_rrule_utc(range_end)?;
        let rrule_set = build_rrule_set(
            &event.start_at,
            &event.timezone,
            rule,
            &event.recurrence_exceptions,
        )?;
        let occurrences = rrule_set.after(after).before(before).all(4096).dates;

        let mut expanded = Vec::new();
        for occurrence in occurrences {
            let occurrence_start = occurrence.with_timezone(&Utc);
            let occurrence_end = occurrence_start + duration;
            if occurrence_start < range_end && occurrence_end > range_start {
                expanded.push(CalendarOccurrence {
                    event_id: event.id,
                    title: event.title.clone(),
                    description: event.description.clone(),
                    project_id: event.project_id,
                    linked_task_id: event.linked_task_id,
                    occurrence_start: occurrence_start.to_rfc3339(),
                    occurrence_end: occurrence_end.to_rfc3339(),
                    timezone: event.timezone.clone(),
                    event_type: event.event_type,
                    is_recurring: true,
                    notes: event.notes.clone(),
                });
            }
        }
        return Ok(expanded);
    }

    if event_start < range_end && event_end > range_start {
        Ok(vec![CalendarOccurrence {
            event_id: event.id,
            title: event.title.clone(),
            description: event.description.clone(),
            project_id: event.project_id,
            linked_task_id: event.linked_task_id,
            occurrence_start: event.start_at.clone(),
            occurrence_end: event.end_at.clone(),
            timezone: event.timezone.clone(),
            event_type: event.event_type,
            is_recurring: false,
            notes: event.notes.clone(),
        }])
    } else {
        Ok(Vec::new())
    }
}

fn build_rrule_set(
    start_at: &str,
    timezone: &str,
    rule: &str,
    exceptions: &[String],
) -> AppResult<RRuleSet> {
    let dt_start = parse_rfc3339(start_at)?;
    let timezone = parse_timezone(timezone)?;
    let local_start = dt_start.with_timezone(&timezone);
    let mut payload = format!(
        "DTSTART;TZID={timezone}:{}\nRRULE:{}",
        local_start.format("%Y%m%dT%H%M%S"),
        rule
    );
    for exception in exceptions {
        let exception = parse_rfc3339(exception)?;
        let local_exception = exception.with_timezone(&timezone);
        payload.push_str(&format!(
            "\nEXDATE;TZID={timezone}:{}",
            local_exception.format("%Y%m%dT%H%M%S")
        ));
    }
    payload
        .parse::<RRuleSet>()
        .map_err(|error| AppError::Validation(format!("invalid recurrence rule: {error}")))
}

fn parse_timezone(value: &str) -> AppResult<Tz> {
    value
        .parse::<ChronoTz>()
        .map(Into::into)
        .map_err(|_| {
            AppError::Validation(format!(
                "invalid timezone '{value}'; use an IANA timezone like 'UTC' or 'Africa/Kampala'"
            ))
        })
}

fn to_rrule_utc(value: DateTime<Utc>) -> ForgeResult<DateTime<Tz>> {
    DateTime::parse_from_rfc3339(&value.to_rfc3339())
        .map(|value| value.with_timezone(&Tz::UTC))
        .map_err(|_| ValidationError::new("failed to convert UTC timestamp to recurrence timezone"))
}

fn apply_event_patch(existing: &Event, input: &UpdateEventRequest) -> Event {
    let mut updated = existing.clone();
    if let Some(title) = &input.title {
        updated.title = title.clone();
    }
    if let Some(description) = &input.description {
        updated.description = description.clone();
    }
    if let Some(project_id) = input.project_id {
        updated.project_id = project_id;
    }
    if let Some(linked_task_id) = input.linked_task_id {
        updated.linked_task_id = linked_task_id;
    }
    if let Some(start_at) = &input.start_at {
        updated.start_at = start_at.clone();
    }
    if let Some(end_at) = &input.end_at {
        updated.end_at = end_at.clone();
    }
    if let Some(timezone) = &input.timezone {
        updated.timezone = timezone.clone();
    }
    if let Some(event_type) = input.event_type {
        updated.event_type = event_type;
    }
    if let Some(rrule) = &input.rrule {
        updated.rrule = rrule.clone();
    }
    if let Some(recurrence_exceptions) = &input.recurrence_exceptions {
        updated.recurrence_exceptions = recurrence_exceptions.clone();
    }
    if let Some(notes) = &input.notes {
        updated.notes = notes.clone();
    }
    updated
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{CalendarRangeQuery, EventType, ProjectStatus, SourceKind, TaskPriority};
    use tempfile::tempdir;

    async fn service() -> ForgeService {
        let temp = tempdir().expect("tempdir");
        let db_path = temp.path().join("forge-test.db");
        let url = format!("sqlite://{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = SqliteStore::new(&url).await.expect("sqlite store");
        store.run_migrations().await.expect("migrations");
        std::mem::forget(temp);
        ForgeService::new(store)
    }

    #[tokio::test]
    async fn creates_and_aggregates_today_flow() {
        let service = service().await;
        let project = service
            .create_project(CreateProjectRequest {
                name: "Forge".to_string(),
                description: "Build Forge".to_string(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#6f8466".to_string(),
            })
            .await
            .expect("project");

        let task = service
            .create_task(CreateTaskRequest {
                title: "Finish daemon".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                status: TaskStatus::Todo,
                priority: TaskPriority::High,
                due_at: Some(Utc::now().to_rfc3339()),
                scheduled_start: None,
                scheduled_end: None,
                estimate_minutes: Some(90),
                tags: vec![],
                notes: String::new(),
                source: SourceKind::Ui,
            })
            .await
            .expect("task");

        let _focus = service
            .set_focus(SetFocusRequest {
                project_id: project.id,
                task_id: Some(task.id),
                source: SourceKind::Ui,
            })
            .await
            .expect("focus");

        let _event = service
            .create_event(CreateEventRequest {
                title: "Deep work".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: Utc::now().to_rfc3339(),
                end_at: (Utc::now() + Duration::minutes(90)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::WorkBlock,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");

        let today = service.today().await.expect("today summary");
        assert_eq!(today.focus.as_ref().map(|focus| focus.task_id), Some(Some(task.id)));
        assert!(today.today_tasks.iter().any(|item| item.id == task.id));
        assert!(!today.today_events.is_empty());
    }

    #[tokio::test]
    async fn expands_rrule_events_within_range() {
        let service = service().await;
        let project = service
            .create_project(CreateProjectRequest {
                name: "Research".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#d96b2b".to_string(),
            })
            .await
            .expect("project");

        let start = Utc::now();
        service
            .create_event(CreateEventRequest {
                title: "Review papers".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: None,
                start_at: start.to_rfc3339(),
                end_at: (start + Duration::hours(1)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::Research,
                rrule: Some("FREQ=DAILY;COUNT=3".to_string()),
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("recurring event");

        let events = service
            .calendar_range(CalendarRangeQuery {
                start: start.to_rfc3339(),
                end: (start + Duration::days(3)).to_rfc3339(),
            })
            .await
            .expect("calendar range");

        assert!(events.len() >= 3);
    }

    #[tokio::test]
    async fn deleting_last_linked_event_resets_task_schedule() {
        let service = service().await;
        let project = service
            .create_project(CreateProjectRequest {
                name: "Runtime".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#456257".to_string(),
            })
            .await
            .expect("project");

        let task = service
            .create_task(CreateTaskRequest {
                title: "Stabilize daemon".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                status: TaskStatus::Todo,
                priority: TaskPriority::High,
                due_at: None,
                scheduled_start: None,
                scheduled_end: None,
                estimate_minutes: Some(60),
                tags: vec![],
                notes: String::new(),
                source: SourceKind::Ui,
            })
            .await
            .expect("task");

        let start = Utc::now();
        let event = service
            .create_event(CreateEventRequest {
                title: "Work block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: start.to_rfc3339(),
                end_at: (start + Duration::minutes(90)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::WorkBlock,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");

        service.delete_event(event.id).await.expect("delete event");

        let refreshed = service.get_task(task.id).await.expect("task after delete");
        assert_eq!(refreshed.status, TaskStatus::Todo);
        assert_eq!(refreshed.scheduled_start, None);
        assert_eq!(refreshed.scheduled_end, None);
    }

    #[tokio::test]
    async fn deleting_project_preserves_tasks_and_nulls_project_links() {
        let service = service().await;
        let project = service
            .create_project(CreateProjectRequest {
                name: "Atlas".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#91503f".to_string(),
            })
            .await
            .expect("project");

        let task = service
            .create_task(CreateTaskRequest {
                title: "Refactor client".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                status: TaskStatus::Todo,
                priority: TaskPriority::Medium,
                due_at: None,
                scheduled_start: None,
                scheduled_end: None,
                estimate_minutes: None,
                tags: vec![],
                notes: String::new(),
                source: SourceKind::Ui,
            })
            .await
            .expect("task");

        let event = service
            .create_event(CreateEventRequest {
                title: "Review block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: Utc::now().to_rfc3339(),
                end_at: (Utc::now() + Duration::minutes(30)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::Review,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");

        service.delete_project(project.id).await.expect("delete project");

        let refreshed_task = service.get_task(task.id).await.expect("task still exists");
        let refreshed_event = service.get_event(event.id).await.expect("event still exists");

        assert_eq!(refreshed_task.project_id, None);
        assert_eq!(refreshed_event.project_id, None);
    }

    #[tokio::test]
    async fn updating_task_fields_and_status_sets_completion_metadata() {
        let service = service().await;
        let project = service
            .create_project(CreateProjectRequest {
                name: "Mutation".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec!["active".to_string()],
                color: "#3d6b80".to_string(),
            })
            .await
            .expect("project");

        let task = service
            .create_task(CreateTaskRequest {
                title: "Patch task".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                status: TaskStatus::Todo,
                priority: TaskPriority::Low,
                due_at: None,
                scheduled_start: None,
                scheduled_end: None,
                estimate_minutes: None,
                tags: vec![],
                notes: String::new(),
                source: SourceKind::Ui,
            })
            .await
            .expect("task");

        let updated = service
            .update_task(
                task.id,
                UpdateTaskRequest {
                    title: Some("Patch task deeply".to_string()),
                    description: Some("updated".to_string()),
                    project_id: Some(None),
                    status: Some(TaskStatus::Done),
                    priority: Some(TaskPriority::Urgent),
                    due_at: Some(Some(Utc::now().to_rfc3339())),
                    scheduled_start: None,
                    scheduled_end: None,
                    estimate_minutes: Some(Some(45)),
                    tags: Some(vec!["cli".to_string(), "mutation".to_string()]),
                    notes: Some("ship it".to_string()),
                    source: Some(SourceKind::Cli),
                },
            )
            .await
            .expect("updated task");

        assert_eq!(updated.title, "Patch task deeply");
        assert_eq!(updated.description, "updated");
        assert_eq!(updated.project_id, None);
        assert_eq!(updated.status, TaskStatus::Done);
        assert_eq!(updated.priority, TaskPriority::Urgent);
        assert_eq!(updated.estimate_minutes, Some(45));
        assert_eq!(updated.tags, vec!["cli".to_string(), "mutation".to_string()]);
        assert_eq!(updated.notes, "ship it");
        assert_eq!(updated.source, SourceKind::Cli);
        assert!(updated.completed_at.is_some());
    }

    #[tokio::test]
    async fn deleting_task_removes_linked_events() {
        let service = service().await;
        let project = service
            .create_project(CreateProjectRequest {
                name: "Cascade".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#2a5e47".to_string(),
            })
            .await
            .expect("project");

        let task = service
            .create_task(CreateTaskRequest {
                title: "Delete me".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                status: TaskStatus::Todo,
                priority: TaskPriority::Medium,
                due_at: None,
                scheduled_start: None,
                scheduled_end: None,
                estimate_minutes: None,
                tags: vec![],
                notes: String::new(),
                source: SourceKind::Ui,
            })
            .await
            .expect("task");

        let start = Utc::now();
        let event = service
            .create_event(CreateEventRequest {
                title: "Linked block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: start.to_rfc3339(),
                end_at: (start + Duration::minutes(30)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::Implementation,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");

        service.delete_task(task.id).await.expect("delete task");

        let tasks = service
            .list_tasks(TaskListQuery::default())
            .await
            .expect("tasks");
        let events = service
            .list_events(EventListQuery {
                project_id: None,
                linked_task_id: Some(task.id),
            })
            .await
            .expect("events");

        assert!(!tasks.iter().any(|item| item.id == task.id));
        assert!(events.is_empty(), "linked event {} should be deleted", event.id);
    }

    #[tokio::test]
    async fn rejects_invalid_event_timezones() {
        let service = service().await;

        let error = service
            .create_event(CreateEventRequest {
                title: "Broken timezone".to_string(),
                description: String::new(),
                project_id: None,
                linked_task_id: None,
                start_at: "2026-03-10T09:00:00Z".to_string(),
                end_at: "2026-03-10T10:00:00Z".to_string(),
                timezone: "Mars/Olympus".to_string(),
                event_type: EventType::Research,
                rrule: Some("FREQ=DAILY;COUNT=2".to_string()),
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect_err("invalid timezone should fail");

        assert!(
            error.to_string().contains("invalid timezone"),
            "unexpected error: {error}"
        );
    }

    #[tokio::test]
    async fn invalid_event_patch_does_not_persist() {
        let service = service().await;
        let event = service
            .create_event(CreateEventRequest {
                title: "Stable series".to_string(),
                description: String::new(),
                project_id: None,
                linked_task_id: None,
                start_at: "2026-03-10T09:00:00Z".to_string(),
                end_at: "2026-03-10T10:00:00Z".to_string(),
                timezone: "UTC".to_string(),
                event_type: EventType::Research,
                rrule: Some("FREQ=DAILY;COUNT=2".to_string()),
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");

        let error = service
            .update_event(
                event.id,
                UpdateEventRequest {
                    timezone: Some("Mars/Olympus".to_string()),
                    ..Default::default()
                },
            )
            .await
            .expect_err("invalid patch should fail");

        assert!(
            error.to_string().contains("invalid timezone"),
            "unexpected error: {error}"
        );

        let reloaded = service.get_event(event.id).await.expect("event after failed patch");
        assert_eq!(reloaded.timezone, "UTC");
        assert_eq!(reloaded.rrule.as_deref(), Some("FREQ=DAILY;COUNT=2"));
    }

    #[tokio::test]
    async fn recurrence_expansion_respects_event_timezone_across_dst() {
        let service = service().await;
        service
            .create_event(CreateEventRequest {
                title: "New York standup".to_string(),
                description: String::new(),
                project_id: None,
                linked_task_id: None,
                start_at: "2026-10-26T09:00:00-04:00".to_string(),
                end_at: "2026-10-26T10:00:00-04:00".to_string(),
                timezone: "America/New_York".to_string(),
                event_type: EventType::Meeting,
                rrule: Some("FREQ=WEEKLY;COUNT=2".to_string()),
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("recurring event");

        let occurrences = service
            .calendar_range(CalendarRangeQuery {
                start: "2026-10-25T00:00:00Z".to_string(),
                end: "2026-11-03T23:59:59Z".to_string(),
            })
            .await
            .expect("calendar range");

        let starts: Vec<_> = occurrences
            .iter()
            .map(|occurrence| occurrence.occurrence_start.as_str())
            .collect();
        assert_eq!(starts, vec!["2026-10-26T13:00:00+00:00", "2026-11-02T14:00:00+00:00"]);
    }

    #[tokio::test]
    async fn updating_recurring_event_preserves_linked_task_and_refreshes_schedule() {
        let service = service().await;
        let project = service
            .create_project(CreateProjectRequest {
                name: "Calendar hardening".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#38586f".to_string(),
            })
            .await
            .expect("project");

        let task = service
            .create_task(CreateTaskRequest {
                title: "Linked recurrence".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                status: TaskStatus::Todo,
                priority: TaskPriority::High,
                due_at: None,
                scheduled_start: None,
                scheduled_end: None,
                estimate_minutes: None,
                tags: vec![],
                notes: String::new(),
                source: SourceKind::Ui,
            })
            .await
            .expect("task");

        let event = service
            .create_event(CreateEventRequest {
                title: "Recurring block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: "2026-03-09T09:00:00-04:00".to_string(),
                end_at: "2026-03-09T10:00:00-04:00".to_string(),
                timezone: "America/New_York".to_string(),
                event_type: EventType::Implementation,
                rrule: Some("FREQ=WEEKLY;COUNT=2".to_string()),
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");

        let updated = service
            .update_event(
                event.id,
                UpdateEventRequest {
                    start_at: Some("2026-03-09T11:00:00-04:00".to_string()),
                    end_at: Some("2026-03-09T12:30:00-04:00".to_string()),
                    ..Default::default()
                },
            )
            .await
            .expect("updated event");

        let refreshed_task = service.get_task(task.id).await.expect("task after event update");
        assert_eq!(updated.linked_task_id, Some(task.id));
        assert_eq!(refreshed_task.scheduled_start.as_deref(), Some("2026-03-09T11:00:00-04:00"));
        assert_eq!(refreshed_task.scheduled_end.as_deref(), Some("2026-03-09T12:30:00-04:00"));
    }
}
