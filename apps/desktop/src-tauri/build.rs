use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    stage_sidecar_stub().expect("failed to prepare Forge desktop sidecar");
    stage_cli_resources().expect("failed to prepare Forge CLI resources");
    tauri_build::build()
}

fn stage_sidecar_stub() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|error| error.to_string())?);
    let target = env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| env::var("TARGET"))
        .map_err(|error| error.to_string())?;
    let profile = env::var("PROFILE").map_err(|error| error.to_string())?;
    let sidecar_path = manifest_dir.join("binaries").join(sidecar_name(&target));

    if sidecar_path.exists() {
        return Ok(());
    }

    if let Some(source) = discover_built_sidecar(&manifest_dir, &target, &profile) {
        fs::create_dir_all(
            sidecar_path
                .parent()
                .ok_or_else(|| "failed to determine sidecar directory".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::copy(&source, &sidecar_path).map_err(|error| {
            format!(
                "failed to copy Forge daemon sidecar from {} to {}: {error}",
                source.display(),
                sidecar_path.display()
            )
        })?;
        return Ok(());
    }

    if profile == "release" {
        return Err(format!(
            "expected staged Forge daemon sidecar at {}. Run `npm run build --prefix apps/desktop` or `node apps/desktop/scripts/stage-sidecar.mjs` first.",
            sidecar_path.display()
        ));
    }

    fs::create_dir_all(
        sidecar_path
            .parent()
            .ok_or_else(|| "failed to determine sidecar directory".to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::write(&sidecar_path, b"placeholder sidecar for cargo check")
        .map_err(|error| error.to_string())
}

fn discover_built_sidecar(manifest_dir: &Path, target: &str, profile: &str) -> Option<PathBuf> {
    let repo_root = repo_root(manifest_dir)?;
    let candidates = [
        repo_root.join("target").join(target).join(profile).join(binary_name()),
        repo_root
            .join("target")
            .join(target)
            .join("release")
            .join(binary_name()),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn stage_cli_resources() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|error| error.to_string())?);
    let target = env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| env::var("TARGET"))
        .map_err(|error| error.to_string())?;
    let profile = env::var("PROFILE").map_err(|error| error.to_string())?;
    let cli_dir = manifest_dir.join("forge-cli");
    let repo_root = repo_root(&manifest_dir).ok_or_else(|| "failed to locate workspace root".to_string())?;
    let template_dir = repo_root.join("apps").join("desktop").join("cli-resources");

    fs::create_dir_all(&cli_dir).map_err(|error| error.to_string())?;
    copy_cli_templates(&template_dir, &cli_dir)?;

    let cli_path = cli_dir.join(cli_binary_name());
    let daemon_path = cli_dir.join(binary_name());
    if cli_path.exists() && daemon_path.exists() {
        return Ok(());
    }

    if let Some(source) = discover_built_binary(&manifest_dir, &target, &profile, cli_binary_name()) {
        fs::copy(&source, &cli_path).map_err(|error| {
            format!(
                "failed to copy Forge CLI binary from {} to {}: {error}",
                source.display(),
                cli_path.display()
            )
        })?;
    }

    if let Some(source) = discover_built_binary(&manifest_dir, &target, &profile, binary_name()) {
        fs::copy(&source, &daemon_path).map_err(|error| {
            format!(
                "failed to copy Forge daemon companion from {} to {}: {error}",
                source.display(),
                daemon_path.display()
            )
        })?;
    }

    if cli_path.exists() && daemon_path.exists() {
        return Ok(());
    }

    if profile == "release" {
        return Err(format!(
            "expected staged Forge CLI resources at {}. Run `npm run build --prefix apps/desktop` or `node apps/desktop/scripts/stage-sidecar.mjs` first.",
            cli_dir.display()
        ));
    }

    write_placeholder(&cli_path, b"placeholder forge cli for cargo check")?;
    write_placeholder(&daemon_path, b"placeholder forge daemon for cargo check")
}

fn copy_cli_templates(template_dir: &Path, destination_dir: &Path) -> Result<(), String> {
    for template in ["install-cli.ps1", "uninstall-cli.ps1", "README.txt"] {
        let source = template_dir.join(template);
        let destination = destination_dir.join(template);
        fs::copy(&source, &destination).map_err(|error| {
            format!(
                "failed to copy Forge CLI template from {} to {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
    }

    Ok(())
}

fn discover_built_binary(
    manifest_dir: &Path,
    target: &str,
    profile: &str,
    binary_name: &str,
) -> Option<PathBuf> {
    let repo_root = repo_root(manifest_dir)?;
    let candidates = [
        repo_root.join("target").join(target).join(profile).join(binary_name),
        repo_root.join("target").join(target).join("release").join(binary_name),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn repo_root(manifest_dir: &Path) -> Option<&Path> {
    manifest_dir.parent()?.parent()?.parent()
}

fn write_placeholder(path: &Path, contents: &[u8]) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn sidecar_name(target: &str) -> String {
    if cfg!(windows) {
        format!("forged-{target}.exe")
    } else {
        format!("forged-{target}")
    }
}

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "forged.exe"
    } else {
        "forged"
    }
}

fn cli_binary_name() -> &'static str {
    if cfg!(windows) {
        "forge.exe"
    } else {
        "forge"
    }
}
