use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use chrono::{Days, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use clap::{Args, Parser, Subcommand};
use domain::{
    CalendarOccurrence, CreateEventRequest, CreateProjectRequest, CreateTaskRequest, Event,
    EventListQuery, FocusState, ForgePaths, HealthResponse, ImportProjectsRequest,
    ImportProjectsResponse, Project, ProjectRepoStatus, ProjectStatus, ProjectSummary,
    SetFocusRequest, SourceKind, Task, TaskListQuery, TaskStatus, TodaySummary,
    UpdateEventRequest, UpdateProjectRequest, UpdateTaskRequest, DEFAULT_API_HOST,
    DEFAULT_API_PORT, default_project_color, parse_rfc3339,
};
use reqwest::header::{ACCEPT, HeaderMap, HeaderValue, USER_AGENT};
use reqwest::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Parser)]
#[command(name = "forge", about = "Forge CLI", version)]
struct ForgeCli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Today,
    Update(UpdateArgs),
    Doctor,
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
    Import(ProjectImportArgs),
    List,
    Show(ProjectRefArg),
    Status(ProjectStatusArgs),
    Edit(ProjectEditArgs),
    Link(ProjectLinkArgs),
    Unlink(ProjectUnlinkArgs),
    Delete(ProjectDeleteArgs),
}

#[derive(Debug, Args)]
struct ProjectAddArgs {
    name: String,
    #[arg(long, default_value = "")]
    description: String,
    #[arg(long, default_value_t = default_project_color())]
    color: String,
    #[arg(long = "path")]
    workdir_path: Option<String>,
}

#[derive(Debug, Args)]
struct ProjectRefArg {
    project: String,
}

#[derive(Debug, Args)]
struct ProjectImportArgs {
    path: Option<String>,
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
    #[arg(long = "path")]
    workdir_path: Option<String>,
    #[arg(long)]
    clear_path: bool,
}

#[derive(Debug, Args)]
struct ProjectStatusArgs {
    project: Option<String>,
}

#[derive(Debug, Args)]
struct ProjectLinkArgs {
    project: String,
    path: String,
}

#[derive(Debug, Args)]
struct ProjectUnlinkArgs {
    project: String,
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

#[derive(Debug, Args, Default)]
struct UpdateArgs {
    #[arg(long)]
    check: bool,
}

const GITHUB_RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/Kasuletrevor/forge/releases/latest";
const CLI_CHECKSUM_ASSET_NAME: &str = "SHA256SUMS.txt";
const MANAGED_INSTALL_RELATIVE_PATH: &str = "Programs\\Forge\\bin";
const WINDOWS_PLATFORM_LABEL: &str = "windows-x64";

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone)]
struct UpdateTarget {
    latest_version: Version,
    release_url: String,
    cli_archive: GitHubReleaseAsset,
    checksums: GitHubReleaseAsset,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = ForgeCli::parse();
    if command_requires_api(&cli.command) {
        let api = ForgeApi::connect().await?;
        run(cli, &api).await
    } else {
        run_local_command(cli.command).await
    }
}

async fn run(cli: ForgeCli, api: &ForgeApi) -> Result<()> {
    run_api_command(cli.command, api).await
}

fn command_requires_api(command: &Commands) -> bool {
    !matches!(command, Commands::Update(_) | Commands::Doctor)
}

async fn run_local_command(command: Commands) -> Result<()> {
    match command {
        Commands::Update(args) => run_update(args).await,
        Commands::Doctor => run_doctor().await,
        _ => bail!("command requires daemon-backed API access"),
    }
}

async fn run_api_command(command: Commands, api: &ForgeApi) -> Result<()> {
    match command {
        Commands::Today => print_today(&api.get_today().await?),
        Commands::Update(_) | Commands::Doctor => {
            bail!("local command was routed through the daemon-backed command path")
        }
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
                    workdir_path: args
                        .workdir_path
                        .as_deref()
                        .map(resolve_cli_workdir_path)
                        .transpose()?,
                })
                .await?;
            println!("[{}] {} ({})", project.id, project.name, project.slug);
            if let Some(workdir_path) = &project.workdir_path {
                println!("workdir: {workdir_path}");
            }
        }
        Commands::Project {
            command: ProjectCommand::Import(args),
        } => {
            let root_path = match args.path.as_deref() {
                Some(path) => resolve_cli_workdir_path(path)?,
                None => env::current_dir()
                    .context("failed to resolve current working directory")?
                    .to_string_lossy()
                    .into_owned(),
            };
            let imported = api
                .import_projects(ImportProjectsRequest { root_path })
                .await?;
            print_project_import_result(&imported);
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
            if let Some(workdir_path) = &project.workdir_path {
                println!("workdir: {workdir_path}");
            }
        }
        Commands::Project {
            command: ProjectCommand::Status(args),
        } => {
            let project = match args.project.as_deref() {
                Some(reference) => api.resolve_project(reference).await?,
                None => api
                    .resolve_project_from_cwd()
                    .await?
                    .ok_or_else(|| anyhow!("no linked project matches the current working directory"))?,
            };
            let status = api.get_project_status(project.id).await?;
            print_project_status(&project, &status);
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
                workdir_path: if args.clear_path {
                    Some(None)
                } else {
                    args.workdir_path
                        .as_deref()
                        .map(resolve_cli_workdir_path)
                        .transpose()?
                        .map(Some)
                },
            };
            ensure_project_patch(&payload)?;
            let updated = api.update_project(project.id, payload).await?;
            println!("[{}] {} ({})", updated.id, updated.name, updated.slug);
            if let Some(workdir_path) = &updated.workdir_path {
                println!("workdir: {workdir_path}");
            }
        }
        Commands::Project {
            command: ProjectCommand::Link(args),
        } => {
            let project = api.resolve_project(&args.project).await?;
            let updated = api
                .update_project(
                    project.id,
                    UpdateProjectRequest {
                        workdir_path: Some(Some(resolve_cli_workdir_path(&args.path)?)),
                        ..Default::default()
                    },
                )
                .await?;
            println!("[{}] {} ({})", updated.id, updated.name, updated.slug);
            if let Some(workdir_path) = &updated.workdir_path {
                println!("workdir: {workdir_path}");
            }
        }
        Commands::Project {
            command: ProjectCommand::Unlink(args),
        } => {
            let project = api.resolve_project(&args.project).await?;
            let updated = api
                .update_project(
                    project.id,
                    UpdateProjectRequest {
                        workdir_path: Some(None),
                        ..Default::default()
                    },
                )
                .await?;
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
                None => api.resolve_project_from_cwd().await?.map(|project| project.id),
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
                None => api.resolve_project_from_cwd().await?.map(|project| project.id),
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

async fn run_doctor() -> Result<()> {
    let current_exe = env::current_exe().context("failed to locate current forge executable")?;
    let local_paths = ForgePaths::discover()?;
    let user_path = configured_user_path().ok();
    let health = probe_local_health().await?;
    let display_paths = health
        .as_ref()
        .map(|response| response.paths.clone())
        .unwrap_or_else(|| local_paths.clone());

    println!("Forge Environment Check\n");
    print_doctor_line("OK", "CLI version", env!("CARGO_PKG_VERSION"));
    print_doctor_line("OK", "CLI binary", current_exe.display());

    match managed_cli_install_root() {
        Ok(install_root) => {
            if is_managed_install_binary(&current_exe, &install_root) {
                print_doctor_line("OK", "CLI installed", install_root.display());
            } else {
                print_doctor_line(
                    "WARN",
                    "CLI installed",
                    format!(
                        "current binary is not running from managed install root {}",
                        install_root.display()
                    ),
                );
            }

            match user_path.as_deref() {
                Some(path_value) if path_contains_segment(path_value, &install_root) => {
                    print_doctor_line("OK", "PATH configured", install_root.display());
                }
                Some(_) => {
                    print_doctor_line(
                        "WARN",
                        "PATH configured",
                        format!("managed install root missing from user PATH ({})", install_root.display()),
                    );
                }
                None => {
                    print_doctor_line("WARN", "PATH configured", "unable to inspect user PATH");
                }
            }
        }
        Err(error) => {
            print_doctor_line("WARN", "CLI installed", error.to_string());
            print_doctor_line("WARN", "PATH configured", "managed CLI path check unavailable");
        }
    }

    let health_url = local_paths.health_url(DEFAULT_API_HOST, DEFAULT_API_PORT);
    match &health {
        Some(response) => print_doctor_line(
            "OK",
            "daemon reachable",
            format!("{} (started {})", response.api_base_url, response.started_at),
        ),
        None => print_doctor_line("WARN", "daemon reachable", format!("no response at {health_url}")),
    }

    print_path_check("Config file", &display_paths.config, false);
    print_path_check("Database file", &display_paths.database, false);
    print_path_check("Logs directory", &display_paths.logs, true);
    print_path_check("Daemon log", &display_paths.daemon_log, false);

    println!();
    println!("Daemon port: {}", DEFAULT_API_PORT);
    println!("API: {}", health.as_ref().map(|value| value.api_base_url.as_str()).unwrap_or(&local_paths.api_base_url(DEFAULT_API_HOST, DEFAULT_API_PORT)));
    println!("Database: {}", display_paths.database.display());
    println!("Config: {}", display_paths.config.display());
    println!("Logs: {}", display_paths.logs.display());
    println!("Daemon log: {}", display_paths.daemon_log.display());

    Ok(())
}

async fn run_update(args: UpdateArgs) -> Result<()> {
    if !cfg!(windows) {
        bail!("forge update is currently supported on Windows only");
    }

    let managed_root = managed_cli_install_root()?;
    let current_exe = env::current_exe().context("failed to locate current forge executable")?;
    if !is_managed_install_binary(&current_exe, &managed_root) {
        bail!(
            "forge update only supports the managed CLI install at {}. Reinstall Forge with the Windows installer or install-cli.ps1 first.",
            managed_root.display()
        );
    }

    let current_version = Version::parse(env!("CARGO_PKG_VERSION"))
        .context("invalid Forge CLI version metadata")?;
    let client = github_client(Duration::from_secs(20))?;

    println!("Checking for updates...\n");
    let target = fetch_latest_update_target(&client).await?;
    println!("Current version: {}", current_version);
    println!("Latest version:  {}", target.latest_version);

    if target.latest_version <= current_version {
        println!("\nForge is up to date.");
        return Ok(());
    }

    if args.check {
        println!("\nUpdate available: {}", target.release_url);
        return Ok(());
    }

    let workspace = update_workspace_root();
    fs::create_dir_all(&workspace)
        .with_context(|| format!("failed to create update workspace at {}", workspace.display()))?;
    let archive_path = workspace.join(&target.cli_archive.name);
    let checksums_path = workspace.join(CLI_CHECKSUM_ASSET_NAME);

    println!("\nDownloading update...");
    download_asset(&client, &target.cli_archive.browser_download_url, &archive_path).await?;
    download_asset(&client, &target.checksums.browser_download_url, &checksums_path).await?;

    println!("Verifying download...");
    verify_cli_archive(&archive_path, &checksums_path, &target.cli_archive.name)?;

    let daemon_was_running = probe_local_health().await?.is_some();

    println!("Installing...");
    launch_windows_updater(&archive_path, &workspace, &managed_root, daemon_was_running)?;
    Ok(())
}

fn print_doctor_line(label: &str, field: &str, detail: impl std::fmt::Display) {
    println!("{label:<4} {field}: {detail}");
}

fn print_path_check(field: &str, path: &Path, expect_directory: bool) {
    if path.exists() {
        let kind_matches = if expect_directory { path.is_dir() } else { path.is_file() || path.is_dir() };
        if kind_matches {
            print_doctor_line("OK", field, path.display());
        } else {
            print_doctor_line("WARN", field, format!("unexpected path type at {}", path.display()));
        }
        return;
    }

    let parent_exists = path.parent().map(Path::exists).unwrap_or(false);
    if parent_exists {
        print_doctor_line("WARN", field, format!("missing at {}", path.display()));
    } else {
        print_doctor_line("WARN", field, format!("parent directory missing for {}", path.display()));
    }
}

async fn probe_local_health() -> Result<Option<HealthResponse>> {
    let paths = ForgePaths::discover()?;
    let client = Client::builder()
        .timeout(Duration::from_millis(800))
        .build()?;
    Ok(fetch_health(
        &client,
        &paths.health_url(DEFAULT_API_HOST, DEFAULT_API_PORT),
    )
    .await)
}

fn managed_cli_install_root() -> Result<PathBuf> {
    if !cfg!(windows) {
        bail!("managed CLI install root is currently supported on Windows only");
    }

    let local_app_data = env::var_os("LOCALAPPDATA")
        .context("LOCALAPPDATA is not set; cannot resolve managed CLI install root")?;
    Ok(PathBuf::from(local_app_data).join(MANAGED_INSTALL_RELATIVE_PATH))
}

fn normalize_path_for_compare(path: &Path) -> String {
    path.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

fn path_contains_segment(path_value: &str, segment: &Path) -> bool {
    let expected = normalize_path_for_compare(segment);
    env::split_paths(path_value)
        .any(|value| normalize_path_for_compare(&value) == expected)
}

fn is_managed_install_binary(current_exe: &Path, install_root: &Path) -> bool {
    current_exe
        .parent()
        .map(|parent| normalize_path_for_compare(parent) == normalize_path_for_compare(install_root))
        .unwrap_or(false)
}

fn configured_user_path() -> Result<String> {
    if cfg!(windows) {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[Environment]::GetEnvironmentVariable('Path','User')",
            ])
            .output()
            .context("failed to query user PATH via PowerShell")?;
        if !output.status.success() {
            bail!("failed to query user PATH via PowerShell");
        }
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    env::var("PATH").context("PATH is not set")
}

fn github_client(timeout: Duration) -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(&format!("forge/{}", env!("CARGO_PKG_VERSION")))
            .context("invalid Forge user agent")?,
    );

    Client::builder()
        .timeout(timeout)
        .default_headers(headers)
        .build()
        .map_err(Into::into)
}

async fn fetch_latest_update_target(client: &Client) -> Result<UpdateTarget> {
    let release = client
        .get(GITHUB_RELEASES_LATEST_URL)
        .send()
        .await?
        .error_for_status()?
        .json::<GitHubRelease>()
        .await
        .context("failed to decode latest GitHub release metadata")?;

    select_update_target(release)
}

fn select_update_target(release: GitHubRelease) -> Result<UpdateTarget> {
    let latest_version = Version::parse(release.tag_name.trim_start_matches('v'))
        .with_context(|| format!("unsupported release tag '{}'", release.tag_name))?;
    let cli_archive_name = windows_cli_archive_name(&latest_version);
    let cli_archive = release
        .assets
        .iter()
        .find(|asset| asset.name == cli_archive_name)
        .cloned()
        .with_context(|| format!("missing CLI archive asset '{}'", cli_archive_name))?;
    let checksums = release
        .assets
        .iter()
        .find(|asset| asset.name == CLI_CHECKSUM_ASSET_NAME)
        .cloned()
        .with_context(|| format!("missing checksum asset '{}'", CLI_CHECKSUM_ASSET_NAME))?;

    Ok(UpdateTarget {
        latest_version,
        release_url: release.html_url,
        cli_archive,
        checksums,
    })
}

fn windows_cli_archive_name(version: &Version) -> String {
    format!("forge-v{version}-{WINDOWS_PLATFORM_LABEL}-cli.zip")
}

async fn download_asset(client: &Client, url: &str, destination: &Path) -> Result<()> {
    let bytes = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    fs::write(destination, &bytes)
        .with_context(|| format!("failed to write downloaded asset to {}", destination.display()))
}

fn verify_cli_archive(archive_path: &Path, checksums_path: &Path, file_name: &str) -> Result<()> {
    let checksums = fs::read_to_string(checksums_path)
        .with_context(|| format!("failed to read {}", checksums_path.display()))?;
    let expected = checksum_for_file(&checksums, file_name)
        .with_context(|| format!("failed to locate checksum entry for {file_name}"))?;
    let archive = fs::read(archive_path)
        .with_context(|| format!("failed to read {}", archive_path.display()))?;
    let actual = sha256_hex(&archive);

    if actual != expected {
        bail!("checksum mismatch for {file_name}: expected {expected}, got {actual}");
    }

    Ok(())
}

fn checksum_for_file(contents: &str, file_name: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let trimmed = line.trim();
        let (hash, name) = trimmed.split_once("  ")?;
        if name.trim() == file_name {
            Some(hash.trim().to_ascii_lowercase())
        } else {
            None
        }
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|value| format!("{value:02x}"))
        .collect::<String>()
}

fn update_workspace_root() -> PathBuf {
    env::temp_dir().join(format!(
        "forge-update-{}-{}",
        std::process::id(),
        Utc::now().timestamp_millis()
    ))
}

fn launch_windows_updater(
    archive_path: &Path,
    workspace: &Path,
    install_root: &Path,
    restart_daemon: bool,
) -> Result<()> {
    let script_path = workspace.join("apply-update.ps1");
    fs::write(&script_path, generate_updater_script())
        .with_context(|| format!("failed to write updater script to {}", script_path.display()))?;

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script_path.to_string_lossy().as_ref(),
            "-CurrentPid",
            &std::process::id().to_string(),
            "-ZipPath",
            archive_path.to_string_lossy().as_ref(),
            "-WorkDir",
            workspace.to_string_lossy().as_ref(),
            "-InstallRoot",
            install_root.to_string_lossy().as_ref(),
            "-RestartDaemon",
            if restart_daemon { "$true" } else { "$false" },
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .context("failed to launch Forge updater")?;

    Ok(())
}

fn generate_updater_script() -> &'static str {
    r#"
param(
  [int]$CurrentPid,
  [string]$ZipPath,
  [string]$WorkDir,
  [string]$InstallRoot,
  [bool]$RestartDaemon
)

$ErrorActionPreference = 'Stop'
$extractDir = Join-Path $WorkDir 'payload'

while (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) {
  Start-Sleep -Milliseconds 200
}

Get-Process forged -ErrorAction SilentlyContinue | Stop-Process -Force

if (Test-Path $extractDir) {
  Remove-Item -Recurse -Force $extractDir
}

Expand-Archive -Path $ZipPath -DestinationPath $extractDir -Force
& (Join-Path $extractDir 'install-cli.ps1') -SourceDir $extractDir -Quiet

if ($RestartDaemon) {
  $daemonExe = Join-Path $InstallRoot 'forged.exe'
  if (Test-Path $daemonExe) {
    Start-Process -FilePath $daemonExe -WindowStyle Hidden | Out-Null
  }
}

Write-Host ''
Write-Host 'Forge updated successfully.'
if ($RestartDaemon) {
  Write-Host 'Forge daemon restarted.'
}
"#
}

#[derive(Clone)]
struct ForgeApi {
    client: Client,
    base_url: String,
}

impl ForgeApi {
    async fn connect() -> Result<Self> {
        let health = ensure_daemon_running().await?;
        let base_url = health.api_base_url.clone();
        let client = Client::builder().timeout(Duration::from_secs(5)).build()?;
        let api = Self { client, base_url };
        let _ = api.health().await?;
        Ok(api)
    }

    async fn health(&self) -> Result<HealthResponse> {
        self
            .client
            .get(format!("{}/health", self.base_url))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
            .map_err(Into::into)
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

    async fn resolve_project_from_cwd(&self) -> Result<Option<Project>> {
        let cwd = env::current_dir().context("failed to resolve current working directory")?;
        self.resolve_project_by_path(&cwd).await
    }

    async fn resolve_project_by_path(&self, cwd: &Path) -> Result<Option<Project>> {
        self.get_json_optional(&format!(
            "/projects/resolve-by-path?cwd={}",
            urlencoding::encode(&cwd.to_string_lossy())
        ))
        .await
    }

    async fn get_project_status(&self, id: i64) -> Result<ProjectRepoStatus> {
        self.get_json(&format!("/projects/{id}/status")).await
    }

    async fn create_project(&self, payload: CreateProjectRequest) -> Result<Project> {
        self.post_json("/projects", &payload).await
    }

    async fn import_projects(&self, payload: ImportProjectsRequest) -> Result<ImportProjectsResponse> {
        self.post_json("/projects/import", &payload).await
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

    async fn get_json_optional<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<Option<T>> {
        let response = self
            .client
            .get(format!("{}{}", self.base_url, path))
            .send()
            .await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(response.error_for_status()?.json().await?))
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

async fn ensure_daemon_running() -> Result<HealthResponse> {
    let client = Client::builder().timeout(Duration::from_millis(600)).build()?;
    let paths = ForgePaths::discover().map_err(|error| anyhow!(error.message))?;
    let health_url = paths.health_url(DEFAULT_API_HOST, DEFAULT_API_PORT);
    if let Some(health) = fetch_health(&client, &health_url).await {
        return Ok(health);
    }

    let mut child = spawn_forged_process(&paths).with_context(|| {
        format!(
            "failed to start Forge daemon; inspect {} and {}",
            paths.daemon_log.display(),
            paths.config.display()
        )
    })?;
    let mut exit_status = None;
    for _ in 0..32 {
        if let Some(health) = fetch_health(&client, &health_url).await {
            return Ok(health);
        }
        if exit_status.is_none() {
            exit_status = child.try_wait().context("failed to observe daemon process")?;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    if let Some(health) = fetch_health(&client, &health_url).await {
        return Ok(health);
    }

    bail!(format_startup_failure(&paths, &health_url, exit_status))
}

async fn fetch_health(client: &Client, health_url: &str) -> Option<HealthResponse> {
    client
        .get(health_url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<HealthResponse>()
        .await
        .ok()
}

fn spawn_forged_process(paths: &ForgePaths) -> Result<Child> {
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.daemon_log)
        .with_context(|| format!("failed to open {}", paths.daemon_log.display()))?;
    let stderr = stdout
        .try_clone()
        .with_context(|| format!("failed to clone {}", paths.daemon_log.display()))?;
    let sibling = sibling_forged_binary();
    if sibling.exists() {
        return Command::new(sibling)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .stdin(Stdio::null())
            .spawn()
            .context("failed to start sibling forged binary");
    }

    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .context("failed to locate workspace root")?
        .to_path_buf();
    Command::new("cargo")
        .args(["run", "-p", "forged"])
        .current_dir(workspace_root)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .stdin(Stdio::null())
        .spawn()
        .context("failed to start forged via cargo run")
}

fn sibling_forged_binary() -> PathBuf {
    let exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("forge"));
    let binary = if cfg!(windows) { "forged.exe" } else { "forged" };
    exe.with_file_name(binary)
}

fn format_startup_failure(paths: &ForgePaths, health_url: &str, exit_status: Option<ExitStatus>) -> String {
    let exit_detail = exit_status
        .map(|status| format!("daemon process exited early with status {status}; "))
        .unwrap_or_default();
    format!(
        "Forge daemon did not become ready at {health_url}; {exit_detail}inspect logs at {}, config at {}, and database at {}",
        paths.daemon_log.display(),
        paths.config.display(),
        paths.database.display()
    )
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
        && payload.workdir_path.is_none()
    {
        bail!("no project fields supplied")
    }
    Ok(())
}

fn resolve_cli_workdir_path(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        bail!("project path must not be empty");
    }

    let expanded = expand_cli_home_path(trimmed);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        env::current_dir()
            .context("failed to resolve current working directory")?
            .join(expanded)
    };

    let canonical = absolute
        .canonicalize()
        .with_context(|| format!("failed to resolve project path {}", absolute.display()))?;

    if !canonical.is_dir() {
        bail!("project path is not a directory: {}", canonical.display());
    }

    Ok(display_cli_path(&canonical))
}

fn expand_cli_home_path(raw: &str) -> PathBuf {
    if raw == "~" {
        return cli_home_dir().unwrap_or_else(|| PathBuf::from(raw));
    }
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        if let Some(home) = cli_home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(raw)
}

fn cli_home_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|| {
                let drive = env::var_os("HOMEDRIVE")?;
                let path = env::var_os("HOMEPATH")?;
                let mut home = PathBuf::from(drive);
                home.push(path);
                Some(home)
            })
    } else {
        env::var_os("HOME").map(PathBuf::from)
    }
}

fn display_cli_path(path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
    } else {
        value
    }
}

fn print_project_status(project: &Project, status: &ProjectRepoStatus) {
    println!("Project: {}", project.name);
    println!();
    println!(
        "Path: {}",
        status.workdir_path.as_deref().unwrap_or("(not linked)")
    );
    println!("Git repo: {}", if status.is_git_repo { "yes" } else { "no" });
    if let Some(repo_root) = &status.repo_root {
        println!("Repo root: {repo_root}");
    }
    if let Some(branch) = &status.branch {
        println!("Branch: {branch}");
    }
    if let Some(remote_url) = &status.remote_url {
        println!("Remote: {remote_url}");
    }
    if let Some(default_branch) = &status.default_branch {
        println!("Default branch: {default_branch}");
    }
    println!(
        "Dirty: {}",
        if status.dirty {
            format!("yes ({})", status.dirty_file_count)
        } else {
            "no".to_string()
        }
    );
    if let Some(commit) = &status.last_commit_sha {
        println!("Last commit: {commit}");
    }
    if let Some(summary) = &status.last_commit_summary {
        println!("Last summary: {summary}");
    }
    if let Some(at) = &status.last_commit_at {
        println!("Last commit at: {at}");
    }
    if let Some(error) = &status.status_error {
        println!("Status error: {error}");
    }
}

fn print_project_import_result(result: &ImportProjectsResponse) {
    println!("Workspace import");
    println!("root: {}", result.root_path);
    println!("discovered repos: {}", result.discovered_repos);
    println!(
        "created: {}  linked: {}  skipped: {}",
        result.created.len(),
        result.linked.len(),
        result.skipped.len()
    );

    if !result.created.is_empty() {
        println!("\nCreated");
        for project in &result.created {
            println!(
                "[{}] {} ({}){}",
                project.id,
                project.name,
                project.slug,
                project
                    .workdir_path
                    .as_deref()
                    .map(|path| format!("  {path}"))
                    .unwrap_or_default()
            );
        }
    }

    if !result.linked.is_empty() {
        println!("\nLinked Existing");
        for project in &result.linked {
            println!(
                "[{}] {} ({}){}",
                project.id,
                project.name,
                project.slug,
                project
                    .workdir_path
                    .as_deref()
                    .map(|path| format!("  {path}"))
                    .unwrap_or_default()
            );
        }
    }

    if !result.skipped.is_empty() {
        println!("\nSkipped");
        for skipped in &result.skipped {
            println!("{}  {}  {}", skipped.name, skipped.path, skipped.reason);
        }
    }
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
            workdir_path: None,
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
            workdir_path: None,
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
            workdir_path: None,
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
            workdir_path: None,
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
            workdir_path: None,
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
            workdir_path: None,
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

    #[tokio::test]
    async fn project_link_and_unlink_commands_manage_workdir_path() {
        let harness = harness().await;
        let temp = tempdir().expect("tempdir");
        let workdir = temp.path().join("linked-repo");
        std::fs::create_dir_all(&workdir).expect("workdir");
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Linked".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#617055".to_string(),
                workdir_path: None,
            })
            .await
            .expect("project");
        let project_id = project.id.to_string();

        run(
            ForgeCli::parse_from([
                "forge",
                "project",
                "link",
                project_id.as_str(),
                workdir.to_string_lossy().as_ref(),
            ]),
            &harness.api,
        )
        .await
        .expect("run project link");

        let linked = harness
            .service
            .get_project(project.id)
            .await
            .expect("project after link");
        assert!(linked.workdir_path.is_some());

        run(
            ForgeCli::parse_from(["forge", "project", "unlink", project_id.as_str()]),
            &harness.api,
        )
        .await
        .expect("run project unlink");

        let unlinked = harness
            .service
            .get_project(project.id)
            .await
            .expect("project after unlink");
        assert_eq!(unlinked.workdir_path, None);
    }

    #[tokio::test]
    async fn project_status_command_runs_against_linked_directory_state() {
        let harness = harness().await;
        let temp = tempdir().expect("tempdir");
        let workdir = temp.path().join("workspace");
        std::fs::create_dir_all(&workdir).expect("workspace");
        let project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Workspace".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#556870".to_string(),
                workdir_path: Some(workdir.to_string_lossy().into_owned()),
            })
            .await
            .expect("project");
        let project_id = project.id.to_string();

        run(
            ForgeCli::parse_from(["forge", "project", "status", project_id.as_str()]),
            &harness.api,
        )
        .await
        .expect("run project status");
    }

    #[tokio::test]
    async fn project_import_command_creates_and_links_repo_projects() {
        let harness = harness().await;
        let temp = tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        let existing_repo = workspace.join("existing");
        let fresh_repo = workspace.join("fresh");
        std::fs::create_dir_all(existing_repo.join(".git")).expect("existing git marker");
        std::fs::create_dir_all(fresh_repo.join(".git")).expect("fresh git marker");

        let existing_project = harness
            .service
            .create_project(CreateProjectRequest {
                name: "Existing".to_string(),
                description: String::new(),
                status: ProjectStatus::Active,
                tags: vec![],
                color: "#617055".to_string(),
                workdir_path: None,
            })
            .await
            .expect("existing project");

        run(
            ForgeCli::parse_from([
                "forge",
                "project",
                "import",
                workspace.to_string_lossy().as_ref(),
            ]),
            &harness.api,
        )
        .await
        .expect("run project import");

        let linked_existing = harness
            .service
            .get_project(existing_project.id)
            .await
            .expect("linked existing project");
        assert!(linked_existing.workdir_path.is_some());

        let projects = harness
            .service
            .list_projects(true)
            .await
            .expect("projects after import");
        assert_eq!(projects.len(), 2);
        assert!(projects.iter().any(|summary| summary.project.name == "fresh"));
    }

    #[test]
    fn startup_failure_message_includes_debug_paths() {
        let paths = ForgePaths::from_root(PathBuf::from("C:\\forge-test"));
        let message = format_startup_failure(&paths, "http://127.0.0.1:37241/health", None);

        assert!(message.contains("http://127.0.0.1:37241/health"));
        assert!(message.contains("forged.log"));
        assert!(message.contains("config.toml"));
        assert!(message.contains("forge.db"));
    }

    #[test]
    fn command_requires_api_skips_local_maintenance_commands() {
        assert!(!command_requires_api(&Commands::Update(UpdateArgs { check: false })));
        assert!(!command_requires_api(&Commands::Doctor));
        assert!(command_requires_api(&Commands::Today));
    }

    #[test]
    fn select_update_target_picks_stable_cli_assets() {
        let target = select_update_target(GitHubRelease {
            tag_name: "v0.1.2".to_string(),
            html_url: "https://github.com/Kasuletrevor/forge/releases/tag/v0.1.2".to_string(),
            assets: vec![
                GitHubReleaseAsset {
                    name: "forge-v0.1.2-windows-x64-cli.zip".to_string(),
                    browser_download_url: "https://example.com/forge-v0.1.2-windows-x64-cli.zip"
                        .to_string(),
                },
                GitHubReleaseAsset {
                    name: CLI_CHECKSUM_ASSET_NAME.to_string(),
                    browser_download_url: "https://example.com/SHA256SUMS.txt".to_string(),
                },
            ],
        })
        .expect("update target");

        assert_eq!(target.latest_version, Version::parse("0.1.2").unwrap());
        assert_eq!(target.cli_archive.name, "forge-v0.1.2-windows-x64-cli.zip");
        assert_eq!(target.checksums.name, CLI_CHECKSUM_ASSET_NAME);
    }

    #[test]
    fn checksum_lookup_and_path_segment_matching_work() {
        let checksums = "abc123  forge-v0.1.2-windows-x64-cli.zip\nfff999  other.zip\n";
        assert_eq!(
            checksum_for_file(checksums, "forge-v0.1.2-windows-x64-cli.zip").as_deref(),
            Some("abc123")
        );

        let managed_root = PathBuf::from_iter(["forge-test", "bin"]);
        let path_value = env::join_paths([PathBuf::from_iter(["system"]), managed_root.clone()])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(path_contains_segment(
            &path_value,
            &managed_root
        ));
        assert!(is_managed_install_binary(
            &managed_root.join("forge.exe"),
            &managed_root
        ));
    }
}
