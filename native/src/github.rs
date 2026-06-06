use crate::models::{
    GithubCheckRun, GithubCheckRunState, GithubCheckState, GithubCheckSummary, GithubStatus,
    MergeMethod, PullRequestInfo, PullRequestReviewDecision, PullRequestState,
};
use crate::process_util::{command_error, run_cli};
use serde::Deserialize;
use std::path::Path;
use std::process::{Command, Output};

/// Raw shape of a single `statusCheckRollup` entry from `gh pr view --json`.
/// Entries are either a `CheckRun` (`status` + `conclusion`, named by `name` and
/// `workflowName`, linked by `detailsUrl`) or a `StatusContext` (`state`, named by
/// `context`, linked by `targetUrl`); we keep every relevant field optional and
/// classify per entry.
#[derive(Debug, Deserialize)]
struct RawCheck {
    name: Option<String>,
    status: Option<String>,
    conclusion: Option<String>,
    state: Option<String>,
    context: Option<String>,
    #[serde(rename = "workflowName")]
    workflow_name: Option<String>,
    #[serde(rename = "detailsUrl")]
    details_url: Option<String>,
    #[serde(rename = "targetUrl")]
    target_url: Option<String>,
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

impl From<CheckOutcome> for GithubCheckRunState {
    fn from(outcome: CheckOutcome) -> Self {
        match outcome {
            CheckOutcome::Pass => GithubCheckRunState::Pass,
            CheckOutcome::Fail => GithubCheckRunState::Fail,
            CheckOutcome::Pending => GithubCheckRunState::Pending,
        }
    }
}

/// Build the per-check drill-down list (GitHub Actions runs + commit statuses).
/// A `CheckRun` is named by `name` and grouped by `workflowName`; a
/// `StatusContext` is named by `context`. The link is `detailsUrl`/`targetUrl`.
fn check_runs(rollup: &[RawCheck]) -> Vec<GithubCheckRun> {
    rollup
        .iter()
        .enumerate()
        .map(|(index, check)| {
            // GitHub checks are effectively always named (CheckRun.name /
            // StatusContext.context); the fallback is defensive. Number it so
            // multiple unnamed checks stay distinguishable in the drill-down.
            let name = check
                .name
                .as_deref()
                .or(check.context.as_deref())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Check #{}", index + 1));
            let url = check
                .details_url
                .as_deref()
                .or(check.target_url.as_deref())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            GithubCheckRun {
                name,
                workflow: check
                    .workflow_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                state: classify_check(check).into(),
                url,
            }
        })
        .collect()
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
        check_runs: check_runs(&raw.status_check_rollup),
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

/// Owner, repository, and number parsed from a GitHub pull request URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedPrUrl {
    pub owner: String,
    pub repo: String,
    pub number: i64,
}

/// Parse a GitHub pull request URL into owner, repo, and number. Accepts
/// `https://github.com/owner/repo/pull/123` and tolerates an `http`/scheme-less
/// prefix, a trailing slash, a `.git` repo suffix, a query string, and extra
/// path segments such as `/files` or `/commits`.
pub fn parse_pull_request_url(url: &str) -> Result<ParsedPrUrl, String> {
    let invalid = || "Not a valid GitHub pull request URL".to_string();
    let trimmed = url.trim();
    let rest = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("github.com/"))
        .ok_or_else(invalid)?;

    let mut parts = rest.split('/');
    let owner = parts.next().filter(|part| !part.is_empty());
    let repo = parts.next().filter(|part| !part.is_empty());
    let pull = parts.next();
    let number_part = parts.next();

    let (Some(owner), Some(repo), Some("pull"), Some(number_part)) =
        (owner, repo, pull, number_part)
    else {
        return Err(invalid());
    };

    let digits: String = number_part
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    let number: i64 = digits.parse().map_err(|_| invalid())?;
    // GitHub PR/issue numbers start at 1, so reject `/pull/0` (and any non-positive
    // parse) up front rather than letting a `gh pr <n>` call fail with a cryptic
    // message later.
    if number <= 0 {
        return Err(invalid());
    }

    Ok(ParsedPrUrl {
        owner: owner.to_string(),
        repo: repo.trim_end_matches(".git").to_string(),
        number,
    })
}

/// Metadata fetched from `gh pr view` for an external pull request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrMeta {
    pub title: String,
    pub author: Option<String>,
    pub base_branch: Option<String>,
}

const PR_META_FIELDS: &str = "title,author,baseRefName";

/// Fetch title/author/base-branch for a pull request via `gh pr view <number>`,
/// run in the resolved local repository so `gh` targets the right repo.
pub fn fetch_pull_request_meta(repo_path: &Path, number: i64) -> Result<PrMeta, String> {
    let number = number.to_string();
    let output = run_gh(
        Some(repo_path),
        &["pr", "view", &number, "--json", PR_META_FIELDS],
    )?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr view failed"));
    }
    parse_pull_request_meta(&String::from_utf8_lossy(&output.stdout))
}

fn parse_pull_request_meta(json: &str) -> Result<PrMeta, String> {
    #[derive(Deserialize)]
    struct RawAuthor {
        login: Option<String>,
    }
    #[derive(Deserialize)]
    struct RawMeta {
        title: String,
        #[serde(default)]
        author: Option<RawAuthor>,
        #[serde(rename = "baseRefName", default)]
        base_ref_name: Option<String>,
    }
    let raw: RawMeta = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse PR metadata: {error}"))?;
    Ok(PrMeta {
        title: raw.title,
        author: raw
            .author
            .and_then(|author| author.login)
            .filter(|login| !login.is_empty()),
        base_branch: raw.base_ref_name.filter(|branch| !branch.is_empty()),
    })
}

fn run_gh(current_dir: Option<&Path>, args: &[&str]) -> Result<Output, String> {
    run_cli("gh", current_dir, "GitHub CLI (gh) is not installed", args)
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
    // Force non-interactive auth so a missing HTTPS credential or first-time SSH
    // host-key prompt fails fast instead of hanging the (tty-less) worker thread.
    let push = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .args(["push", "--set-upstream", "origin", "HEAD"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
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

/// JSON fields requested from `gh pr view`; shared by status and detection so the
/// two stay in sync.
const PR_VIEW_FIELDS: &str = "number,state,url,title,isDraft,reviewDecision,statusCheckRollup";

/// Run `gh pr view` for the worktree's branch. `gh` resolves the PR from the
/// current branch on its own, so no explicit PR reference is needed.
fn run_pr_view(worktree: &Path) -> Result<Output, String> {
    run_gh(Some(worktree), &["pr", "view", "--json", PR_VIEW_FIELDS])
}

/// Fetch the live status of the pull request for the worktree's branch.
pub fn pull_request_status(worktree: &Path) -> Result<PullRequestInfo, String> {
    let output = run_pr_view(worktree)?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr view failed"));
    }
    parse_pull_request(&String::from_utf8_lossy(&output.stdout))
}

/// Detect the pull request GitHub associates with the worktree's current branch
/// (for example one opened from the terminal). Returns `Ok(None)` when the branch
/// simply has no PR yet — the normal "not opened" state — so callers can tell that
/// apart from a real `gh` failure.
pub fn find_pull_request(worktree: &Path) -> Result<Option<PullRequestInfo>, String> {
    let output = run_pr_view(worktree)?;
    if output.status.success() {
        return parse_pull_request(&String::from_utf8_lossy(&output.stdout)).map(Some);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    if is_no_pull_request_error(&stderr) {
        return Ok(None);
    }
    Err(command_error(&output, "gh pr view failed"))
}

/// `gh pr view` exits non-zero with a `no [open] pull requests found for branch …`
/// message when the branch has no associated PR; that is "not opened yet", not an
/// error we should surface. Match the distinctive phrase so both the plain and
/// `open` variants (which differ across gh versions) are recognized.
fn is_no_pull_request_error(stderr: &str) -> bool {
    stderr
        .to_lowercase()
        .contains("pull requests found for branch")
}

/// Merge the pull request for the worktree's branch using `method`. We deliberately
/// do **not** pass `--delete-branch`: the branch is checked out in this worktree, so
/// letting `gh` delete it would fail or strand the worktree — task deletion removes
/// the worktree later. GitHub branch protection remains the source of truth, so a
/// merge that isn't allowed (failing required checks, missing approval) surfaces
/// `gh`'s own error. The caller refreshes status separately so a flaky status fetch
/// can't mask a merge that already succeeded.
pub fn merge_pull_request(worktree: &Path, method: MergeMethod) -> Result<(), String> {
    let output = run_gh(Some(worktree), &["pr", "merge", method.flag()])?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr merge failed"));
    }
    Ok(())
}

/// Mark the worktree branch's pull request ready for review (`gh pr ready`), or
/// convert it back to a draft when `ready` is false (`gh pr ready --undo`).
pub fn set_pull_request_ready(worktree: &Path, ready: bool) -> Result<(), String> {
    let mut args = vec!["pr", "ready"];
    if !ready {
        args.push("--undo");
    }
    let output = run_gh(Some(worktree), &args)?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr ready failed"));
    }
    Ok(())
}

/// Close the pull request for the worktree's branch without merging it
/// (`gh pr close`).
pub fn close_pull_request(worktree: &Path) -> Result<(), String> {
    let output = run_gh(Some(worktree), &["pr", "close"])?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr close failed"));
    }
    Ok(())
}

/// Post `body` as a comment on pull request `number`, run in the resolved repo so
/// `gh` targets the right PR. Multi-line Markdown passes safely as a single
/// argument (no shell is involved). Used to land an AI PR review on the actual PR.
pub fn comment_on_pull_request(repo_path: &Path, number: i64, body: &str) -> Result<(), String> {
    let number = number.to_string();
    let output = run_gh(Some(repo_path), &["pr", "comment", &number, "--body", body])?;
    if !output.status.success() {
        return Err(command_error(&output, "gh pr comment failed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pull_request_url_variants() {
        let parsed = parse_pull_request_url("https://github.com/hvp17/nectus/pull/42").unwrap();
        assert_eq!(parsed.owner, "hvp17");
        assert_eq!(parsed.repo, "nectus");
        assert_eq!(parsed.number, 42);

        // Trailing slash, extra path segment, `.git` suffix, query string, scheme-less.
        assert_eq!(
            parse_pull_request_url("https://github.com/a/b/pull/7/")
                .unwrap()
                .number,
            7
        );
        assert_eq!(
            parse_pull_request_url("https://github.com/a/b/pull/7/files")
                .unwrap()
                .number,
            7
        );
        assert_eq!(
            parse_pull_request_url("https://github.com/a/b.git/pull/7")
                .unwrap()
                .repo,
            "b"
        );
        assert_eq!(
            parse_pull_request_url("https://github.com/a/b/pull/7?diff=split")
                .unwrap()
                .number,
            7
        );
        assert_eq!(
            parse_pull_request_url("github.com/a/b/pull/9").unwrap().number,
            9
        );
    }

    #[test]
    fn rejects_non_pull_request_urls() {
        for value in [
            "",
            "https://github.com/a/b",
            "https://github.com/a/b/issues/3",
            "https://gitlab.com/a/b/pull/3",
            "https://github.com/a/b/pull/notanumber",
            "https://github.com/a/b/pull/0",
            "not a url",
        ] {
            assert!(
                parse_pull_request_url(value).is_err(),
                "{value} should be rejected"
            );
        }
    }

    #[test]
    fn parses_pull_request_meta_with_author_and_base() {
        let meta = parse_pull_request_meta(
            r#"{"title":"Add feature","author":{"login":"octocat"},"baseRefName":"main"}"#,
        )
        .unwrap();
        assert_eq!(meta.title, "Add feature");
        assert_eq!(meta.author.as_deref(), Some("octocat"));
        assert_eq!(meta.base_branch.as_deref(), Some("main"));
    }

    #[test]
    fn parses_pull_request_meta_with_missing_author() {
        let meta = parse_pull_request_meta(r#"{"title":"Tidy","author":null}"#).unwrap();
        assert_eq!(meta.title, "Tidy");
        assert_eq!(meta.author, None);
        assert_eq!(meta.base_branch, None);
    }

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
    fn recognizes_the_no_pull_request_branch_message() {
        // `gh pr view` prints this to stderr (exit 1) when the branch has no PR.
        assert!(is_no_pull_request_error(
            "no pull requests found for branch \"main\""
        ));
        // Tolerate casing and the "open" variant some gh versions emit.
        assert!(is_no_pull_request_error(
            "No open pull requests found for branch \"feat/x\""
        ));
        // A genuine failure (auth, missing remote, …) must not be mistaken for it.
        assert!(!is_no_pull_request_error(
            "could not determine current branch"
        ));
        assert!(!is_no_pull_request_error("gh: not authenticated"));
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

    #[test]
    fn builds_per_check_drill_down_with_names_workflow_and_links() {
        let json = r#"{
            "number": 20,
            "url": "https://github.com/a/b/pull/20",
            "title": "Has actions",
            "state": "OPEN",
            "isDraft": false,
            "reviewDecision": "",
            "statusCheckRollup": [
                {"__typename":"CheckRun","name":"build","workflowName":"CI","status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://github.com/a/b/actions/runs/1"},
                {"__typename":"CheckRun","name":"test","workflowName":"CI","status":"IN_PROGRESS","conclusion":null,"detailsUrl":"https://github.com/a/b/actions/runs/2"},
                {"__typename":"StatusContext","context":"ci/circleci","state":"FAILURE","targetUrl":"https://circleci.com/x"}
            ]
        }"#;

        let pr = parse_pull_request(json).unwrap();

        // Summary counts are unchanged; the drill-down is parallel to them.
        assert_eq!(pr.checks.total, 3);
        assert_eq!(pr.check_runs.len(), 3);

        let build = &pr.check_runs[0];
        assert_eq!(build.name, "build");
        assert_eq!(build.workflow.as_deref(), Some("CI"));
        assert_eq!(build.state, GithubCheckRunState::Pass);
        assert_eq!(
            build.url.as_deref(),
            Some("https://github.com/a/b/actions/runs/1")
        );

        // An in-progress GitHub Actions run is pending, not failing.
        assert_eq!(pr.check_runs[1].state, GithubCheckRunState::Pending);

        // A classic commit status is named by its context and linked by targetUrl.
        let status = &pr.check_runs[2];
        assert_eq!(status.name, "ci/circleci");
        assert_eq!(status.workflow, None);
        assert_eq!(status.state, GithubCheckRunState::Fail);
        assert_eq!(status.url.as_deref(), Some("https://circleci.com/x"));
    }

    #[test]
    fn unnamed_checks_get_unique_numbered_fallback_names() {
        let json = r#"{
            "number": 21, "url": "u", "title": "t", "state": "OPEN", "isDraft": false,
            "reviewDecision": "",
            "statusCheckRollup": [
                {"status":"COMPLETED","conclusion":"SUCCESS"},
                {"status":"COMPLETED","conclusion":"FAILURE"}
            ]
        }"#;

        let pr = parse_pull_request(json).unwrap();

        assert_eq!(pr.check_runs.len(), 2);
        // The defensive fallback numbers unnamed checks so they stay distinct.
        assert_eq!(pr.check_runs[0].name, "Check #1");
        assert_eq!(pr.check_runs[1].name, "Check #2");
        assert_eq!(pr.check_runs[0].url, None);
    }

    #[test]
    fn merge_method_maps_to_gh_flag() {
        assert_eq!(MergeMethod::Squash.flag(), "--squash");
        assert_eq!(MergeMethod::Merge.flag(), "--merge");
        assert_eq!(MergeMethod::Rebase.flag(), "--rebase");
    }
}
