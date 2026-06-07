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

    assert_eq!(profiles.len(), 4);
    assert_eq!(profiles[0].command, "codex");
    assert_eq!(profiles[1].command, "claude");
    assert_eq!(profiles[2].command, "gemini");
    assert_eq!(profiles[3].command, "opencode");
    assert_eq!(profiles[0].agent_kind, AgentKind::Codex);
    assert_eq!(profiles[1].agent_kind, AgentKind::Claude);
    assert_eq!(profiles[2].agent_kind, AgentKind::Gemini);
    assert_eq!(profiles[3].agent_kind, AgentKind::OpenCode);
}

#[test]
fn migrates_legacy_worktree_pattern_to_nectus_home() {
    let db = Database::open_in_memory().unwrap();
    let home = std::env::var("HOME").expect("HOME is set in the test environment");

    // Simulate a database created before the `~/.nectus` default: the global
    // pattern is still the legacy sibling layout and a repo's stored root was
    // resolved from it.
    db.conn
        .execute(
            "UPDATE app_settings SET default_worktree_root_pattern = '../{repoName}-worktrees' WHERE id = 1",
            [],
        )
        .unwrap();
    db.conn
        .execute(
            "INSERT INTO repos (name, path, default_worktree_root, created_at) VALUES ('demo', '/tmp/demo', '/tmp/demo-worktrees', '2020-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

    db.migrate_legacy_worktree_pattern().unwrap();

    let settings = db.get_app_settings().unwrap();
    assert_eq!(
        settings.default_worktree_root_pattern,
        "~/.nectus/worktrees/{repoName}"
    );

    let repo = db.repo_by_path("/tmp/demo").unwrap().unwrap();
    assert_eq!(
        repo.default_worktree_root,
        format!("{home}/.nectus/worktrees/demo")
    );
}

#[test]
fn leaves_custom_worktree_pattern_untouched() {
    let db = Database::open_in_memory().unwrap();

    db.conn
        .execute(
            "UPDATE app_settings SET default_worktree_root_pattern = '../custom/{repoName}' WHERE id = 1",
            [],
        )
        .unwrap();
    db.conn
        .execute(
            "INSERT INTO repos (name, path, default_worktree_root, created_at) VALUES ('demo', '/tmp/demo', '/tmp/sentinel-root', '2020-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

    db.migrate_legacy_worktree_pattern().unwrap();

    let settings = db.get_app_settings().unwrap();
    assert_eq!(
        settings.default_worktree_root_pattern,
        "../custom/{repoName}"
    );
    let repo = db.repo_by_path("/tmp/demo").unwrap().unwrap();
    assert_eq!(repo.default_worktree_root, "/tmp/sentinel-root");
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
        "~/.nectus/worktrees/{repoName}"
    );
    assert_eq!(settings.default_branch_prefix, None);
    assert_eq!(settings.theme, ThemeMode::System);
    assert_eq!(settings.density, DensityMode::Comfortable);

    let updated = db
        .update_app_settings(AppSettingsInput {
            default_agent_profile_id: Some(profiles[1].id),
            default_worktree_root_pattern: "../worktrees/{repoName}".to_string(),
            default_branch_prefix: Some("feat/".to_string()),
            jira_board_jql: None,
            jira_site_url: None,
            jira_board_project: None,
            jira_filter_my_issues: false,
            jira_filter_unresolved: true,
            jira_filter_current_sprint: false,
            jira_filter_statuses: vec![],
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
fn persists_jira_link_and_board_settings() {
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
        .create_task_record(repo.id, "Linked".to_string(), None, None, false, None)
        .unwrap();
    assert_eq!(task.jira_issue_key, None);

    let linked = db
        .set_task_jira_link(
            task.id,
            Some("PROJ-7".to_string()),
            Some("Fix login".to_string()),
            Some("https://x.atlassian.net/browse/PROJ-7".to_string()),
        )
        .unwrap();
    assert_eq!(linked.jira_issue_key.as_deref(), Some("PROJ-7"));
    assert_eq!(linked.jira_issue_summary.as_deref(), Some("Fix login"));
    // Survives a reload from the row mapper.
    assert_eq!(
        db.task_by_id(task.id)
            .unwrap()
            .unwrap()
            .jira_issue_url
            .as_deref(),
        Some("https://x.atlassian.net/browse/PROJ-7")
    );

    // Clearing all fields detaches the link.
    let cleared = db.set_task_jira_link(task.id, None, None, None).unwrap();
    assert_eq!(cleared.jira_issue_key, None);

    // Board JQL round-trips through app settings.
    let base = db.get_app_settings().unwrap();
    let saved = db
        .update_app_settings(AppSettingsInput {
            default_agent_profile_id: base.default_agent_profile_id,
            default_worktree_root_pattern: base.default_worktree_root_pattern,
            default_branch_prefix: base.default_branch_prefix,
            jira_board_jql: Some("project = PROJ".to_string()),
            jira_site_url: Some("https://x.atlassian.net".to_string()),
            jira_board_project: Some("PROJ".to_string()),
            jira_filter_my_issues: true,
            jira_filter_unresolved: false,
            jira_filter_current_sprint: true,
            jira_filter_statuses: vec![],
            theme: base.theme,
            density: base.density,
        })
        .unwrap();
    assert_eq!(saved.jira_board_jql.as_deref(), Some("project = PROJ"));
    assert_eq!(
        saved.jira_site_url.as_deref(),
        Some("https://x.atlassian.net")
    );
    assert_eq!(saved.jira_board_project.as_deref(), Some("PROJ"));
    assert!(saved.jira_filter_my_issues);
    assert!(!saved.jira_filter_unresolved);
    assert!(saved.jira_filter_current_sprint);
    // Reloads keep the structured board config.
    let reloaded = db.get_app_settings().unwrap();
    assert_eq!(reloaded.jira_board_project.as_deref(), Some("PROJ"));
    assert!(reloaded.jira_filter_current_sprint);
}

#[test]
fn persists_jira_filter_statuses_and_rest_account() {
    let db = Database::open_in_memory().unwrap();
    let base = db.get_app_settings().unwrap();

    db.update_app_settings(AppSettingsInput {
        default_agent_profile_id: base.default_agent_profile_id,
        default_worktree_root_pattern: base.default_worktree_root_pattern,
        default_branch_prefix: base.default_branch_prefix,
        jira_board_jql: None,
        jira_site_url: None,
        jira_board_project: None,
        jira_filter_my_issues: false,
        jira_filter_unresolved: true,
        jira_filter_current_sprint: false,
        jira_filter_statuses: vec!["To Do".into(), "Done".into()],
        theme: base.theme,
        density: base.density,
    })
    .unwrap();
    db.set_jira_rest_account("acme.atlassian.net", "a@b.com")
        .unwrap();

    let reloaded = db.get_app_settings().unwrap();
    assert_eq!(reloaded.jira_filter_statuses, vec!["To Do", "Done"]);
    assert_eq!(reloaded.jira_rest_email.as_deref(), Some("a@b.com"));
    assert_eq!(reloaded.jira_site_url.as_deref(), Some("acme.atlassian.net"));

    // Disconnect clears the email but leaves the rest of the board config intact.
    db.clear_jira_rest_email().unwrap();
    let after = db.get_app_settings().unwrap();
    assert_eq!(after.jira_rest_email, None);
    assert_eq!(after.jira_filter_statuses, vec!["To Do", "Done"]);
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
        jira_board_jql: None,
        jira_site_url: None,
        jira_board_project: None,
        jira_filter_my_issues: false,
        jira_filter_unresolved: true,
        jira_filter_current_sprint: false,
        jira_filter_statuses: vec![],
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
fn create_task_record_removes_orphan_worktree_when_insert_fails() {
    let db = Database::open_in_memory().unwrap();
    let (dir, repo) = add_repo_with_remote(&db);
    // Keep worktrees inside the test's tempdir rather than the real home.
    let wt_root = dir.path().join("worktrees");
    db.conn
        .execute(
            "UPDATE repos SET default_worktree_root = ?1 WHERE id = ?2",
            rusqlite::params![wt_root.to_string_lossy(), repo.id],
        )
        .unwrap();

    // First task claims branch "dup" and creates its worktree on disk.
    db.create_task_record(
        repo.id,
        "First".to_string(),
        None,
        None,
        true,
        Some("dup".to_string()),
    )
    .unwrap();
    let wt_path = wt_root.join("dup");
    assert!(wt_path.exists());

    // Externally remove the worktree and its branch so a *new* create_worktree
    // for "dup" succeeds — but the DB row still holds branch "dup", so the
    // INSERT will conflict on the unique (repo_id, branch_name) index.
    run_git(
        Path::new(&repo.path),
        &["worktree", "remove", "--force", wt_path.to_str().unwrap()],
    );
    run_git(Path::new(&repo.path), &["branch", "-D", "dup"]);
    assert!(!wt_path.exists());

    let result = db.create_task_record(
        repo.id,
        "Second".to_string(),
        None,
        None,
        true,
        Some("dup".to_string()),
    );

    assert!(result.is_err(), "duplicate branch insert must fail");
    assert!(
        !wt_path.exists(),
        "the worktree created before the failed INSERT must be cleaned up, not orphaned"
    );
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

    db.delete_task(task.id, false).unwrap();

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

    let error = db.delete_task(task.id, false).unwrap_err();

    assert!(error.contains("Stop the running session"), "{error}");
    assert!(db.task_by_id(task.id).unwrap().is_some());
}

/// Add a project whose `origin` remote is a GitHub URL (not fetched — only its
/// URL is read), so `resolve_repo_for_owner_repo` can match it.
fn add_repo_with_github_remote(
    db: &Database,
    owner: &str,
    name: &str,
) -> (tempfile::TempDir, Repo) {
    let dir = tempdir().unwrap();
    std::process::Command::new("git")
        .args(["init", "--initial-branch=main"])
        .arg(dir.path())
        .output()
        .unwrap();
    run_git(
        dir.path(),
        &[
            "remote",
            "add",
            "origin",
            &format!("https://github.com/{owner}/{name}.git"),
        ],
    );
    let repo = db
        .add_repo(dir.path().to_string_lossy().to_string())
        .unwrap();
    (dir, repo)
}

#[test]
fn resolves_known_repo_for_pull_request_owner_and_name() {
    let db = Database::open_in_memory().unwrap();
    let (_dir, repo) = add_repo_with_github_remote(&db, "hvp17", "nectus");

    // Matching is case-insensitive on both owner and repo.
    let resolved = db
        .resolve_repo_for_owner_repo("HVP17", "Nectus")
        .unwrap()
        .unwrap();
    assert_eq!(resolved.id, repo.id);
    assert!(db
        .resolve_repo_for_owner_repo("someone", "else")
        .unwrap()
        .is_none());
}

#[test]
fn creates_lists_and_transitions_a_pr_review() {
    let db = Database::open_in_memory().unwrap();
    let (_dir, repo) = add_repo_with_github_remote(&db, "hvp17", "nectus");
    let reviewer = db.list_agent_profiles().unwrap()[0].clone();

    let review = db
        .create_pr_review(
            repo.id,
            reviewer.id,
            "https://github.com/hvp17/nectus/pull/7",
            7,
        )
        .unwrap();
    assert_eq!(review.status, PrReviewStatus::Queued);
    assert_eq!(review.pr_number, 7);
    assert_eq!(review.repo_name, repo.name);
    assert_eq!(
        review.reviewer_name.as_deref(),
        Some(reviewer.name.as_str())
    );

    assert_eq!(review.verdict, None);

    db.set_pr_review_meta(review.id, Some("Add feature"), Some("octocat"), Some("main"))
        .unwrap();
    db.set_pr_review_result(review.id, "## Review\nLooks good.", PrReviewVerdict::Blockers)
        .unwrap();

    let loaded = db.pr_review_by_id(review.id).unwrap().unwrap();
    assert_eq!(loaded.status, PrReviewStatus::Ready);
    assert_eq!(loaded.verdict, Some(PrReviewVerdict::Blockers));
    assert_eq!(loaded.pr_title.as_deref(), Some("Add feature"));
    assert_eq!(loaded.pr_author.as_deref(), Some("octocat"));
    assert_eq!(loaded.base_branch.as_deref(), Some("main"));
    assert_eq!(
        loaded.review_output.as_deref(),
        Some("## Review\nLooks good.")
    );

    assert_eq!(db.list_pr_reviews().unwrap().len(), 1);

    // Rerun clears the prior output, verdict, and returns to queued.
    let rerun = db.reset_pr_review_for_rerun(review.id).unwrap();
    assert_eq!(rerun.status, PrReviewStatus::Queued);
    assert_eq!(rerun.review_output, None);
    assert_eq!(rerun.verdict, None);

    db.delete_pr_review(review.id).unwrap();
    assert!(db.pr_review_by_id(review.id).unwrap().is_none());
}

#[test]
fn creates_a_consensus_pr_review_and_records_rounds() {
    let db = Database::open_in_memory().unwrap();
    let (_dir, repo) = add_repo_with_github_remote(&db, "hvp17", "nectus");
    let profiles = db.list_agent_profiles().unwrap();
    let (codex, claude) = (profiles[0].clone(), profiles[1].clone());

    let review = db
        .create_consensus_pr_review(
            repo.id,
            codex.id,
            &[codex.id, claude.id],
            3,
            "https://github.com/hvp17/nectus/pull/8",
            8,
        )
        .unwrap();
    assert_eq!(review.mode, PrReviewMode::Consensus);
    assert_eq!(review.max_rounds, Some(3));
    assert_eq!(review.rounds_completed, 0);
    assert_eq!(review.converged, None);
    // The first selected reviewer is the synthesizer surfaced as the review name.
    assert_eq!(review.reviewer_profile_id, codex.id);
    assert_eq!(review.reviewers.len(), 2);
    assert_eq!(review.reviewers[0].reviewer_profile_id, codex.id);
    assert_eq!(review.reviewers[1].reviewer_profile_id, claude.id);

    // Record one round of both reviewers, then read them back in order.
    db.record_pr_review_run(PrReviewRunInput {
        pr_review_id: review.id,
        reviewer_profile_id: codex.id,
        round: 1,
        verdict: PrReviewVerdict::Blockers,
        output: "Codex: missing test.".to_string(),
        error: None,
    })
    .unwrap();
    let claude_run = db
        .record_pr_review_run(PrReviewRunInput {
            pr_review_id: review.id,
            reviewer_profile_id: claude.id,
            round: 1,
            verdict: PrReviewVerdict::Passed,
            output: "Claude: looks fine.".to_string(),
            error: None,
        })
        .unwrap();
    assert_eq!(claude_run.reviewer_name.as_deref(), Some(claude.name.as_str()));
    assert_eq!(claude_run.round, 1);

    let runs = db.list_pr_review_runs(review.id).unwrap();
    assert_eq!(runs.len(), 2);
    assert_eq!(runs[0].verdict, PrReviewVerdict::Blockers);

    db.set_pr_review_progress(review.id, 2).unwrap();
    db.set_pr_review_consensus(review.id, "## Consensus\nmissing test.", PrReviewVerdict::Blockers, true)
        .unwrap();

    let loaded = db.pr_review_by_id(review.id).unwrap().unwrap();
    assert_eq!(loaded.status, PrReviewStatus::Ready);
    assert_eq!(loaded.rounds_completed, 2);
    assert_eq!(loaded.converged, Some(true));
    assert_eq!(loaded.verdict, Some(PrReviewVerdict::Blockers));
    assert_eq!(loaded.review_output.as_deref(), Some("## Consensus\nmissing test."));

    // A consensus review needs at least two reviewers.
    assert!(db
        .create_consensus_pr_review(repo.id, codex.id, &[codex.id], 3, "x", 9)
        .is_err());
}

#[test]
fn rerunning_a_consensus_review_clears_its_rounds() {
    let db = Database::open_in_memory().unwrap();
    let (_dir, repo) = add_repo_with_github_remote(&db, "hvp17", "nectus");
    let profiles = db.list_agent_profiles().unwrap();
    let review = db
        .create_consensus_pr_review(
            repo.id,
            profiles[0].id,
            &[profiles[0].id, profiles[1].id],
            2,
            "https://github.com/hvp17/nectus/pull/4",
            4,
        )
        .unwrap();
    db.record_pr_review_run(PrReviewRunInput {
        pr_review_id: review.id,
        reviewer_profile_id: profiles[0].id,
        round: 1,
        verdict: PrReviewVerdict::Blockers,
        output: "x".to_string(),
        error: None,
    })
    .unwrap();
    db.set_pr_review_progress(review.id, 1).unwrap();

    let rerun = db.reset_pr_review_for_rerun(review.id).unwrap();
    assert_eq!(rerun.status, PrReviewStatus::Queued);
    assert_eq!(rerun.rounds_completed, 0);
    assert_eq!(rerun.converged, None);
    // The participating reviewers are kept; only the round outputs are cleared.
    assert_eq!(rerun.reviewers.len(), 2);
    assert!(db.list_pr_review_runs(review.id).unwrap().is_empty());
}

#[test]
fn deleting_a_consensus_review_cascades_to_runs_and_reviewers() {
    let db = Database::open_in_memory().unwrap();
    let (_dir, repo) = add_repo_with_github_remote(&db, "hvp17", "nectus");
    let profiles = db.list_agent_profiles().unwrap();
    let review = db
        .create_consensus_pr_review(
            repo.id,
            profiles[0].id,
            &[profiles[0].id, profiles[1].id],
            2,
            "https://github.com/hvp17/nectus/pull/5",
            5,
        )
        .unwrap();
    db.record_pr_review_run(PrReviewRunInput {
        pr_review_id: review.id,
        reviewer_profile_id: profiles[0].id,
        round: 1,
        verdict: PrReviewVerdict::Passed,
        output: "x".to_string(),
        error: None,
    })
    .unwrap();

    db.delete_pr_review(review.id).unwrap();

    assert!(db.pr_review_by_id(review.id).unwrap().is_none());
    assert!(db.list_pr_review_runs(review.id).unwrap().is_empty());
    assert!(db.list_pr_review_reviewers(review.id).unwrap().is_empty());
}

#[test]
fn deleting_a_repo_cascades_to_its_pr_reviews() {
    let db = Database::open_in_memory().unwrap();
    let (_dir, repo) = add_repo_with_github_remote(&db, "hvp17", "nectus");
    let reviewer = db.list_agent_profiles().unwrap()[0].clone();
    let review = db
        .create_pr_review(
            repo.id,
            reviewer.id,
            "https://github.com/hvp17/nectus/pull/1",
            1,
        )
        .unwrap();

    db.conn
        .execute("DELETE FROM repos WHERE id = ?1", [repo.id])
        .unwrap();

    assert!(db.pr_review_by_id(review.id).unwrap().is_none());
}

/// Insert a minimal repo row directly (no git setup) so workspace membership
/// tests can reference real repo ids without the cost of `add_repo_with_remote`.
fn insert_workspace_test_repo(db: &Database, name: &str) -> i64 {
    db.conn
        .execute(
            "INSERT INTO repos (name, path, default_worktree_root, created_at) VALUES (?1, ?2, ?3, '2020-01-01T00:00:00Z')",
            rusqlite::params![name, format!("/tmp/{name}"), format!("/tmp/{name}-wt")],
        )
        .unwrap();
    db.conn.last_insert_rowid()
}

#[test]
fn creates_and_lists_workspaces_with_ordered_repos() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    let beta = insert_workspace_test_repo(&db, "beta");
    let gamma = insert_workspace_test_repo(&db, "gamma");

    // Membership order is the order given, not a sort of repo ids.
    let workspace = db
        .create_workspace("Payments".to_string(), vec![gamma, alpha])
        .unwrap();
    assert_eq!(workspace.name, "Payments");
    assert_eq!(workspace.repo_ids, vec![gamma, alpha]);

    let all = db.list_workspaces().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].repo_ids, vec![gamma, alpha]);
    let _ = beta;
}

#[test]
fn update_workspace_replaces_members_and_reorders() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    let beta = insert_workspace_test_repo(&db, "beta");
    let gamma = insert_workspace_test_repo(&db, "gamma");
    let workspace = db
        .create_workspace("Stack".to_string(), vec![alpha, beta])
        .unwrap();

    let updated = db
        .update_workspace(
            workspace.id,
            "Stack v2".to_string(),
            vec![gamma, beta, alpha],
        )
        .unwrap();
    assert_eq!(updated.name, "Stack v2");
    assert_eq!(updated.repo_ids, vec![gamma, beta, alpha]);

    // Membership is fully replaced — no stale rows from the previous set.
    let member_count: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_repos WHERE workspace_id = ?1",
            [workspace.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(member_count, 3);
}

#[test]
fn create_workspace_drops_duplicate_repo_ids() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    let beta = insert_workspace_test_repo(&db, "beta");

    let workspace = db
        .create_workspace("Dedup".to_string(), vec![alpha, beta, alpha])
        .unwrap();
    assert_eq!(workspace.repo_ids, vec![alpha, beta]);
}

#[test]
fn deleting_a_workspace_cascades_membership() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    let workspace = db
        .create_workspace("Temp".to_string(), vec![alpha])
        .unwrap();

    db.delete_workspace(workspace.id).unwrap();

    assert!(db.list_workspaces().unwrap().is_empty());
    let member_count: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_repos WHERE workspace_id = ?1",
            [workspace.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(member_count, 0);
}

#[test]
fn deleting_a_member_repo_prunes_workspace_membership() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    let beta = insert_workspace_test_repo(&db, "beta");
    let workspace = db
        .create_workspace("Pair".to_string(), vec![alpha, beta])
        .unwrap();

    db.conn
        .execute("DELETE FROM repos WHERE id = ?1", [alpha])
        .unwrap();

    let reloaded = db.workspace_by_id(workspace.id).unwrap().unwrap();
    assert_eq!(reloaded.repo_ids, vec![beta]);
}

#[test]
fn rejects_a_blank_workspace_name() {
    let db = Database::open_in_memory().unwrap();
    let error = db.create_workspace("   ".to_string(), vec![]).unwrap_err();
    assert!(error.contains("name"));
}

#[test]
fn rejects_a_workspace_with_no_repos() {
    let db = Database::open_in_memory().unwrap();
    // An empty workspace would resolve to a filter that hides every project.
    let error = db.create_workspace("Empty".to_string(), vec![]).unwrap_err();
    assert!(error.contains("repository"));
}

#[test]
fn single_repo_task_gets_one_mirrored_task_repo_row() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    let task = db
        .create_task_record(alpha, "Solo".to_string(), None, None, false, None)
        .unwrap();
    assert_eq!(task.task_repos.len(), 1);
    assert_eq!(task.task_repos[0].repo_id, alpha);
    assert_eq!(task.task_repos[0].repo_name, "alpha");
    assert_eq!(task.task_repos[0].position, 0);
}

#[test]
fn backfill_creates_a_task_repos_row_for_legacy_tasks() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    // Simulate a pre-Increment-B task row with no task_repos row.
    db.conn
        .execute(
            "INSERT INTO tasks (repo_id, title, status, has_worktree, branch_name, worktree_path, created_at, updated_at)
             VALUES (?1, 'Legacy', 'planned', 1, 'feat/legacy', '/tmp/legacy-wt', '2020-01-01', '2020-01-01')",
            rusqlite::params![alpha],
        )
        .unwrap();
    let task_id = db.conn.last_insert_rowid();
    db.conn
        .execute("DELETE FROM task_repos WHERE task_id = ?1", [task_id])
        .unwrap();

    db.backfill_task_repos().unwrap();

    let repos = db.task_repos_for(task_id).unwrap();
    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].repo_id, alpha);
    assert_eq!(repos[0].branch_name.as_deref(), Some("feat/legacy"));
    assert_eq!(repos[0].worktree_path.as_deref(), Some("/tmp/legacy-wt"));
}

#[test]
fn cross_repo_task_requires_at_least_two_repos() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    let one = db
        .create_cross_repo_task(None, vec![alpha], "x".to_string(), None, None, None)
        .unwrap_err();
    assert!(one.contains("at least two"));
    // Duplicates collapse below the minimum too (no worktrees are created).
    let dup = db
        .create_cross_repo_task(None, vec![alpha, alpha], "x".to_string(), None, None, None)
        .unwrap_err();
    assert!(dup.contains("at least two"));
}

#[test]
fn creates_a_cross_repo_task_with_a_worktree_per_repo() {
    let db = Database::open_in_memory().unwrap();
    let wt_root = tempdir().unwrap();
    let (_dir_a, repo_a) = add_repo_with_remote(&db);
    let (_dir_b, repo_b) = add_repo_with_remote(&db);
    // Keep the worktrees inside the test's tempdir, not the real ~/.nectus. Both
    // repos share the parent so the cross-repo layout resolves under wt_root.
    for repo in [&repo_a, &repo_b] {
        db.conn
            .execute(
                "UPDATE repos SET default_worktree_root = ?1 WHERE id = ?2",
                rusqlite::params![
                    wt_root.path().join(&repo.name).to_string_lossy(),
                    repo.id
                ],
            )
            .unwrap();
    }

    let task = db
        .create_cross_repo_task(
            None,
            vec![repo_a.id, repo_b.id],
            "Cross feature".to_string(),
            Some("Wire the API to the UI".to_string()),
            None,
            Some("feat/cross".to_string()),
        )
        .unwrap();

    assert_eq!(task.repo_id, repo_a.id, "first repo is primary");
    assert!(task.has_worktree);
    assert_eq!(task.task_repos.len(), 2);
    // Both repos are on the shared branch with a worktree on disk.
    for task_repo in &task.task_repos {
        assert_eq!(task_repo.branch_name.as_deref(), Some("feat/cross"));
        let path = task_repo.worktree_path.as_deref().unwrap();
        assert!(Path::new(path).exists(), "worktree should exist: {path}");
    }
    let primary_wt = task.task_repos[0].worktree_path.clone().unwrap();
    let sibling_wt = task.task_repos[1].worktree_path.clone().unwrap();
    // The task's worktree_path is the primary's; siblings share one parent.
    assert_eq!(task.worktree_path.as_deref(), Some(primary_wt.as_str()));
    assert_eq!(
        Path::new(&primary_wt).parent(),
        Path::new(&sibling_wt).parent()
    );
    // The agent gets cross-repo context prepended to its prompt.
    assert!(task
        .prompt
        .as_deref()
        .unwrap()
        .contains("spans 2 repositories"));

    // Deleting the task removes every worktree and cascades task_repos.
    db.delete_task(task.id, false).unwrap();
    assert!(!Path::new(&primary_wt).exists());
    assert!(!Path::new(&sibling_wt).exists());
    assert!(db.task_by_id(task.id).unwrap().is_none());
    let orphans: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM task_repos WHERE task_id = ?1", [task.id], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(orphans, 0);
}

#[test]
fn rejects_a_duplicate_workspace_name() {
    let db = Database::open_in_memory().unwrap();
    let alpha = insert_workspace_test_repo(&db, "alpha");
    db.create_workspace("Platform".to_string(), vec![alpha])
        .unwrap();

    // Case-insensitive duplicate is rejected on create...
    let error = db
        .create_workspace("platform".to_string(), vec![alpha])
        .unwrap_err();
    assert!(error.contains("already exists"));

    // ...and on update, but a workspace can keep its own name.
    let other = db
        .create_workspace("Other".to_string(), vec![alpha])
        .unwrap();
    let kept = db
        .update_workspace(other.id, "Other".to_string(), vec![alpha])
        .unwrap();
    assert_eq!(kept.name, "Other");
    let clash = db
        .update_workspace(other.id, "Platform".to_string(), vec![alpha])
        .unwrap_err();
    assert!(clash.contains("already exists"));
}
