use std::{
    env,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{Days, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use clap::{Args, Parser, Subcommand};
use domain::{
    CalendarOccurrence, CreateEventRequest, CreateProjectRequest, CreateTaskRequest, Event,
    EventListQuery, FocusState, Project, ProjectStatus, ProjectSummary, SetFocusRequest,
    SourceKind, Task, TaskListQuery, TaskStatus, TodaySummary, UpdateEventRequest,
    UpdateProjectRequest, UpdateTaskRequest, DEFAULT_API_HOST, DEFAULT_API_PORT,
    default_project_color, parse_rfc3339,
};
use reqwest::Client;
use serde::Serialize;

#[derive(Debug, Parser)]
#[command(name = "forge", about = "Forge CLI")]
struct ForgeCli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Today,
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    Task {
        #[command(subcommand)]
        command: TaskCommand,
    },
    Event {
        #[command(subcommand)]
        command: EventCommand,
    },
    Cal {
        #[command(subcommand)]
        command: CalendarCommand,
    },
    Focus {
        #[command(subcommand)]
        command: FocusCommand,
    },
}

#[derive(Debug, Subcommand)]
enum ProjectCommand {
    Add(ProjectAddArgs),
    List,
    Show(ProjectRefArg),
    Edit(ProjectEditArgs),
    Delete(ProjectDeleteArgs),
}

#[derive(Debug, Args)]
struct ProjectAddArgs {
    name: String,
    #[arg(long, default_value = "")]
    description: String,
    #[arg(long, default_value_t = default_project_color())]
    color: String,
}

#[derive(Debug, Args)]
struct ProjectRefArg {
    project: String,
}

#[derive(Debug, Args)]
struct ProjectEditArgs {
    project: String,
    #[arg(long)]
    name: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long)]
    color: Option<String>,
    #[arg(long)]
    status: Option<String>,
    #[arg(long = "tag")]
    tags: Vec<String>,
    #[arg(long)]
    clear_tags: bool,
}

#[derive(Debug, Args)]
struct ProjectDeleteArgs {
    project: String,
    #[arg(long)]
    yes: bool,
}

#[derive(Debug, Subcommand)]
enum TaskCommand {
    Add(TaskAddArgs),
    List(TaskListArgs),
    Today,
    Done(TaskIdArg),
    ClearDone,
    Edit(TaskEditArgs),
    Delete(TaskDeleteArgs),
}

#[derive(Debug, Args)]
struct TaskAddArgs {
    title: String,
    #[arg(long)]
    project: Option<String>,
    #[arg(long, default_value = "")]
    description: String,
    #[arg(long = "due", alias = "due-at")]
    due_at: Option<String>,
    #[arg(long)]
    scheduled_start: Option<String>,
    #[arg(long)]
    scheduled_end: Option<String>,
    #[arg(long, default_value = "medium")]
    priority: String,
}

#[derive(Debug, Args, Default)]
struct TaskListArgs {
    #[arg(long)]
    project: Option<String>,
    #[arg(long)]
    inbox: bool,
    #[arg(long)]
    status: Option<String>,
    #[arg(long)]
    overdue: bool,
    #[arg(long)]
    scheduled: bool,
}

#[derive(Debug, Args)]
struct TaskIdArg {
    id: i64,
}

#[derive(Debug, Args)]
struct TaskEditArgs {
    id: i64,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long)]
    project: Option<String>,
    #[arg(long)]
    inbox: bool,
    #[arg(long)]
    priority: Option<String>,
    #[arg(long = "due", alias = "due-at")]
    due_at: Option<String>,
    #[arg(long)]
    clear_due: bool,
    #[arg(long)]
    estimate_minutes: Option<i32>,
    #[arg(long)]
    clear_estimate: bool,
    #[arg(long = "tag")]
    tags: Vec<String>,
    #[arg(long)]
    clear_tags: bool,
    #[arg(long)]
    notes: Option<String>,
    #[arg(long)]
    status: Option<String>,
}

#[derive(Debug, Args)]
struct TaskDeleteArgs {
    id: i64,
    #[arg(long)]
    yes: bool,
}

#[derive(Debug, Subcommand)]
enum EventCommand {
    Add(EventAddArgs),
    List(EventListArgs),
    Edit(EventEditArgs),
    Delete(EventDeleteArgs),
}

#[derive(Debug, Subcommand)]
enum CalendarCommand {
    Today,
    Week,
}

#[derive(Debug, Args)]
struct EventAddArgs {
    title: String,
    #[arg(long)]
    project: Option<String>,
    #[arg(long)]
    task: Option<i64>,
    #[arg(long)]
    start: String,
    #[arg(long)]
    end: String,
    #[arg(long, default_value = "UTC")]
    timezone: String,
    #[arg(long, default_value = "implementation")]
    event_type: String,
    #[arg(long)]
    rrule: Option<String>,
    #[arg(long, default_value = "")]
    notes: String,
}

#[derive(Debug, Args, Default)]
struct EventListArgs {
    #[arg(long)]
    project: Option<String>,
    #[arg(long)]
    task: Option<i64>,
}

#[derive(Debug, Args)]
struct EventEditArgs {
    id: i64,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long)]
    project: Option<String>,
    #[arg(long)]
    unassign_project: bool,
    #[arg(long)]
    start: Option<String>,
    #[arg(long)]
    end: Option<String>,
    #[arg(long)]
    timezone: Option<String>,
    #[arg(long)]
    notes: Option<String>,
    #[arg(long)]
    rrule: Option<String>,
    #[arg(long)]
    clear_rrule: bool,
    #[arg(long)]
    event_type: Option<String>,
}

#[derive(Debug, Args)]
struct EventDeleteArgs {
    id: i64,
    #[arg(long)]
    yes: bool,
}

#[derive(Debug, Subcommand)]
enum FocusCommand {
    Set(FocusSetArgs),
    Show,
    Clear,
}

#[derive(Debug, Args)]
struct FocusSetArgs {
    #[arg(long)]
    project: String,
    #[arg(long)]
    task: Option<i64>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = ForgeCli::parse();
    let api = ForgeApi::connect().await?;
    run(cli, &api).await
}

async fn run(cli: ForgeCli, api: &ForgeApi) -> Result<()> {
    match cli.command {
        Commands::Today => print_today(&api.get_today().await?),
        Commands::Project {
            command: ProjectCommand::Add(args),
        } => {
            let project = api
                .create_project(CreateProjectRequest {
                    name: args.name,
                    description: args.description,
                    status: ProjectStatus::Active,
                    tags: Vec::new(),
                    color: args.color,
                })
                .await?;
            println!("[{}] {} ({})", project.id, project.name, project.slug);
        }
        Commands::Project {
            command: ProjectCommand::List,
        } => {
            for summary in api.list_projects(false).await? {
                println!(
                    "[{}] {}  status={}  open={}  upcoming={}",
                    summary.project.id,
                    summary.project.name,
                    to_json_label(summary.project.status)?,
                    summary.open_task_count,
                    summary.upcoming_event_count
                );
            }
        }
        Commands::Project {
            command: ProjectCommand::Show(arg),
        } => {
            let project = api.resolve_project(&arg.project).await?;
            println!("[{}] {} ({})", project.id, project.name, project.slug);
            println!("status: {}", to_json_label(project.status)?);
            println!("color: {}", project.color);
            if !project.description.is_empty() {
                println!("description: {}", project.description);
            }
            if !project.tags.is_empty() {
                println!("tags: {}", project.tags.join(", "));
            }
        }
        Commands::Project {
            command: ProjectCommand::Edit(args),
        } => {
            let project = api.resolve_project(&args.project).await?;
            let payload = UpdateProjectRequest {
                name: args.name,
                description: args.description,
                status: args.status.as_deref().map(parse_json_enum).transpose()?,
                tags: tags_update(args.tags, args.clear_tags),
                color: args.color,
            };
            ensure_project_patch(&payload)?;
            let updated = api.update_project(project.id, payload).await?;
            println!("[{}] {} ({})", updated.id, updated.name, updated.slug);
        }
        Commands::Project {
            command: ProjectCommand::Delete(args),
        } => {
            let project = api.resolve_project(&args.project).await?;
            if args.yes
                || confirm(&format!(
                    "Delete project '{}' and move its tasks/events to Inbox/unassigned?",
                    project.name
                ))?
            {
                api.delete_project(project.id).await?;
                println!("deleted project [{}] {}", project.id, project.name);
            }
        }
        Commands::Task {
            command: TaskCommand::Add(args),
        } => {
            let project_id = match args.project {
                Some(reference) => Some(api.resolve_project(&reference).await?.id),
                None => None,
            };
            let task = api
                .create_task(CreateTaskRequest {
                    title: args.title,
                    description: args.description,
                    project_id,
                    status: TaskStatus::Todo,
                    priority: parse_json_enum(&args.priority)?,
                    due_at: args
                        .due_at
                        .as_deref()
                        .map(parse_human_timestamp)
                        .transpose()?,
                    scheduled_start: args
                        .scheduled_start
                        .as_deref()
                        .map(parse_human_timestamp)
                        .transpose()?,
                    scheduled_end: args
                        .scheduled_end
                        .as_deref()
                        .map(parse_human_timestamp)
                        .transpose()?,
                    estimate_minutes: None,
                    tags: Vec::new(),
                    notes: String::new(),
                    source: SourceKind::Cli,
                })
                .await?;
            println!("[{}] {}", task.id, task.title);
        }
        Commands::Task {
            command: TaskCommand::List(args),
        } => {
            let project_id = match args.project {
                Some(reference) => Some(api.resolve_project(&reference).await?.id),
                None => None,
            };
            let tasks = api
                .list_tasks(TaskListQuery {
                    project_id,
                    inbox_only: if args.inbox { Some(true) } else { None },
                    status: args.status.as_deref().map(parse_json_enum).transpose()?,
                    priority: None,
                    due_today: None,
                    overdue: if args.overdue { Some(true) } else { None },
                    scheduled: if args.scheduled { Some(true) } else { None },
                    search: None,
                })
                .await?;
            print_tasks(&tasks);
        }
        Commands::Task {
            command: TaskCommand::Today,
        } => {
            print_tasks(&api.get_today().await?.today_tasks);
        }
        Commands::Task {
            command: TaskCommand::Done(arg),
        } => {
            let task = api.complete_task(arg.id).await?;
            println!("completed [{}] {}", task.id, task.title);
        }
        Commands::Task {
            command: TaskCommand::ClearDone,
        } => {
            let cleared = api.clear_done().await?;
            println!("cleared {cleared} completed tasks");
        }
        Commands::Task {
            command: TaskCommand::Edit(args),
        } => {
            if args.inbox && args.project.is_some() {
                bail!("use either --project or --inbox, not both");
            }
            let project_id = if args.inbox {
                Some(None)
            } else if let Some(reference) = args.project.as_deref() {
                Some(Some(api.resolve_project(reference).await?.id))
            } else {
                None
            };
            let payload = UpdateTaskRequest {
                title: args.title,
                description: args.description,
                project_id,
                status: args.status.as_deref().map(parse_json_enum).transpose()?,
                priority: args.priority.as_deref().map(parse_json_enum).transpose()?,
                due_at: if args.clear_due {
                    Some(None)
                } else {
                    args.due_at
                        .as_deref()
                        .map(parse_human_timestamp)
                        .transpose()?
                        .map(Some)
                },
                scheduled_start: None,
                scheduled_end: None,
                estimate_minutes: if args.clear_estimate {
                    Some(None)
                } else {
                    args.estimate_minutes.map(Some)
                },
                tags: tags_update(args.tags, args.clear_tags),
                notes: args.notes,
                source: Some(SourceKind::Cli),
            };
            ensure_task_patch(&payload)?;
            let updated = api.update_task(args.id, payload).await?;
            println!("[{}] {}", updated.id, updated.title);
        }
        Commands::Task {
            command: TaskCommand::Delete(args),
        } => {
            let task = api.get_task(args.id).await?;
            let linked_events = api
                .list_events(EventListQuery {
                    project_id: None,
                    linked_task_id: Some(args.id),
                })
                .await?;
            let confirmed = if args.yes {
                true
            } else if linked_events.is_empty() {
                confirm(&format!("Delete task '{}'?", task.title))?
            } else {
                confirm(&format!(
                    "Delete task '{}' and {} linked calendar block(s)?",
                    task.title,
                    linked_events.len()
                ))?
            };
            if confirmed {
                api.delete_task(args.id).await?;
                println!("deleted task [{}] {}", task.id, task.title);
            }
        }
        Commands::Event {
            command: EventCommand::Add(args),
        } => {
            let project_id = match args.project {
                Some(reference) => Some(api.resolve_project(&reference).await?.id),
                None => None,
            };
            let event = api
                .create_event(CreateEventRequest {
                    title: args.title,
                    description: String::new(),
                    project_id,
                    linked_task_id: args.task,
                    start_at: parse_human_timestamp(&args.start)?,
                    end_at: parse_human_timestamp(&args.end)?,
                    timezone: args.timezone,
                    event_type: parse_json_enum(&args.event_type)?,
                    rrule: args.rrule,
                    recurrence_exceptions: Vec::new(),
                    notes: args.notes,
                })
                .await?;
            println!("[{}] {}", event.id, event.title);
        }
        Commands::Event {
            command: EventCommand::List(args),
        } => {
            let project_id = match args.project.as_deref() {
                Some(reference) => Some(api.resolve_project(reference).await?.id),
                None => None,
            };
            let events = api
                .list_events(EventListQuery {
                    project_id,
                    linked_task_id: args.task,
                })
                .await?;
            print_events(&events);
        }
        Commands::Event {
            command: EventCommand::Edit(args),
        } => {
            if args.unassign_project && args.project.is_some() {
                bail!("use either --project or --unassign-project, not both");
            }
            let project_id = if args.unassign_project {
                Some(None)
            } else if let Some(reference) = args.project.as_deref() {
                Some(Some(api.resolve_project(reference).await?.id))
            } else {
                None
            };
            let payload = UpdateEventRequest {
                title: args.title,
                description: args.description,
                project_id,
                linked_task_id: None,
                start_at: args.start.as_deref().map(parse_human_timestamp).transpose()?,
                end_at: args.end.as_deref().map(parse_human_timestamp).transpose()?,
                timezone: args.timezone,
                event_type: args.event_type.as_deref().map(parse_json_enum).transpose()?,
                rrule: if args.clear_rrule {
                    Some(None)
                } else {
                    args.rrule.map(Some)
                },
                recurrence_exceptions: None,
                notes: args.notes,
            };
            ensure_event_patch(&payload)?;
            let updated = api.update_event(args.id, payload).await?;
            println!("[{}] {}", updated.id, updated.title);
        }
        Commands::Event {
            command: EventCommand::Delete(args),
        } => {
            let event = api.get_event(args.id).await?;
            if args.yes || confirm(&format!("Delete event '{}'?", event.title))? {
                api.delete_event(args.id).await?;
                println!("deleted event [{}] {}", event.id, event.title);
            }
        }
        Commands::Cal {
            command: CalendarCommand::Today,
        } => {
            let now = Local::now();
            let start = now.date_naive().and_hms_opt(0, 0, 0).unwrap();
            let end = (now.date_naive() + Days::new(1))
                .and_hms_opt(0, 0, 0)
                .unwrap();
            print_occurrences(
                &api
                    .calendar_range(
                        localize(start)?.with_timezone(&Utc),
                        localize(end)?.with_timezone(&Utc),
                    )
                    .await?,
            );
        }
        Commands::Cal {
            command: CalendarCommand::Week,
        } => {
            let now = Utc::now();
            print_occurrences(&api.calendar_range(now, now + chrono::Duration::days(7)).await?);
        }
        Commands::Focus {
            command: FocusCommand::Set(args),
        } => {
            let project = api.resolve_project(&args.project).await?;
            let focus = api
                .set_focus(SetFocusRequest {
                    project_id: project.id,
                    task_id: args.task,
                    source: SourceKind::Cli,
                })
                .await?;
            print_focus(&Some(focus));
        }
        Commands::Focus {
            command: FocusCommand::Show,
        } => print_focus(&api.get_focus().await?),
        Commands::Focus {
            command: FocusCommand::Clear,
        } => {
            api.clear_focus().await?;
            println!("focus cleared");
        }
    }

    Ok(())
}

#[derive(Clone)]
struct ForgeApi {
    client: Client,
    base_url: String,
}

impl ForgeApi {
    async fn connect() -> Result<Self> {
        ensure_daemon_running().await?;
        let base_url = format!("http://{DEFAULT_API_HOST}:{DEFAULT_API_PORT}");
        let client = Client::builder().timeout(Duration::from_secs(5)).build()?;
        let api = Self { client, base_url };
        let _ = api.health().await?;
        Ok(api)
    }

    async fn health(&self) -> Result<String> {
        let payload: serde_json::Value = self
            .client
            .get(format!("{}/health", self.base_url))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(payload["status"].as_str().unwrap_or("unknown").to_string())
    }

    async fn list_projects(&self, include_archived: bool) -> Result<Vec<ProjectSummary>> {
        self.get_json(&format!("/projects?include_archived={include_archived}"))
            .await
    }

    async fn resolve_project(&self, reference: &str) -> Result<Project> {
        if let Ok(id) = reference.parse::<i64>() {
            return self.get_json(&format!("/projects/{id}")).await;
        }
        let projects = self.list_projects(true).await?;
        projects
            .into_iter()
            .map(|summary| summary.project)
            .find(|project| {
                project.slug == reference || project.name.eq_ignore_ascii_case(reference)
            })
            .ok_or_else(|| anyhow!("project '{reference}' not found"))
    }
    async fn create_project(&self, payload: CreateProjectRequest) -> Result<Project> {
        self.post_json("/projects", &payload).await
    }

    async fn update_project(&self, id: i64, payload: UpdateProjectRequest) -> Result<Project> {
        self.patch_json(&format!("/projects/{id}"), &payload).await
    }

    async fn delete_project(&self, id: i64) -> Result<()> {
        self.delete_empty(&format!("/projects/{id}")).await
    }

    async fn create_task(&self, payload: CreateTaskRequest) -> Result<Task> {
        self.post_json("/tasks", &payload).await
    }

    async fn get_task(&self, id: i64) -> Result<Task> {
        self.get_json(&format!("/tasks/{id}")).await
    }

    async fn list_tasks(&self, query: TaskListQuery) -> Result<Vec<Task>> {
        let query_string = serde_urlencoded::to_string(&query)?;
        self.get_json(&format!("/tasks?{query_string}")).await
    }

    async fn update_task(&self, id: i64, payload: UpdateTaskRequest) -> Result<Task> {
        self.patch_json(&format!("/tasks/{id}"), &payload).await
    }

    async fn delete_task(&self, id: i64) -> Result<()> {
        self.delete_empty(&format!("/tasks/{id}")).await
    }

    async fn complete_task(&self, id: i64) -> Result<Task> {
        self.post_empty(&format!("/tasks/{id}/complete")).await
    }

    async fn clear_done(&self) -> Result<u64> {
        let value: serde_json::Value = self.post_empty("/tasks/clear-done").await?;
        Ok(value["cleared"].as_u64().unwrap_or_default())
    }

    async fn list_events(&self, query: EventListQuery) -> Result<Vec<Event>> {
        let query_string = serde_urlencoded::to_string(&query)?;
        let path = if query_string.is_empty() {
            "/events".to_string()
        } else {
            format!("/events?{query_string}")
        };
        self.get_json(&path).await
    }

    async fn get_event(&self, id: i64) -> Result<Event> {
        self.get_json(&format!("/events/{id}")).await
    }

    async fn create_event(&self, payload: CreateEventRequest) -> Result<Event> {
        self.post_json("/events", &payload).await
    }

    async fn update_event(&self, id: i64, payload: UpdateEventRequest) -> Result<Event> {
        self.patch_json(&format!("/events/{id}"), &payload).await
    }

    async fn delete_event(&self, id: i64) -> Result<()> {
        self.delete_empty(&format!("/events/{id}")).await
    }

    async fn calendar_range(
        &self,
        start: chrono::DateTime<Utc>,
        end: chrono::DateTime<Utc>,
    ) -> Result<Vec<CalendarOccurrence>> {
        self.get_json(&format!(
            "/calendar/range?start={}&end={}",
            urlencoding::encode(&start.to_rfc3339()),
            urlencoding::encode(&end.to_rfc3339())
        ))
        .await
    }

    async fn get_focus(&self) -> Result<Option<FocusState>> {
        self.get_json("/focus").await
    }

    async fn set_focus(&self, payload: SetFocusRequest) -> Result<FocusState> {
        self.post_json("/focus", &payload).await
    }

    async fn clear_focus(&self) -> Result<()> {
        self.delete_empty("/focus").await
    }

    async fn get_today(&self) -> Result<TodaySummary> {
        self.get_json("/today").await
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.client
            .get(format!("{}{}", self.base_url, path))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .map_err(Into::into)
    }

    async fn post_json<T: serde::de::DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        self.client
            .post(format!("{}{}", self.base_url, path))
            .json(body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .map_err(Into::into)
    }

    async fn patch_json<T: serde::de::DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        self.client
            .patch(format!("{}{}", self.base_url, path))
            .json(body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .map_err(Into::into)
    }

    async fn post_empty<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.client
            .post(format!("{}{}", self.base_url, path))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .map_err(Into::into)
    }

    async fn delete_empty(&self, path: &str) -> Result<()> {
        self.client
            .delete(format!("{}{}", self.base_url, path))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}

async fn ensure_daemon_running() -> Result<()> {
    let client = Client::builder().timeout(Duration::from_millis(600)).build()?;
    let health_url = format!("http://{DEFAULT_API_HOST}:{DEFAULT_API_PORT}/health");
    if client.get(&health_url).send().await.is_ok() {
        return Ok(());
    }

    spawn_forged_process()?;
    for _ in 0..20 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if client.get(&health_url).send().await.is_ok() {
            return Ok(());
        }
    }

    bail!("Forge daemon did not become ready")
}

fn spawn_forged_process() -> Result<()> {
    let sibling = sibling_forged_binary();
    if sibling.exists() {
        Command::new(sibling)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .spawn()
            .context("failed to start sibling forged binary")?;
        return Ok(());
    }

    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .context("failed to locate workspace root")?
        .to_path_buf();
    Command::new("cargo")
        .args(["run", "-p", "forged"])
        .current_dir(workspace_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .context("failed to start forged via cargo run")?;
    Ok(())
}

fn sibling_forged_binary() -> PathBuf {
    let exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("forge"));
    let binary = if cfg!(windows) { "forged.exe" } else { "forged" };
    exe.with_file_name(binary)
}
fn print_today(summary: &TodaySummary) {
    println!("Today {}", summary.date);
    print_focus(&summary.focus);
    println!();
    println!("Tasks");
    print_tasks(&summary.today_tasks);
    println!();
    println!("Overdue");
    print_tasks(&summary.overdue_tasks);
    println!();
    println!("Events");
    print_occurrences(&summary.today_events);
}

fn print_focus(focus: &Option<FocusState>) {
    match focus {
        Some(focus) => println!(
            "Focus: project={} task={:?} since={}",
            focus.project_id, focus.task_id, focus.started_at
        ),
        None => println!("Focus: none"),
    }
}

fn print_tasks(tasks: &[Task]) {
    if tasks.is_empty() {
        println!("(none)");
        return;
    }

    for task in tasks {
        let due = task
            .due_at
            .as_deref()
            .and_then(|value| parse_rfc3339(value).ok())
            .map(|value| value.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_else(|| "-".to_string());
        println!(
            "[{}] {}  status={}  priority={}  due={}  project={}",
            task.id,
            task.title,
            to_json_label(task.status).unwrap_or_else(|_| "unknown".to_string()),
            to_json_label(task.priority).unwrap_or_else(|_| "unknown".to_string()),
            due,
            task.project_id
                .map(|value| value.to_string())
                .unwrap_or_else(|| "inbox".to_string())
        );
    }
}

fn print_events(events: &[Event]) {
    if events.is_empty() {
        println!("(none)");
        return;
    }
    for event in events {
        println!(
            "[{}] {}  {} -> {}  project={}  recurring={}",
            event.id,
            event.title,
            event.start_at,
            event.end_at,
            event
                .project_id
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unassigned".to_string()),
            event.rrule.is_some()
        );
    }
}

fn print_occurrences(events: &[CalendarOccurrence]) {
    if events.is_empty() {
        println!("(none)");
        return;
    }
    for event in events {
        println!(
            "[event {}] {}  {} -> {}  project={}",
            event.event_id,
            event.title,
            event.occurrence_start,
            event.occurrence_end,
            event
                .project_id
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unassigned".to_string())
        );
    }
}

fn parse_json_enum<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    serde_json::from_value(serde_json::Value::String(value.to_string())).map_err(Into::into)
}

fn to_json_label<T: Serialize>(value: T) -> Result<String> {
    serde_json::to_value(value)?
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| anyhow!("enum did not serialize to string"))
}

fn confirm(prompt: &str) -> Result<bool> {
    print!("{prompt} [y/N]: ");
    io::stdout().flush().context("failed to flush prompt")?;
    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .context("failed to read confirmation")?;
    let normalized = input.trim().to_ascii_lowercase();
    Ok(matches!(normalized.as_str(), "y" | "yes"))
}

fn ensure_project_patch(payload: &UpdateProjectRequest) -> Result<()> {
    if payload.name.is_none()
        && payload.description.is_none()
        && payload.status.is_none()
        && payload.tags.is_none()
        && payload.color.is_none()
    {
        bail!("no project fields supplied")
    }
    Ok(())
}

fn ensure_task_patch(payload: &UpdateTaskRequest) -> Result<()> {
    if payload.title.is_none()
        && payload.description.is_none()
        && payload.project_id.is_none()
        && payload.status.is_none()
        && payload.priority.is_none()
        && payload.due_at.is_none()
        && payload.scheduled_start.is_none()
        && payload.scheduled_end.is_none()
        && payload.estimate_minutes.is_none()
        && payload.tags.is_none()
        && payload.notes.is_none()
    {
        bail!("no task fields supplied")
    }
    Ok(())
}

fn ensure_event_patch(payload: &UpdateEventRequest) -> Result<()> {
    if payload.title.is_none()
        && payload.description.is_none()
        && payload.project_id.is_none()
        && payload.start_at.is_none()
        && payload.end_at.is_none()
        && payload.timezone.is_none()
        && payload.event_type.is_none()
        && payload.rrule.is_none()
        && payload.notes.is_none()
    {
        bail!("no event fields supplied")
    }
    Ok(())
}

fn tags_update(values: Vec<String>, clear: bool) -> Option<Vec<String>> {
    if clear {
        Some(Vec::new())
    } else if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn parse_human_timestamp(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        bail!("timestamp cannot be empty");
    }

    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Ok(parsed.with_timezone(&Utc).to_rfc3339());
    }

    let lower = trimmed.to_ascii_lowercase();
    match lower.as_str() {
        "now" => return Ok(Utc::now().to_rfc3339()),
        "today" => {
            let dt = Local::now()
                .date_naive()
                .and_hms_opt(17, 0, 0)
                .context("invalid local due timestamp")?;
            return Ok(localize(dt)?.with_timezone(&Utc).to_rfc3339());
        }
        "tomorrow" => {
            let dt = (Local::now().date_naive() + Days::new(1))
                .and_hms_opt(17, 0, 0)
                .context("invalid local due timestamp")?;
            return Ok(localize(dt)?.with_timezone(&Utc).to_rfc3339());
        }
        _ => {}
    }

    if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M") {
        return Ok(localize(parsed)?.with_timezone(&Utc).to_rfc3339());
    }

    if let Ok(parsed) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let dt = parsed
            .and_hms_opt(17, 0, 0)
            .context("invalid local due timestamp")?;
        return Ok(localize(dt)?.with_timezone(&Utc).to_rfc3339());
    }

    bail!("unsupported timestamp format: {trimmed}")
}

fn localize(value: NaiveDateTime) -> Result<chrono::DateTime<Local>> {
    match Local.from_local_datetime(&value) {
        LocalResult::Single(dt) => Ok(dt),
        LocalResult::Ambiguous(dt, _) => Ok(dt),
        LocalResult::None => bail!("local timestamp does not exist: {value}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app::ForgeService;
    use axum::serve;
    use domain::{CreateEventRequest, CreateProjectRequest, CreateTaskRequest, EventType, TaskPriority};
    use persistence_sqlite::SqliteStore;
    use tempfile::tempdir;
    use tokio::{net::TcpListener, task::JoinHandle};

    struct TestHarness {
        service: ForgeService,
        api: ForgeApi,
        server: JoinHandle<()>,
    }

    impl Drop for TestHarness {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    async fn harness() -> TestHarness {
        let temp = tempdir().expect("tempdir");
        let db_path = temp.path().join("forge-cli-test.db");
        let url = format!("sqlite://{}", db_path.to_string_lossy().replace('\\', "/"));
        let store = SqliteStore::new(&url).await.expect("sqlite store");
        store.run_migrations().await.expect("migrations");
        std::mem::forget(temp);

        let service = ForgeService::new(store);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let addr = listener.local_addr().expect("local addr");
        let server_service = service.clone();
        let server = tokio::spawn(async move {
            serve(listener, api::router(server_service))
                .await
                .expect("server");
        });

        let api = ForgeApi {
            client: Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .expect("client"),
            base_url: format!("http://{}", addr),
        };

        TestHarness {
            service,
            api,
            server,
        }
    }

    #[tokio::test]
    async fn project_edit_command_updates_project() {
        let harness = harness().await;
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Forge".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#6f8466".to_string(),
            })
            .await
            .expect("project");
        let project_id = project.id.to_string();

        run(
            ForgeCli::parse_from([
                "forge",
                "project",
                "edit",
                project_id.as_str(),
                "--name",
                "Forge Prime",
                "--description",
                "core system",
                "--color",
                "#123456",
                "--status",
                "paused",
                "--tag",
                "phase2",
            ]),
            &harness.api,
        )
        .await
        .expect("run project edit");

        let updated = harness
            .service
            .get_project(project.id)
            .await
            .expect("project after edit");
        assert_eq!(updated.name, "Forge Prime");
        assert_eq!(updated.description, "core system");
        assert_eq!(updated.color, "#123456");
        assert_eq!(updated.status, ProjectStatus::Paused);
        assert_eq!(updated.tags, vec!["phase2".to_string()]);
    }

    #[tokio::test]
    async fn task_edit_command_updates_fields() {
        let harness = harness().await;
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Ship".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#7b5b41".to_string(),
            })
            .await
            .expect("project");
        let task = harness
            .service
            .create_task(CreateTaskRequest {
                title: "Patch".to_string(),
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
        let task_id = task.id.to_string();

        run(
            ForgeCli::parse_from([
                "forge",
                "task",
                "edit",
                task_id.as_str(),
                "--title",
                "Patch release",
                "--inbox",
                "--priority",
                "urgent",
                "--status",
                "done",
                "--estimate-minutes",
                "90",
                "--tag",
                "mutation",
                "--notes",
                "verified",
            ]),
            &harness.api,
        )
        .await
        .expect("run task edit");

        let updated = harness
            .service
            .get_task(task.id)
            .await
            .expect("task after edit");
        assert_eq!(updated.title, "Patch release");
        assert_eq!(updated.project_id, None);
        assert_eq!(updated.priority, TaskPriority::Urgent);
        assert_eq!(updated.status, TaskStatus::Done);
        assert_eq!(updated.estimate_minutes, Some(90));
        assert_eq!(updated.tags, vec!["mutation".to_string()]);
        assert_eq!(updated.notes, "verified");
        assert!(updated.completed_at.is_some());
    }

    #[tokio::test]
    async fn event_edit_command_updates_schedule_and_preserves_task_link() {
        let harness = harness().await;
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Calendar".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#5a4c7b".to_string(),
            })
            .await
            .expect("project");
        let task = harness
            .service
            .create_task(CreateTaskRequest {
                title: "Research".to_string(),
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
        let event = harness
            .service
            .create_event(CreateEventRequest {
                title: "Research block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: start.to_rfc3339(),
                end_at: (start + chrono::Duration::minutes(60)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::Research,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");
        let event_id = event.id.to_string();

        run(
            ForgeCli::parse_from([
                "forge",
                "event",
                "edit",
                event_id.as_str(),
                "--title",
                "Research review",
                "--unassign-project",
                "--start",
                "2026-03-10T14:00:00Z",
                "--end",
                "2026-03-10T16:00:00Z",
                "--event-type",
                "review",
                "--notes",
                "rescheduled",
            ]),
            &harness.api,
        )
        .await
        .expect("run event edit");

        let updated = harness
            .service
            .get_event(event.id)
            .await
            .expect("event after edit");
        assert_eq!(updated.title, "Research review");
        assert_eq!(updated.project_id, None);
        assert_eq!(updated.linked_task_id, Some(task.id));
        assert_eq!(updated.start_at, "2026-03-10T14:00:00+00:00");
        assert_eq!(updated.end_at, "2026-03-10T16:00:00+00:00");
        assert_eq!(updated.event_type, EventType::Review);
        assert_eq!(updated.notes, "rescheduled");
    }

    #[tokio::test]
    async fn delete_event_command_preserves_task() {
        let harness = harness().await;
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Lifecycle".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#46645b".to_string(),
            })
            .await
            .expect("project");
        let task = harness
            .service
            .create_task(CreateTaskRequest {
                title: "Keep task".to_string(),
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
        let event = harness
            .service
            .create_event(CreateEventRequest {
                title: "Only block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: start.to_rfc3339(),
                end_at: (start + chrono::Duration::minutes(45)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::WorkBlock,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");
        let event_id = event.id.to_string();

        run(
            ForgeCli::parse_from(["forge", "event", "delete", event_id.as_str(), "--yes"]),
            &harness.api,
        )
        .await
        .expect("run event delete");

        let refreshed = harness
            .service
            .get_task(task.id)
            .await
            .expect("task after delete");
        assert_eq!(refreshed.status, TaskStatus::Todo);
        assert_eq!(refreshed.scheduled_start, None);
        assert_eq!(refreshed.scheduled_end, None);
        assert!(
            harness.service.get_event(event.id).await.is_err(),
            "event should be gone"
        );
    }

    #[tokio::test]
    async fn delete_task_command_removes_linked_events() {
        let harness = harness().await;
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Cascade".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#7a5137".to_string(),
            })
            .await
            .expect("project");
        let task = harness
            .service
            .create_task(CreateTaskRequest {
                title: "Delete task".to_string(),
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
        harness
            .service
            .create_event(CreateEventRequest {
                title: "Linked block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: Utc::now().to_rfc3339(),
                end_at: (Utc::now() + chrono::Duration::minutes(30)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::Implementation,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");
        let task_id = task.id.to_string();

        run(
            ForgeCli::parse_from(["forge", "task", "delete", task_id.as_str(), "--yes"]),
            &harness.api,
        )
        .await
        .expect("run task delete");

        assert!(
            harness.service.get_task(task.id).await.is_err(),
            "task should be gone"
        );
        let events = harness
            .service
            .list_events(EventListQuery {
                project_id: None,
                linked_task_id: Some(task.id),
            })
            .await
            .expect("events");
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn delete_project_command_moves_tasks_to_inbox() {
        let harness = harness().await;
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Archive".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#446274".to_string(),
            })
            .await
            .expect("project");
        let task = harness
            .service
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
        let event = harness
            .service
            .create_event(CreateEventRequest {
                title: "Keep block".to_string(),
                description: String::new(),
                project_id: Some(project.id),
                linked_task_id: Some(task.id),
                start_at: Utc::now().to_rfc3339(),
                end_at: (Utc::now() + chrono::Duration::minutes(30)).to_rfc3339(),
                timezone: "UTC".to_string(),
                event_type: EventType::Review,
                rrule: None,
                recurrence_exceptions: vec![],
                notes: String::new(),
            })
            .await
            .expect("event");
        let project_name = project.name.clone();

        run(
            ForgeCli::parse_from(["forge", "project", "delete", project_name.as_str(), "--yes"]),
            &harness.api,
        )
        .await
        .expect("run project delete");

        let refreshed_task = harness
            .service
            .get_task(task.id)
            .await
            .expect("task after delete");
        let refreshed_event = harness
            .service
            .get_event(event.id)
            .await
            .expect("event after delete");
        assert_eq!(refreshed_task.project_id, None);
        assert_eq!(refreshed_event.project_id, None);
    }
}
