use super::*;
use std::path::Path;
use tempfile::tempdir;

fn run_git(repo_path: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn add_repo_with_remote(db: &Database) -> (tempfile::TempDir, Repo) {
    let dir = tempdir().unwrap();
    let remote_dir = dir.path().join("remote.git");
    let seed_dir = dir.path().join("seed");
    let local_dir = dir.path().join("local");

    std::process::Command::new("git")
        .args(["init", "--bare", "--initial-branch=main"])
        .arg(&remote_dir)
        .output()
        .unwrap();
    std::process::Command::new("git")
        .args(["init", "--initial-branch=main"])
        .arg(&seed_dir)
        .output()
        .unwrap();
    run_git(&seed_dir, &["config", "user.email", "test@example.com"]);
    run_git(&seed_dir, &["config", "user.name", "Test User"]);
    run_git(
        &seed_dir,
        &["remote", "add", "origin", &remote_dir.to_string_lossy()],
    );

    std::fs::write(seed_dir.join("README.md"), "# Test\n").unwrap();
    run_git(&seed_dir, &["add", "README.md"]);
    run_git(&seed_dir, &["commit", "-m", "Initial"]);
    run_git(&seed_dir, &["push", "-u", "origin", "main"]);

    std::process::Command::new("git")
        .arg("clone")
        .arg(&remote_dir)
        .arg(&local_dir)
        .output()
        .unwrap();

    let repo = db
        .add_repo(local_dir.to_string_lossy().to_string())
        .unwrap();
    (dir, repo)
}

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
fn review_tables_store_singular_review_data() {
    let db = Database::open_in_memory().unwrap();

    let review_loop_columns: Vec<String> = db
        .conn
        .prepare("PRAGMA table_info(review_loops)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let review_run_columns: Vec<String> = db
        .conn
        .prepare("PRAGMA table_info(review_runs)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert!(!review_loop_columns.contains(&"max_rounds".to_string()));
    assert!(!review_loop_columns.contains(&"current_round".to_string()));
    assert!(!review_run_columns.contains(&"round".to_string()));
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
fn list_agent_profiles_rejects_corrupt_args_json() {
    let db = Database::open_in_memory().unwrap();
    db.conn
        .execute(
            "
            INSERT INTO agent_profiles
              (name, agent_kind, command, model, args_json, env_json, created_at, updated_at)
            VALUES ('Broken', 'custom', 'broken-agent', NULL, '{not-json', '{}', 'now', 'now')
            ",
            [],
        )
        .unwrap();

    let error = db.list_agent_profiles().unwrap_err();

    assert!(
        error.contains("Failed to parse agent profile args_json"),
        "{error}"
    );
}

#[test]
fn starts_review_loop_and_records_review_runs() {
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
    let profiles = db.list_agent_profiles().unwrap();
    let reviewer = profiles
        .iter()
        .find(|profile| profile.agent_kind == AgentKind::Claude)
        .unwrap();
    let task = db
        .create_task_record(
            repo.id,
            "Implement settings panel".to_string(),
            Some("Add project settings and tests".to_string()),
            Some(profiles[0].id),
            false,
            None,
        )
        .unwrap();

    let review_loop = db
        .start_review_loop(task.id, reviewer.id)
        .expect("review loop should start");

    assert_eq!(review_loop.task_id, task.id);
    assert_eq!(review_loop.reviewer_profile_id, reviewer.id);
    assert_eq!(review_loop.status, ReviewLoopStatus::Running);
    assert_eq!(review_loop.last_error, None);

    let run = db
        .record_review_run(ReviewRunInput {
            task_id: task.id,
            reviewer_profile_id: reviewer.id,
            verdict: ReviewVerdict::NeedsChanges,
            prompt: "Review this diff".to_string(),
            output: "Blocking issue: missing error path".to_string(),
            error: None,
        })
        .expect("review run should be recorded");

    assert_eq!(run.task_id, task.id);
    assert_eq!(run.verdict, ReviewVerdict::NeedsChanges);

    let review_loop = db.review_loop_by_task_id(task.id).unwrap().unwrap();
    assert_eq!(review_loop.status, ReviewLoopStatus::FeedbackSent);

    let runs = db.list_review_runs(task.id).unwrap();
    assert_eq!(runs, vec![run]);
}

#[test]
fn feedback_review_run_marks_loop_feedback_sent() {
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
    let profiles = db.list_agent_profiles().unwrap();
    let reviewer = profiles
        .iter()
        .find(|profile| profile.agent_kind == AgentKind::Claude)
        .unwrap();
    let task = db
        .create_task_record(
            repo.id,
            "Task".to_string(),
            None,
            Some(profiles[0].id),
            false,
            None,
        )
        .unwrap();
    db.start_review_loop(task.id, reviewer.id).unwrap();

    db.record_review_run(ReviewRunInput {
        task_id: task.id,
        reviewer_profile_id: reviewer.id,
        verdict: ReviewVerdict::Feedback,
        prompt: "Review this diff".to_string(),
        output: "NECTUS_FEEDBACK\nConsider extracting a helper.".to_string(),
        error: None,
    })
    .unwrap();

    let review_loop = db.review_loop_by_task_id(task.id).unwrap().unwrap();

    assert_eq!(review_loop.status, ReviewLoopStatus::FeedbackSent);
}

#[test]
fn passing_review_marks_task_done() {
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
    let profiles = db.list_agent_profiles().unwrap();
    let reviewer = profiles
        .iter()
        .find(|profile| profile.agent_kind == AgentKind::Claude)
        .unwrap();
    let task = db
        .create_task_record(
            repo.id,
            "Task".to_string(),
            None,
            Some(profiles[0].id),
            false,
            None,
        )
        .unwrap();
    db.update_task_metadata(task.id, None, Some(TaskStatus::InProgress), None)
        .unwrap();
    db.start_review_loop(task.id, reviewer.id).unwrap();

    db.record_review_run(ReviewRunInput {
        task_id: task.id,
        reviewer_profile_id: reviewer.id,
        verdict: ReviewVerdict::Pass,
        prompt: "Review this diff".to_string(),
        output: "NECTUS_NO_BLOCKERS".to_string(),
        error: None,
    })
    .unwrap();

    let task = db.task_by_id(task.id).unwrap().unwrap();

    assert_eq!(task.status, TaskStatus::Done);
}

#[test]
fn list_tasks_includes_review_loop_summary() {
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
    let profiles = db.list_agent_profiles().unwrap();
    let reviewer = profiles
        .iter()
        .find(|profile| profile.agent_kind == AgentKind::Claude)
        .unwrap();
    let task = db
        .create_task_record(
            repo.id,
            "Task".to_string(),
            None,
            Some(profiles[0].id),
            false,
            None,
        )
        .unwrap();
    db.start_review_loop(task.id, reviewer.id).unwrap();
    db.record_review_run(ReviewRunInput {
        task_id: task.id,
        reviewer_profile_id: reviewer.id,
        verdict: ReviewVerdict::Pass,
        prompt: "Review this diff".to_string(),
        output: "NECTUS_NO_BLOCKERS".to_string(),
        error: None,
    })
    .unwrap();

    let tasks = db.list_tasks(Some(repo.id)).unwrap();
    let task = tasks
        .iter()
        .find(|candidate| candidate.id == task.id)
        .expect("task should be returned");

    assert_eq!(task.review_loop_status, Some(ReviewLoopStatus::Passed));
}

#[test]
fn review_loop_rejects_invalid_reviewer() {
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
        .create_task_record(repo.id, "Task".to_string(), None, None, false, None)
        .unwrap();
    let missing_reviewer = db.start_review_loop(task.id, 9999).unwrap_err();
    assert!(
        missing_reviewer.contains("Reviewer profile not found"),
        "{missing_reviewer}"
    );
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
fn creates_worktree_task_with_generated_branch_when_branch_name_is_blank() {
    let db = Database::open_in_memory().unwrap();
    let (_dir, repo) = add_repo_with_remote(&db);

    let task = db
        .create_task_record(
            repo.id,
            "Review dependency updates".to_string(),
            None,
            None,
            true,
            None,
        )
        .unwrap();

    let branch_name = task.branch_name.as_deref().unwrap();
    let expected_worktree_path = PathBuf::from(&repo.default_worktree_root).join(branch_name);

    assert!(task.has_worktree);
    assert!(branch_name.starts_with("task-"), "{branch_name}");
    assert_eq!(
        task.worktree_path.as_deref(),
        Some(expected_worktree_path.to_string_lossy().as_ref())
    );
    assert!(expected_worktree_path.exists());
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
