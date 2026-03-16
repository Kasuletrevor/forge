use app::ForgeService;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use chrono::{Duration, Utc};
use domain::{
    CreateEventRequest, CreateProjectRequest, CreateTaskRequest, EventType, ProjectStatus,
    SourceKind, TaskPriority, TaskStatus, UpdateEventRequest, UpdateProjectRequest,
    UpdateTaskRequest,
};
use persistence_sqlite::SqliteStore;
use tempfile::tempdir;
use tower::util::ServiceExt;

async fn service() -> ForgeService {
    let temp = tempdir().expect("tempdir");
    let db_path = temp.path().join("forge-api-test.db");
    let url = format!("sqlite://{}", db_path.to_string_lossy().replace('\\', "/"));
    let store = SqliteStore::new(&url).await.expect("sqlite store");
    store.run_migrations().await.expect("migrations");
    std::mem::forget(temp);
    ForgeService::new(store)
}

async fn json<T: serde::de::DeserializeOwned>(response: axum::response::Response) -> T {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    serde_json::from_slice(&body).expect("json body")
}

#[tokio::test]
async fn patch_project_updates_metadata() {
    let service = service().await;
    let project = service
        .create_project(CreateProjectRequest {
            name: "Forge".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#6f8466".to_string(),
        workdir_path: None,
        })
        .await
        .expect("project");

    let app = api::router(service);
    let response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/projects/{}", project.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&UpdateProjectRequest {
                        name: Some("Forge v2".to_string()),
                        description: Some("updated".to_string()),
                        status: Some(ProjectStatus::Paused),
                        tags: Some(vec!["mutated".to_string()]),
                        color: Some("#123456".to_string()),
                    workdir_path: None,
                    })
                    .expect("payload"),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let payload: domain::Project = json(response).await;
    assert_eq!(payload.name, "Forge v2");
    assert_eq!(payload.description, "updated");
    assert_eq!(payload.status, ProjectStatus::Paused);
    assert_eq!(payload.tags, vec!["mutated".to_string()]);
    assert_eq!(payload.color, "#123456");
    assert_eq!(payload.slug, project.slug);
}

#[tokio::test]
async fn patch_project_sets_and_clears_workdir_path() {
    let service = service().await;
    let temp = tempdir().expect("tempdir");
    let workdir = temp.path().join("forge");
    std::fs::create_dir_all(&workdir).expect("workdir");
    let project = service
        .create_project(CreateProjectRequest {
            name: "Forge".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#556b5f".to_string(),
            workdir_path: None,
        })
        .await
        .expect("project");

    let app = api::router(service.clone());
    let set_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/projects/{}", project.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "workdir_path": workdir.to_string_lossy()
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(set_response.status(), StatusCode::OK);
    let linked: domain::Project = json(set_response).await;
    assert!(linked.workdir_path.is_some());

    let clear_response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/projects/{}", project.id))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::json!({ "workdir_path": null }).to_string()))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(clear_response.status(), StatusCode::OK);
    let cleared: domain::Project = json(clear_response).await;
    assert_eq!(cleared.workdir_path, None);
}

#[tokio::test]
async fn patch_task_marks_completion_and_moves_to_inbox() {
    let service = service().await;
    let project = service
        .create_project(CreateProjectRequest {
            name: "Ops".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#8a6a44".to_string(),
        workdir_path: None,
        })
        .await
        .expect("project");
    let task = service
        .create_task(CreateTaskRequest {
            title: "Ship release".to_string(),
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

    let app = api::router(service);
    let response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/tasks/{}", task.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&UpdateTaskRequest {
                        title: Some("Ship stable release".to_string()),
                        description: Some("high confidence".to_string()),
                        project_id: Some(None),
                        status: Some(TaskStatus::Done),
                        priority: Some(TaskPriority::High),
                        due_at: Some(Some(Utc::now().to_rfc3339())),
                        scheduled_start: None,
                        scheduled_end: None,
                        estimate_minutes: Some(Some(120)),
                        tags: Some(vec!["release".to_string()]),
                        notes: Some("verified".to_string()),
                        source: Some(SourceKind::Cli),
                    })
                    .expect("payload"),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let payload: domain::Task = json(response).await;
    assert_eq!(payload.title, "Ship stable release");
    assert_eq!(payload.project_id, None);
    assert_eq!(payload.status, TaskStatus::Done);
    assert_eq!(payload.priority, TaskPriority::High);
    assert_eq!(payload.tags, vec!["release".to_string()]);
    assert_eq!(payload.notes, "verified");
    assert!(payload.completed_at.is_some());
}

#[tokio::test]
async fn patch_event_preserves_linked_task() {
    let service = service().await;
    let project = service
        .create_project(CreateProjectRequest {
            name: "Calendar".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#6b4d8c".to_string(),
        workdir_path: None,
        })
        .await
        .expect("project");
    let task = service
        .create_task(CreateTaskRequest {
            title: "Deep work".to_string(),
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
    let start = Utc::now();
    let event = service
        .create_event(CreateEventRequest {
            title: "Work block".to_string(),
            description: String::new(),
            project_id: Some(project.id),
            linked_task_id: Some(task.id),
            start_at: start.to_rfc3339(),
            end_at: (start + Duration::minutes(60)).to_rfc3339(),
            timezone: "UTC".to_string(),
            event_type: EventType::WorkBlock,
            rrule: None,
            recurrence_exceptions: vec![],
            notes: String::new(),
        })
        .await
        .expect("event");

    let app = api::router(service);
    let response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/events/{}", event.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(&UpdateEventRequest {
                        title: Some("Rescheduled block".to_string()),
                        description: Some("updated".to_string()),
                        project_id: Some(None),
                        linked_task_id: None,
                        start_at: Some((start + Duration::days(1)).to_rfc3339()),
                        end_at: Some((start + Duration::days(1) + Duration::minutes(90)).to_rfc3339()),
                        timezone: Some("UTC".to_string()),
                        event_type: Some(EventType::Review),
                        rrule: Some(None),
                        recurrence_exceptions: None,
                        notes: Some("kept task link".to_string()),
                    })
                    .expect("payload"),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let payload: domain::Event = json(response).await;
    assert_eq!(payload.title, "Rescheduled block");
    assert_eq!(payload.project_id, None);
    assert_eq!(payload.linked_task_id, Some(task.id));
    assert_eq!(payload.event_type, EventType::Review);
    assert_eq!(payload.rrule, None);
}

#[tokio::test]
async fn project_status_and_path_resolution_endpoints_reflect_linked_directories() {
    let service = service().await;
    let temp = tempdir().expect("tempdir");
    let repo_root = temp.path().join("workspace");
    let nested = repo_root.join("nested");
    let leaf = nested.join("src");
    std::fs::create_dir_all(&leaf).expect("nested path");

    let parent = service
        .create_project(CreateProjectRequest {
            name: "Workspace".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#516b70".to_string(),
            workdir_path: Some(repo_root.to_string_lossy().into_owned()),
        })
        .await
        .expect("parent");
    let child = service
        .create_project(CreateProjectRequest {
            name: "Nested".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#5a5f77".to_string(),
            workdir_path: Some(nested.to_string_lossy().into_owned()),
        })
        .await
        .expect("child");

    let app = api::router(service);

    let status_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/projects/{}/status", child.id))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(status_response.status(), StatusCode::OK);
    let status: domain::ProjectRepoStatus = json(status_response).await;
    assert_eq!(status.project_id, child.id);
    assert_eq!(status.workdir_path.as_deref(), child.workdir_path.as_deref());
    assert!(!status.is_git_repo);

    let resolve_response = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/projects/resolve-by-path?cwd={}",
                    urlencoding::encode(&leaf.to_string_lossy())
                ))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(resolve_response.status(), StatusCode::OK);
    let resolved: domain::Project = json(resolve_response).await;
    assert_eq!(resolved.id, child.id);
    assert_ne!(resolved.id, parent.id);
}

#[tokio::test]
async fn delete_event_preserves_task_and_normalizes_schedule() {
    let service = service().await;
    let project = service
        .create_project(CreateProjectRequest {
            name: "Lifecycle".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#335f57".to_string(),
        workdir_path: None,
        })
        .await
        .expect("project");
    let task = service
        .create_task(CreateTaskRequest {
            title: "Calibrate lifecycle".to_string(),
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
            title: "Only block".to_string(),
            description: String::new(),
            project_id: Some(project.id),
            linked_task_id: Some(task.id),
            start_at: start.to_rfc3339(),
            end_at: (start + Duration::minutes(45)).to_rfc3339(),
            timezone: "UTC".to_string(),
            event_type: EventType::WorkBlock,
            rrule: None,
            recurrence_exceptions: vec![],
            notes: String::new(),
        })
        .await
        .expect("event");

    let app = api::router(service.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/events/{}", event.id))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let refreshed = service.get_task(task.id).await.expect("task after delete");
    assert_eq!(refreshed.status, TaskStatus::Todo);
    assert_eq!(refreshed.scheduled_start, None);
    assert_eq!(refreshed.scheduled_end, None);
}

#[tokio::test]
async fn delete_task_removes_linked_events() {
    let service = service().await;
    let project = service
        .create_project(CreateProjectRequest {
            name: "Cascade".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#774b39".to_string(),
        workdir_path: None,
        })
        .await
        .expect("project");
    let task = service
        .create_task(CreateTaskRequest {
            title: "Remove linked blocks".to_string(),
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
            title: "Block".to_string(),
            description: String::new(),
            project_id: Some(project.id),
            linked_task_id: Some(task.id),
            start_at: Utc::now().to_rfc3339(),
            end_at: (Utc::now() + Duration::minutes(30)).to_rfc3339(),
            timezone: "UTC".to_string(),
            event_type: EventType::Implementation,
            rrule: None,
            recurrence_exceptions: vec![],
            notes: String::new(),
        })
        .await
        .expect("event");

    let app = api::router(service.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/tasks/{}", task.id))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let linked_events = service
        .list_events(domain::EventListQuery {
            project_id: None,
            linked_task_id: Some(task.id),
        })
        .await
        .expect("events");
    assert!(linked_events.is_empty(), "linked event {} should be gone", event.id);
}

#[tokio::test]
async fn delete_project_moves_tasks_to_inbox_and_unassigns_events() {
    let service = service().await;
    let project = service
        .create_project(CreateProjectRequest {
            name: "Inbox".to_string(),
            description: String::new(),
            status: ProjectStatus::Active,
            tags: vec![],
            color: "#34555e".to_string(),
        workdir_path: None,
        })
        .await
        .expect("project");
    let task = service
        .create_task(CreateTaskRequest {
            title: "Keep task".to_string(),
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
    let event = service
        .create_event(CreateEventRequest {
            title: "Keep event".to_string(),
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

    let app = api::router(service.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/projects/{}", project.id))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let refreshed_task = service.get_task(task.id).await.expect("task after delete");
    let refreshed_event = service.get_event(event.id).await.expect("event after delete");
    assert_eq!(refreshed_task.project_id, None);
    assert_eq!(refreshed_event.project_id, None);
}

#[tokio::test]
async fn patch_event_rejects_invalid_timezone_without_persisting() {
    let service = service().await;
    let event = service
        .create_event(CreateEventRequest {
            title: "Stable block".to_string(),
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

    let app = api::router(service.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/events/{}", event.id))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "timezone": "Mars/Olympus"
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let payload: serde_json::Value = json(response).await;
    let error = payload
        .get("error")
        .and_then(serde_json::Value::as_str)
        .expect("error message");
    assert!(error.contains("invalid timezone"));

    let refreshed = service.get_event(event.id).await.expect("event after failed patch");
    assert_eq!(refreshed.timezone, "UTC");
    assert_eq!(refreshed.rrule.as_deref(), Some("FREQ=DAILY;COUNT=2"));
}
