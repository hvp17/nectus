use serde::{Deserialize, Serialize};
use strum::{Display, EnumString, IntoStaticStr};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub account: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubCheckSummary {
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub pending: u32,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum GithubCheckState {
    Passing,
    Failing,
    Pending,
    None,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PullRequestState {
    Open,
    Merged,
    Closed,
    Unknown,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PullRequestReviewDecision {
    Approved,
    ChangesRequested,
    ReviewRequired,
}

/// Outcome of a single CI check / GitHub Actions run, as shown in the per-check
/// drill-down. Unlike [`GithubCheckState`] there is no `None` — a single check is
/// always one of pass / fail / pending.
#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum GithubCheckRunState {
    Pass,
    Fail,
    Pending,
}

/// One entry of a PR's `statusCheckRollup`: a GitHub Actions run or a classic
/// commit status. `workflow` is the Actions workflow name when present; `url`
/// links to the run's details page so a failing/running check can be opened.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GithubCheckRun {
    pub name: String,
    pub workflow: Option<String>,
    pub state: GithubCheckRunState,
    pub url: Option<String>,
}

/// How to merge a pull request, mapped 1:1 to the `gh pr merge` strategy flag.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MergeMethod {
    Squash,
    Merge,
    Rebase,
}

impl MergeMethod {
    /// The `gh pr merge` flag selecting this strategy.
    pub fn flag(self) -> &'static str {
        match self {
            MergeMethod::Squash => "--squash",
            MergeMethod::Merge => "--merge",
            MergeMethod::Rebase => "--rebase",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestInfo {
    pub number: i64,
    pub url: String,
    pub title: String,
    pub state: PullRequestState,
    pub is_draft: bool,
    pub review_decision: Option<PullRequestReviewDecision>,
    pub checks: GithubCheckSummary,
    pub checks_state: GithubCheckState,
    /// Per-check detail (GitHub Actions runs + commit statuses) for the drill-down.
    /// Parallel to `checks`, which keeps the aggregate counts.
    pub check_runs: Vec<GithubCheckRun>,
}
