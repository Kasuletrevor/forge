use std::sync::Arc;

use app::{AppError, ForgeService};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use domain::{
    CalendarRangeQuery, CreateEventRequest, CreateProjectRequest, CreateTaskRequest, EventListQuery,
    ForgePaths, HealthResponse, ImportProjectsRequest, SetFocusRequest, TaskListQuery,
    UpdateEventRequest, UpdateProjectRequest, UpdateTaskRequest, DEFAULT_API_HOST,
    DEFAULT_API_PORT,
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[derive(Clone)]
pub struct ApiState {
    service: Arc<ForgeService>,
    health: HealthResponse,
}

type SharedState = Arc<ApiState>;

pub fn router(service: ForgeService) -> Router {
    let health_response = HealthResponse {
        status: "ok".to_string(),
        api_base_url: format!("http://{DEFAULT_API_HOST}:{DEFAULT_API_PORT}"),
        paths: ForgePaths::from_root(std::path::PathBuf::new()),
        started_at: domain::now_timestamp(),
        first_run: false,
    };
    router_with_health(service, health_response)
}

pub fn router_with_health(service: ForgeService, health_response: HealthResponse) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/today", get(today))
        .route("/calendar/range", get(calendar_range))
        .route("/projects", get(list_projects).post(create_project))
        .route("/projects/import", post(import_projects))
        .route("/projects/statuses", get(list_project_statuses))
        .route("/projects/resolve-by-path", get(resolve_project_by_path))
        .route(
            "/projects/{id}",
            get(get_project).patch(update_project).delete(delete_project),
        )
        .route("/projects/{id}/status", get(get_project_status))
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/clear-done", post(clear_done_tasks))
        .route(
            "/tasks/{id}",
            get(get_task).patch(update_task).delete(delete_task),
        )
        .route("/tasks/{id}/complete", post(complete_task))
        .route("/events", get(list_events).post(create_event))
        .route(
            "/events/{id}",
            get(get_event).patch(update_event).delete(delete_event),
        )
        .route("/focus", get(get_focus).post(set_focus).delete(clear_focus))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(Arc::new(ApiState {
            service: Arc::new(service),
            health: health_response,
        }))
}

#[derive(Debug, Deserialize)]
struct ProjectListQuery {
    include_archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ResolveProjectByPathQuery {
    cwd: String,
}

#[derive(Debug, Serialize)]
struct ClearDoneResponse {
    cleared: u64,
}

async fn health(State(state): State<SharedState>) -> ApiResult<impl IntoResponse> {
    state.service.health().await?;
    Ok(Json(state.health.clone()))
}

async fn today(State(state): State<SharedState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.today().await?))
}

async fn calendar_range(
    State(state): State<SharedState>,
    Query(query): Query<CalendarRangeQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.calendar_range(query).await?))
}

async fn list_projects(
    State(state): State<SharedState>,
    Query(query): Query<ProjectListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(
        state.service
            .list_projects(query.include_archived.unwrap_or(false))
            .await?,
    ))
}

async fn get_project(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.get_project(id).await?))
}

async fn list_project_statuses(
    State(state): State<SharedState>,
    Query(query): Query<ProjectListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(
        state.service
            .list_project_statuses(query.include_archived.unwrap_or(false))
            .await?,
    ))
}

async fn get_project_status(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.get_project_status(id).await?))
}

async fn resolve_project_by_path(
    State(state): State<SharedState>,
    Query(query): Query<ResolveProjectByPathQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.resolve_project_by_path(&query.cwd).await?))
}

async fn create_project(
    State(state): State<SharedState>,
    Json(payload): Json<CreateProjectRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(state.service.create_project(payload).await?)))
}

async fn import_projects(
    State(state): State<SharedState>,
    Json(payload): Json<ImportProjectsRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.import_projects(payload).await?))
}

async fn update_project(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateProjectRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.update_project(id, payload).await?))
}

async fn delete_project(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    state.service.delete_project(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_tasks(
    State(state): State<SharedState>,
    Query(query): Query<TaskListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.list_tasks(query).await?))
}

async fn get_task(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.get_task(id).await?))
}

async fn create_task(
    State(state): State<SharedState>,
    Json(payload): Json<CreateTaskRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(state.service.create_task(payload).await?)))
}

async fn update_task(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateTaskRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.update_task(id, payload).await?))
}

async fn delete_task(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    state.service.delete_task(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn complete_task(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.complete_task(id).await?))
}

async fn clear_done_tasks(State(state): State<SharedState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(ClearDoneResponse {
        cleared: state.service.clear_done_tasks().await?,
    }))
}

async fn list_events(
    State(state): State<SharedState>,
    Query(query): Query<EventListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.list_events(query).await?))
}

async fn get_event(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.get_event(id).await?))
}

async fn create_event(
    State(state): State<SharedState>,
    Json(payload): Json<CreateEventRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(state.service.create_event(payload).await?)))
}

async fn update_event(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateEventRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.update_event(id, payload).await?))
}

async fn delete_event(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    state.service.delete_event(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_focus(State(state): State<SharedState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.get_focus().await?))
}

async fn set_focus(
    State(state): State<SharedState>,
    Json(payload): Json<SetFocusRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(state.service.set_focus(payload).await?))
}

async fn clear_focus(State(state): State<SharedState>) -> ApiResult<impl IntoResponse> {
    state.service.clear_focus().await?;
    Ok(StatusCode::NO_CONTENT)
}

type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug)]
struct ApiError(AppError);

impl From<AppError> for ApiError {
    fn from(value: AppError) -> Self {
        Self(value)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self.0 {
            AppError::NotFound(message) => (StatusCode::NOT_FOUND, message.to_string()),
            AppError::Validation(message) => (StatusCode::BAD_REQUEST, message),
            AppError::Conflict(message) => (StatusCode::CONFLICT, message),
            AppError::Internal(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("internal error: {error}"),
            ),
        };

        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
