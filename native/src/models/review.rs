use serde::{Deserialize, Serialize};
use strum::{Display, EnumString, IntoStaticStr};

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ReviewLoopStatus {
    Running,
    Reviewing,
    Passed,
    FeedbackSent,
    Error,
    Stopped,
}

#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ReviewVerdict {
    Pass,
    NeedsChanges,
    Feedback,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLoop {
    pub task_id: i64,
    pub reviewer_profile_id: i64,
    pub status: ReviewLoopStatus,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRun {
    pub id: i64,
    pub task_id: i64,
    pub reviewer_profile_id: i64,
    pub verdict: ReviewVerdict,
    pub prompt: String,
    pub output: String,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunInput {
    pub task_id: i64,
    pub reviewer_profile_id: i64,
    pub verdict: ReviewVerdict,
    pub prompt: String,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLoopUpdatedEvent {
    pub task_id: i64,
    pub review_loop: ReviewLoop,
    pub review_run: Option<ReviewRun>,
}

/// A chunk of a task reviewer's live stdout, streamed so the workspace can show
/// the reviewer working in real time (read-only) the way a live agent session
/// shows in `SessionOutputEvent`. `start_offset` is the byte offset of this chunk
/// in the current run's output; a chunk at offset `0` marks the start of a new
/// run, so the UI resets its buffer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOutputEvent {
    pub task_id: i64,
    pub data: String,
    pub start_offset: u64,
}

/// Lifecycle of a single external pull-request review.
#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PrReviewStatus {
    Queued,
    Reviewing,
    Ready,
    Error,
}

/// The conclusion of a completed PR review, parsed from the reviewer's
/// machine-readable verdict marker. Only set once a review reaches `Ready`;
/// `Inconclusive` covers reviews that finished without emitting a recognizable
/// marker.
#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PrReviewVerdict {
    Passed,
    Blockers,
    Inconclusive,
}

/// How a PR review is run: a single reviewer (the original behavior) or a
/// multi-model consensus where several reviewers review in parallel, share each
/// other's reviews, iterate, and a final synthesis pass merges the result.
#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Display, EnumString, IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PrReviewMode {
    Single,
    Consensus,
}

/// A review of an external GitHub pull request, resolved against a known local
/// project and reviewed in an ephemeral worktree. `mode` distinguishes a single
/// reviewer from a consensus run; the consensus-only fields (`max_rounds`,
/// `rounds_completed`, `converged`, `reviewers`) are inert for single reviews.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrReview {
    pub id: i64,
    pub repo_id: i64,
    pub repo_name: String,
    /// Single mode: the lone reviewer. Consensus mode: the synthesizer that
    /// merges the participants' final reviews into the consensus output.
    pub reviewer_profile_id: i64,
    pub reviewer_name: Option<String>,
    pub pr_url: String,
    pub pr_number: i64,
    pub pr_title: Option<String>,
    pub pr_author: Option<String>,
    pub base_branch: Option<String>,
    pub status: PrReviewStatus,
    pub verdict: Option<PrReviewVerdict>,
    pub review_output: Option<String>,
    pub last_error: Option<String>,
    pub worktree_path: Option<String>,
    pub mode: PrReviewMode,
    /// Consensus only: the iteration cap. `None` for single reviews.
    pub max_rounds: Option<i64>,
    /// Consensus only: how many parallel review rounds have finished so far.
    pub rounds_completed: i64,
    /// Consensus only: whether the reviewers reached the same verdict before the
    /// cap. `None` until the run finishes (and for single reviews).
    pub converged: Option<bool>,
    /// Consensus only: the participating reviewers. Empty for single reviews.
    pub reviewers: Vec<PrReviewReviewer>,
    pub created_at: String,
    pub updated_at: String,
}

/// A reviewer participating in a consensus PR review.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewReviewer {
    pub reviewer_profile_id: i64,
    pub reviewer_name: Option<String>,
}

/// One reviewer's output for one round of a consensus PR review.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewRun {
    pub id: i64,
    pub pr_review_id: i64,
    pub reviewer_profile_id: i64,
    pub reviewer_name: Option<String>,
    pub round: i64,
    pub verdict: PrReviewVerdict,
    pub output: String,
    pub error: Option<String>,
    pub created_at: String,
}

/// Insert payload for recording a single reviewer's round output.
#[derive(Debug, Clone)]
pub struct PrReviewRunInput {
    pub pr_review_id: i64,
    pub reviewer_profile_id: i64,
    pub round: i64,
    pub verdict: PrReviewVerdict,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReviewUpdatedEvent {
    pub pr_review: PrReview,
    /// The round output that triggered this update, when one did, so the UI can
    /// append it live. `None` for lifecycle-only updates (status/meta changes).
    pub latest_run: Option<PrReviewRun>,
}
