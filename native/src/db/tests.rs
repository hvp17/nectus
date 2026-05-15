use super::*;
use tempfile::tempdir;

#[test]
fn seeds_default_agent_profiles() {
    let db = Database::open_in_memory().unwrap();
    let profiles = db.list_agent_profiles().unwrap();

    assert_eq!(profiles.len(), 3);
    assert_eq!(profiles[0].command, "codex");
    assert_eq!(profiles[1].command, "claude");
    assert_eq!(profiles[2].command, "gemini");
    assert_eq!(profiles[0].agent_kind, AgentKind::Codex);
    assert_eq!(profiles[1].agent_kind, AgentKind::Claude);
    assert_eq!(profiles[2].agent_kind, AgentKind::Gemini);
}

#[test]
fn seeds_and_updates_global_app_settings() {
    let db = Database::open_in_memory().unwrap();
    let profiles = db.list_agent_profiles().unwrap();

    let settings = db.get_app_settings().unwrap();
    assert_eq!(
        settings.default_agent_profile_id,
        profiles.first().map(|profile| profile.id)
    );
    assert_eq!(
        settings.default_worktree_root_pattern,
        "../{repoName}-worktrees"
    );
    assert_eq!(settings.default_branch_prefix, None);
    assert_eq!(settings.theme, ThemeMode::System);
    assert_eq!(settings.density, DensityMode::Comfortable);

    let updated = db
        .update_app_settings(AppSettingsInput {
            default_agent_profile_id: Some(profiles[1].id),
            default_worktree_root_pattern: "../worktrees/{repoName}".to_string(),
            default_branch_prefix: Some("feat/".to_string()),
            theme: ThemeMode::Dark,
            density: DensityMode::Compact,
        })
        .unwrap();

    assert_eq!(updated.default_agent_profile_id, Some(profiles[1].id));
    assert_eq!(
        updated.default_worktree_root_pattern,
        "../worktrees/{repoName}"
    );
    assert_eq!(updated.default_branch_prefix.as_deref(), Some("feat/"));
    assert_eq!(updated.theme, ThemeMode::Dark);
    assert_eq!(updated.density, DensityMode::Compact);
}

#[test]
fn updated_worktree_root_pattern_applies_to_existing_and_new_repos() {
    let db = Database::open_in_memory().unwrap();
    let first_repo_dir = tempdir().unwrap();
    let second_repo_dir = tempdir().unwrap();
    for repo_dir in [&first_repo_dir, &second_repo_dir] {
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
    }
    let first = db
        .add_repo(first_repo_dir.path().to_string_lossy().to_string())
        .unwrap();
    let first_repo_name = first_repo_dir.path().file_name().unwrap().to_str().unwrap();

    db.update_app_settings(AppSettingsInput {
        default_agent_profile_id: None,
        default_worktree_root_pattern: "../global-worktrees/{repoName}".to_string(),
        default_branch_prefix: None,
        theme: ThemeMode::System,
        density: DensityMode::Comfortable,
    })
    .unwrap();

    let refreshed_first = db.repo_by_id(first.id).unwrap().unwrap();
    assert!(refreshed_first
        .default_worktree_root
        .ends_with(&format!("global-worktrees/{first_repo_name}")));

    let second = db
        .add_repo(second_repo_dir.path().to_string_lossy().to_string())
        .unwrap();
    let second_repo_name = second_repo_dir
        .path()
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    assert!(second
        .default_worktree_root
        .ends_with(&format!("global-worktrees/{second_repo_name}")));
}

#[test]
fn upserts_agent_profile_with_args_and_env() {
    let db = Database::open_in_memory().unwrap();
    let mut env = BTreeMap::new();
    env.insert("MODEL".to_string(), "fast".to_string());

    let profile = db
        .upsert_agent_profile(AgentProfileInput {
            id: None,
            name: "Custom".to_string(),
            agent_kind: AgentKind::Custom,
            command: "custom-agent".to_string(),
            model: Some("custom-fast".to_string()),
            args: vec!["--resume".to_string()],
            env,
        })
        .unwrap();

    assert_eq!(profile.name, "Custom");
    assert_eq!(profile.agent_kind, AgentKind::Custom);
    assert_eq!(profile.model.as_deref(), Some("custom-fast"));
    assert_eq!(profile.args, vec!["--resume"]);
    assert_eq!(profile.env.get("MODEL").unwrap(), "fast");
}

#[test]
fn creates_task_without_worktree() {
    let db = Database::open_in_memory().unwrap();
    let repo_dir = tempdir().unwrap();
    std::process::Command::new("git")
        .arg("init")
        .arg(repo_dir.path())
        .output()
        .unwrap();
    let repo = db
        .add_repo(repo_dir.path().to_string_lossy().to_string())
        .unwrap();

    let task = db
        .create_task_record(
            repo.id,
            "Review dependency updates".to_string(),
            Some("Review dependency updates and summarize risk".to_string()),
            None,
            false,
            None,
        )
        .unwrap();

    assert_eq!(task.repo_id, repo.id);
    assert_eq!(task.title, "Review dependency updates");
    assert_eq!(
        task.prompt.as_deref(),
        Some("Review dependency updates and summarize risk")
    );
    assert!(!task.has_worktree);
    assert_eq!(task.branch_name, None);
    assert_eq!(task.worktree_path, None);
}

#[test]
fn adding_existing_repo_returns_existing_repo() {
    let db = Database::open_in_memory().unwrap();
    let first_repo_dir = tempdir().unwrap();
    let second_repo_dir = tempdir().unwrap();
    for repo_dir in [&first_repo_dir, &second_repo_dir] {
        std::process::Command::new("git")
            .arg("init")
            .arg(repo_dir.path())
            .output()
            .unwrap();
    }

    let first = db
        .add_repo(first_repo_dir.path().to_string_lossy().to_string())
        .unwrap();
    let _second = db
        .add_repo(second_repo_dir.path().to_string_lossy().to_string())
        .unwrap();

    let duplicate = db
        .add_repo(first_repo_dir.path().to_string_lossy().to_string())
        .unwrap();

    assert_eq!(duplicate.id, first.id);
    assert_eq!(duplicate.path, first.path);
}

#[test]
fn upserting_existing_agent_profile_returns_existing_profile() {
    let db = Database::open_in_memory().unwrap();
    let custom = db
        .upsert_agent_profile(AgentProfileInput {
            id: None,
            name: "Custom".to_string(),
            agent_kind: AgentKind::Custom,
            command: "custom-agent".to_string(),
            model: None,
            args: vec![],
            env: BTreeMap::new(),
        })
        .unwrap();

    let codex = db
        .upsert_agent_profile(AgentProfileInput {
            id: None,
            name: "Codex".to_string(),
            agent_kind: AgentKind::Codex,
            command: "codex-next".to_string(),
            model: Some("gpt-5.3-codex".to_string()),
            args: vec!["--fast".to_string()],
            env: BTreeMap::new(),
        })
        .unwrap();

    assert_ne!(codex.id, custom.id);
    assert_eq!(codex.name, "Codex");
    assert_eq!(codex.agent_kind, AgentKind::Codex);
    assert_eq!(codex.command, "codex-next");
    assert_eq!(codex.model.as_deref(), Some("gpt-5.3-codex"));
}

#[test]
fn list_tasks_rejects_unknown_status() {
    let db = Database::open_in_memory().unwrap();
    let repo_dir = tempdir().unwrap();
    std::process::Command::new("git")
        .arg("init")
        .arg(repo_dir.path())
        .output()
        .unwrap();
    let repo = db
        .add_repo(repo_dir.path().to_string_lossy().to_string())
        .unwrap();

    db.conn
        .execute(
            "
                INSERT INTO tasks
                  (repo_id, title, status, has_worktree, created_at, updated_at)
                VALUES (?1, 'Bad status', 'archived', 0, 'now', 'now')
                ",
            params![repo.id],
        )
        .unwrap();

    let error = db.list_tasks(None).unwrap_err();

    assert!(error.contains("Unknown task status"), "{error}");
}

#[test]
fn starting_and_stopping_session_preserves_last_session_snapshot() {
    let db = Database::open_in_memory().unwrap();
    let repo_dir = tempdir().unwrap();
    std::process::Command::new("git")
        .arg("init")
        .arg(repo_dir.path())
        .output()
        .unwrap();
    let repo = db
        .add_repo(repo_dir.path().to_string_lossy().to_string())
        .unwrap();
    let task = db
        .create_task_record(
            repo.id,
            "Continue agent work".to_string(),
            None,
            None,
            false,
            None,
        )
        .unwrap();

    db.start_session_record(task.id, "session-123", "codex", "/tmp/worktree", None)
        .unwrap();
    let running = db.task_by_id(task.id).unwrap().unwrap();
    assert_eq!(running.active_session_id.as_deref(), Some("session-123"));
    assert_eq!(running.last_session_id.as_deref(), Some("session-123"));
    assert_eq!(running.last_session_agent.as_deref(), Some("codex"));
    assert_eq!(running.last_session_cwd.as_deref(), Some("/tmp/worktree"));
    assert_eq!(running.last_session_label, None);

    db.set_active_session(task.id, None).unwrap();
    let stopped = db.task_by_id(task.id).unwrap().unwrap();
    assert_eq!(stopped.active_session_id, None);
    assert_eq!(stopped.last_session_id.as_deref(), Some("session-123"));
    assert_eq!(stopped.last_session_agent.as_deref(), Some("codex"));
    assert_eq!(stopped.last_session_cwd.as_deref(), Some("/tmp/worktree"));

    db.set_last_session(task.id, "session-456", Some("Implement resume"))
        .unwrap();
    let refreshed = db.task_by_id(task.id).unwrap().unwrap();
    assert_eq!(refreshed.last_session_id.as_deref(), Some("session-456"));
    assert_eq!(
        refreshed.last_session_label.as_deref(),
        Some("Implement resume")
    );
}

#[test]
fn deletes_task_without_active_session() {
    let db = Database::open_in_memory().unwrap();
    let repo_dir = tempdir().unwrap();
    std::process::Command::new("git")
        .arg("init")
        .arg(repo_dir.path())
        .output()
        .unwrap();
    let repo = db
        .add_repo(repo_dir.path().to_string_lossy().to_string())
        .unwrap();
    let task = db
        .create_task_record(
            repo.id,
            "Remove stale task".to_string(),
            None,
            None,
            false,
            None,
        )
        .unwrap();

    db.delete_task(task.id).unwrap();

    assert!(db.task_by_id(task.id).unwrap().is_none());
}

#[test]
fn delete_task_rejects_active_session() {
    let db = Database::open_in_memory().unwrap();
    let repo_dir = tempdir().unwrap();
    std::process::Command::new("git")
        .arg("init")
        .arg(repo_dir.path())
        .output()
        .unwrap();
    let repo = db
        .add_repo(repo_dir.path().to_string_lossy().to_string())
        .unwrap();
    let task = db
        .create_task_record(repo.id, "Running task".to_string(), None, None, false, None)
        .unwrap();
    db.start_session_record(
        task.id,
        "session-123",
        "codex",
        repo_dir.path().to_str().unwrap(),
        None,
    )
    .unwrap();

    let error = db.delete_task(task.id).unwrap_err();

    assert!(error.contains("Stop the running session"), "{error}");
    assert!(db.task_by_id(task.id).unwrap().is_some());
}
