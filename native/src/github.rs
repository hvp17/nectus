use crate::models::{
    GithubCheckState, GithubCheckSummary, GithubStatus, PullRequestInfo, PullRequestReviewDecision,
    PullRequestState,
};
use serde::Deserialize;
use std::path::Path;
use std::process::{Command, Output};

/// Raw shape of a single `statusCheckRollup` entry from `gh pr view --json`.
/// Entries are either a `CheckRun` (`status` + `conclusion`) or a
/// `StatusContext` (`state`); we keep every relevant field optional and classify
/// per entry.
#[derive(Debug, Deserialize)]
struct RawCheck {
    status: Option<String>,
    conclusion: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawPullRequest {
    number: i64,
    url: String,
    title: String,
    state: String,
    #[serde(rename = "isDraft", default)]
    is_draft: bool,
    #[serde(rename = "reviewDecision", default)]
    review_decision: Option<String>,
    #[serde(rename = "statusCheckRollup", default)]
    status_check_rollup: Vec<RawCheck>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CheckOutcome {
    Pass,
    Fail,
    Pending,
}

fn classify_check(check: &RawCheck) -> CheckOutcome {
    if let Some(status) = check.status.as_deref() {
        // CheckRun: a check is only decided once it has COMPLETED.
        if status != "COMPLETED" {
            return CheckOutcome::Pending;
        }
        return match check.conclusion.as_deref() {
            Some("SUCCESS") | Some("NEUTRAL") | Some("SKIPPED") => CheckOutcome::Pass,
            // Awaiting a manual gate (e.g. deploy approval) or needing a re-run —
            // not a real failure, so surface as pending rather than failing.
            Some("ACTION_REQUIRED") | Some("STALE") => CheckOutcome::Pending,
            Some(_) => CheckOutcome::Fail,
            None => CheckOutcome::Pending,
        };
    }
    if let Some(state) = check.state.as_deref() {
        // StatusContext: classic commit status.
        return match state {
            "SUCCESS" => CheckOutcome::Pass,
            "PENDING" | "EXPECTED" => CheckOutcome::Pending,
            _ => CheckOutcome::Fail,
        };
    }
    CheckOutcome::Pending
}

fn summarize_checks(rollup: &[RawCheck]) -> (GithubCheckSummary, GithubCheckState) {
    let mut summary = GithubCheckSummary::default();
    for check in rollup {
        summary.total += 1;
        match classify_check(check) {
            CheckOutcome::Pass => summary.passed += 1,
            CheckOutcome::Fail => summary.failed += 1,
            CheckOutcome::Pending => summary.pending += 1,
        }
    }
    let state = if summary.total == 0 {
        GithubCheckState::None
    } else if summary.failed > 0 {
        GithubCheckState::Failing
    } else if summary.pending > 0 {
        GithubCheckState::Pending
    } else {
        GithubCheckState::Passing
    };
    (summary, state)
}

fn map_state(state: &str) -> PullRequestState {
    match state {
        "OPEN" => PullRequestState::Open,
        "MERGED" => PullRequestState::Merged,
        "CLOSED" => PullRequestState::Closed,
        _ => PullRequestState::Unknown,
    }
}

fn map_review_decision(decision: Option<&str>) -> Option<PullRequestReviewDecision> {
    match decision {
        Some("APPROVED") => Some(PullRequestReviewDecision::Approved),
        Some("CHANGES_REQUESTED") => Some(PullRequestReviewDecision::ChangesRequested),
        Some("REVIEW_REQUIRED") => Some(PullRequestReviewDecision::ReviewRequired),
        _ => None,
    }
}

/// Parse the JSON from `gh pr view --json …` into a [`PullRequestInfo`].
pub fn parse_pull_request(json: &str) -> Result<PullRequestInfo, String> {
    let raw: RawPullRequest = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse PR details: {error}"))?;
    let (checks, checks_state) = summarize_checks(&raw.status_check_rollup);
    Ok(PullRequestInfo {
        number: raw.number,
        url: raw.url,
        title: raw.title,
        state: map_state(&raw.state),
        is_draft: raw.is_draft,
        review_decision: map_review_decision(raw.review_decision.as_deref()),
        checks,
        checks_state,
    })
}

/// Extract the account login from `gh api user` JSON output.
pub fn parse_login(user_json: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct User {
        login: Option<String>,
    }
    serde_json::from_str::<User>(user_json)
        .ok()
        .and_then(|user| user.login)
        .filter(|login| !login.is_empty())
}

/// Extract the pull request URL printed by `gh pr create` (its last URL line).
pub fn parse_pr_url(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .rev()
        .find(|line| is_pull_request_url(line))
        .map(str::to_string)
}

/// A line is a PR URL when it is an https link whose `/pull/` segment is
/// immediately followed by a PR number (guards against e.g. `/pull/requests`).
fn is_pull_request_url(line: &str) -> bool {
    line.starts_with("https://")
        && line
            .split_once("/pull/")
            .and_then(|(_, rest)| rest.chars().next())
            .is_some_and(|c| c.is_ascii_digit())
}

fn command_error(output: &Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        fallback.into()
    } else {
        stderr
    }
}

fn run_gh(current_dir: Option<&Path>, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("gh");
    if let Some(dir) = current_dir {
        command.current_dir(dir);
    }
    command.args(args).output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "GitHub CLI (gh) is not installed".to_string()
        } else {
            format!("Failed to run gh: {error}")
        }
    })
}

/// Report whether `gh` is installed, authenticated, and which account is active.
/// Never errors — a missing `gh` simply reports `installed: false`.
pub fn status() -> GithubStatus {
    let installed = run_gh(None, &["--version"])
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !installed {
        return GithubStatus {
            installed: false,
            authenticated: false,
            account: None,
        };
    }

    // `gh auth status` checks stored credentials without needing the network.
    let authenticated = run_gh(None, &["auth", "status"])
        .map(|output| output.status.success())
        .unwrap_or(false);
    let account = if authenticated {
        run_gh(None, &["api", "user"])
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| parse_login(&String::from_utf8_lossy(&output.stdout)))
    } else {
        None
    };

    GithubStatus {
        installed: true,
        authenticated,
        account,
    }
}

/// Push the worktree branch and open a pull request, returning the PR URL.
pub fn create_pull_request(
    worktree: &Path,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<String, String> {
    // Ensure the branch exists on the remote so `gh` can open the PR against it.
    let push = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .args(["push", "--set-upstream", "origin", "HEAD"])
        .output()
        .map_err(|error| format!("Failed to push branch: {error}"))?;
    if !push.status.success() {
        return Err(command_error(
            &push,
            "Failed to push branch before creating PR",
        ));
    }

    let mut args = vec!["pr", "create", "--title", title, "--body", body];
    if draft {
        args.push("--draft");
    }
    let output = run_gh(Some(worktree), &args)?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr create failed"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_pr_url(&stdout).ok_or_else(|| "gh pr create did not return a PR URL".to_string())
}

/// Fetch the live status of the pull request for the worktree's branch.
pub fn pull_request_status(worktree: &Path) -> Result<PullRequestInfo, String> {
    let output = run_gh(
        Some(worktree),
        &[
            "pr",
            "view",
            "--json",
            "number,state,url,title,isDraft,reviewDecision,statusCheckRollup",
        ],
    )?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr view failed"));
    }
    parse_pull_request(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_login_from_user_json() {
        assert_eq!(
            parse_login(r#"{"login":"hvp17"}"#),
            Some("hvp17".to_string())
        );
    }

    #[test]
    fn returns_no_login_for_empty_or_invalid_user_json() {
        assert_eq!(parse_login(r#"{"login":""}"#), None);
        assert_eq!(parse_login("not json"), None);
        assert_eq!(parse_login("{}"), None);
    }

    #[test]
    fn parses_pr_url_from_create_output() {
        let stdout = "\nhttps://github.com/hvp17/nectus/pull/42\n";
        assert_eq!(
            parse_pr_url(stdout),
            Some("https://github.com/hvp17/nectus/pull/42".to_string())
        );
    }

    #[test]
    fn ignores_non_pull_lines_when_parsing_url() {
        let stdout = "Warning: 3 uncommitted changes\nhttps://github.com/hvp17/nectus/pull/7";
        assert_eq!(
            parse_pr_url(stdout),
            Some("https://github.com/hvp17/nectus/pull/7".to_string())
        );
        assert_eq!(parse_pr_url("no url here"), None);
    }

    #[test]
    fn parses_pr_url_only_when_pull_is_followed_by_a_number() {
        // A trailing https link that contains "/pull/" but is not a numbered PR
        // (e.g. a "/pull/requests" path) must not be mistaken for the created PR.
        let stdout =
            "https://github.com/hvp17/nectus/pull/55\nhttps://github.com/hvp17/nectus/pull/requests";
        assert_eq!(
            parse_pr_url(stdout),
            Some("https://github.com/hvp17/nectus/pull/55".to_string())
        );
    }

    #[test]
    fn treats_action_required_and_stale_checks_as_pending_not_failing() {
        let json = r#"{
            "number": 14,
            "url": "https://github.com/hvp17/nectus/pull/14",
            "title": "Awaiting deploy approval",
            "state": "OPEN",
            "isDraft": false,
            "reviewDecision": "",
            "statusCheckRollup": [
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"ACTION_REQUIRED"},
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"STALE"}
            ]
        }"#;

        let pr = parse_pull_request(json).unwrap();

        assert_eq!(pr.checks.failed, 0);
        assert_eq!(pr.checks.pending, 2);
        assert_eq!(pr.checks.passed, 1);
        assert_eq!(pr.checks_state, GithubCheckState::Pending);
    }

    #[test]
    fn parses_open_pr_with_mixed_checks() {
        let json = r#"{
            "number": 12,
            "url": "https://github.com/hvp17/nectus/pull/12",
            "title": "Add GitHub integration",
            "state": "OPEN",
            "isDraft": false,
            "reviewDecision": "REVIEW_REQUIRED",
            "statusCheckRollup": [
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SKIPPED"},
                {"__typename":"CheckRun","status":"IN_PROGRESS","conclusion":null},
                {"__typename":"StatusContext","state":"PENDING"}
            ]
        }"#;

        let pr = parse_pull_request(json).unwrap();

        assert_eq!(pr.number, 12);
        assert_eq!(pr.state, PullRequestState::Open);
        assert!(!pr.is_draft);
        assert_eq!(
            pr.review_decision,
            Some(PullRequestReviewDecision::ReviewRequired)
        );
        assert_eq!(
            pr.checks,
            GithubCheckSummary {
                total: 4,
                passed: 2,
                failed: 0,
                pending: 2,
            }
        );
        assert_eq!(pr.checks_state, GithubCheckState::Pending);
    }

    #[test]
    fn marks_failing_checks_when_any_check_fails() {
        let json = r#"{
            "number": 3,
            "url": "https://github.com/hvp17/nectus/pull/3",
            "title": "Broken build",
            "state": "OPEN",
            "isDraft": true,
            "reviewDecision": "",
            "statusCheckRollup": [
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"FAILURE"},
                {"__typename":"StatusContext","state":"ERROR"}
            ]
        }"#;

        let pr = parse_pull_request(json).unwrap();

        assert!(pr.is_draft);
        assert_eq!(pr.review_decision, None);
        assert_eq!(pr.checks.failed, 2);
        assert_eq!(pr.checks_state, GithubCheckState::Failing);
    }

    #[test]
    fn parses_merged_pr_with_no_checks() {
        let json = r#"{
            "number": 1,
            "url": "https://github.com/hvp17/nectus/pull/1",
            "title": "Initial",
            "state": "MERGED",
            "isDraft": false,
            "reviewDecision": "APPROVED",
            "statusCheckRollup": []
        }"#;

        let pr = parse_pull_request(json).unwrap();

        assert_eq!(pr.state, PullRequestState::Merged);
        assert_eq!(
            pr.review_decision,
            Some(PullRequestReviewDecision::Approved)
        );
        assert_eq!(pr.checks, GithubCheckSummary::default());
        assert_eq!(pr.checks_state, GithubCheckState::None);
    }

    #[test]
    fn reports_passing_when_all_checks_succeed() {
        let json = r#"{
            "number": 9,
            "url": "https://github.com/hvp17/nectus/pull/9",
            "title": "Green",
            "state": "OPEN",
            "isDraft": false,
            "reviewDecision": "CHANGES_REQUESTED",
            "statusCheckRollup": [
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},
                {"__typename":"StatusContext","state":"SUCCESS"}
            ]
        }"#;

        let pr = parse_pull_request(json).unwrap();

        assert_eq!(pr.checks_state, GithubCheckState::Passing);
        assert_eq!(pr.checks.passed, 2);
        assert_eq!(
            pr.review_decision,
            Some(PullRequestReviewDecision::ChangesRequested)
        );
    }
}
