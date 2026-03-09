use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    stage_sidecar_stub().expect("failed to prepare Forge desktop sidecar");
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
    let repo_root = manifest_dir.parent()?.parent()?.parent()?;
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
