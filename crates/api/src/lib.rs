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
    SetFocusRequest, TaskListQuery, UpdateEventRequest, UpdateProjectRequest, UpdateTaskRequest,
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

pub type ApiState = Arc<ForgeService>;

pub fn router(service: ForgeService) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/today", get(today))
        .route("/calendar/range", get(calendar_range))
        .route("/projects", get(list_projects).post(create_project))
        .route(
            "/projects/{id}",
            get(get_project).patch(update_project).delete(delete_project),
        )
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
        .with_state(Arc::new(service))
}

#[derive(Debug, Deserialize)]
struct ProjectListQuery {
    include_archived: Option<bool>,
}

#[derive(Debug, Serialize)]
struct ClearDoneResponse {
    cleared: u64,
}

async fn health(State(service): State<ApiState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.health().await?))
}

async fn today(State(service): State<ApiState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.today().await?))
}

async fn calendar_range(
    State(service): State<ApiState>,
    Query(query): Query<CalendarRangeQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.calendar_range(query).await?))
}

async fn list_projects(
    State(service): State<ApiState>,
    Query(query): Query<ProjectListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(
        service
            .list_projects(query.include_archived.unwrap_or(false))
            .await?,
    ))
}

async fn get_project(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.get_project(id).await?))
}

async fn create_project(
    State(service): State<ApiState>,
    Json(payload): Json<CreateProjectRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(service.create_project(payload).await?)))
}

async fn update_project(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateProjectRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.update_project(id, payload).await?))
}

async fn delete_project(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    service.delete_project(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_tasks(
    State(service): State<ApiState>,
    Query(query): Query<TaskListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.list_tasks(query).await?))
}

async fn get_task(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.get_task(id).await?))
}

async fn create_task(
    State(service): State<ApiState>,
    Json(payload): Json<CreateTaskRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(service.create_task(payload).await?)))
}

async fn update_task(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateTaskRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.update_task(id, payload).await?))
}

async fn delete_task(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    service.delete_task(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn complete_task(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.complete_task(id).await?))
}

async fn clear_done_tasks(State(service): State<ApiState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(ClearDoneResponse {
        cleared: service.clear_done_tasks().await?,
    }))
}

async fn list_events(
    State(service): State<ApiState>,
    Query(query): Query<EventListQuery>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.list_events(query).await?))
}

async fn get_event(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.get_event(id).await?))
}

async fn create_event(
    State(service): State<ApiState>,
    Json(payload): Json<CreateEventRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok((StatusCode::CREATED, Json(service.create_event(payload).await?)))
}

async fn update_event(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateEventRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.update_event(id, payload).await?))
}

async fn delete_event(
    State(service): State<ApiState>,
    Path(id): Path<i64>,
) -> ApiResult<impl IntoResponse> {
    service.delete_event(id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_focus(State(service): State<ApiState>) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.get_focus().await?))
}

async fn set_focus(
    State(service): State<ApiState>,
    Json(payload): Json<SetFocusRequest>,
) -> ApiResult<impl IntoResponse> {
    Ok(Json(service.set_focus(payload).await?))
}

async fn clear_focus(State(service): State<ApiState>) -> ApiResult<impl IntoResponse> {
    service.clear_focus().await?;
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
