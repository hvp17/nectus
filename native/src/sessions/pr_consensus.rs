use super::pr_review::build_pr_review_prompt;
use super::pr_verdict::{parse_pr_review_output, PR_VERDICT_MARKER};
use super::pr_worktree::with_pr_worktree;
use super::reviewer::{reviewer_supports_resume, run_reviewer_command, ReviewerRunOutput};
use crate::db::Database;
use crate::github::{self, PrMeta};
use crate::models::{
    AgentProfile, PrReviewRun, PrReviewRunInput, PrReviewStatus, PrReviewUpdatedEvent,
    PrReviewVerdict,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// A reviewer's outcome for one round, used to feed the next round and the final
/// synthesis. `review` is the human-facing Markdown with the verdict marker
/// already stripped; `error` is set instead when that reviewer failed to run.
struct ReviewerOutcome {
    reviewer_profile_id: i64,
    name: String,
    verdict: PrReviewVerdict,
    review: String,
    error: Option<String>,
}

/// Each peer review is clipped to this many bytes before being pasted into a
/// debate/synthesis prompt, so a long review can't blow up the next prompt.
const MAX_PEER_REVIEW_CHARS: usize = 6000;

/// Run a queued consensus review on a background thread, mirroring
/// [`super::pr_review::spawn_pr_review`] but fanning out to several reviewers.
pub(super) fn spawn_consensus_pr_review(
    app: AppHandle,
    db: Arc<Mutex<Database>>,
    review_id: i64,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_consensus_pr_review(&app, &db, review_id) {
            tracing::warn!(?error, review_id, "consensus pr review failed");
            let _ = db
                .lock()
                .set_pr_review_status(review_id, PrReviewStatus::Error, Some(&error));
            emit_consensus_update(&app, &db, review_id, None);
        }
    });
}

fn run_consensus_pr_review(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    review_id: i64,
) -> Result<(), String> {
    let (pr_number, repo_path, default_worktree_root, reviewers, synthesizer, max_rounds) = {
        let database = db.lock();
        let review = database
            .pr_review_by_id(review_id)?
            .ok_or_else(|| "PR review not found".to_string())?;
        let repo = database
            .repo_by_id(review.repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        let synthesizer = database
            .agent_profile_by_id(review.reviewer_profile_id)?
            .ok_or_else(|| "Synthesizer profile not found".to_string())?;
        let mut reviewers = Vec::new();
        for participant in &review.reviewers {
            let profile = database
                .agent_profile_by_id(participant.reviewer_profile_id)?
                .ok_or_else(|| "Reviewer profile not found".to_string())?;
            reviewers.push(profile);
        }
        database.set_pr_review_status(review_id, PrReviewStatus::Reviewing, None)?;
        (
            review.pr_number,
            repo.path,
            repo.default_worktree_root,
            reviewers,
            synthesizer,
            review.max_rounds.unwrap_or(3).max(1),
        )
    };
    emit_consensus_update(app, db, review_id, None);

    let repo_path = PathBuf::from(&repo_path);

    // Backfill PR metadata so the list and detail show title/author/base.
    let meta = github::fetch_pull_request_meta(&repo_path, pr_number)?;
    db.lock().set_pr_review_meta(
        review_id,
        Some(&meta.title),
        meta.author.as_deref(),
        meta.base_branch.as_deref(),
    )?;
    emit_consensus_update(app, db, review_id, None);

    // All reviewers (every round) and the synthesizer share one read-only
    // worktree of the PR head; the shared scaffold owns its lifecycle.
    let outcome = with_pr_worktree(
        db,
        review_id,
        &repo_path,
        &default_worktree_root,
        pr_number,
        |worktree_path| {
            run_rounds_and_synthesize(
                app,
                db,
                review_id,
                worktree_path,
                pr_number,
                &reviewers,
                &synthesizer,
                max_rounds,
                &meta,
            )
        },
    );

    let (converged, verdict, review_output) = outcome?;
    db.lock()
        .set_pr_review_consensus(review_id, &review_output, verdict, converged)?;
    emit_consensus_update(app, db, review_id, None);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn run_rounds_and_synthesize(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    review_id: i64,
    worktree_path: &Path,
    pr_number: i64,
    reviewers: &[AgentProfile],
    synthesizer: &AgentProfile,
    max_rounds: i64,
    meta: &PrMeta,
) -> Result<(bool, PrReviewVerdict, String), String> {
    let mut last_round: Vec<ReviewerOutcome> = Vec::new();
    let mut converged = false;
    let mut agreed_verdict = PrReviewVerdict::Inconclusive;
    // reviewer_profile_id -> resolved session id (capture once, keep).
    let mut sessions: HashMap<i64, String> = HashMap::new();

    for round in 1..=max_rounds {
        // Round 1 is an independent review; later rounds share the previous
        // round's peer reviews and ask each reviewer to reconsider.
        let plans: Vec<(&AgentProfile, String, Option<String>)> = reviewers
            .iter()
            .map(|reviewer| {
                let prompt = if round == 1 {
                    build_pr_review_prompt(pr_number, meta)
                } else {
                    build_debate_prompt(pr_number, meta, round, reviewer.id, &last_round)
                };
                let resume_id = if reviewer_supports_resume(reviewer.agent_kind) {
                    sessions.get(&reviewer.id).cloned()
                } else {
                    None
                };
                (reviewer, prompt, resume_id)
            })
            .collect();

        let outputs = run_round_parallel(&plans, worktree_path);

        let mut round_outcomes = Vec::with_capacity(plans.len());
        for ((reviewer, _prompt, _resume), output) in plans.iter().zip(outputs) {
            let (verdict, review, error) = match output {
                Ok(run) => {
                    // Capture once, keep: store the resolved id the first time.
                    if let Some(session_id) = run.session_id {
                        sessions.entry(reviewer.id).or_insert(session_id);
                    }
                    let (verdict, review) = parse_pr_review_output(&run.text);
                    (verdict, review, None)
                }
                Err(error) => (PrReviewVerdict::Inconclusive, String::new(), Some(error)),
            };
            let run = db.lock().record_pr_review_run(PrReviewRunInput {
                pr_review_id: review_id,
                reviewer_profile_id: reviewer.id,
                round,
                verdict,
                output: review.clone(),
                error: error.clone(),
            })?;
            emit_consensus_update(app, db, review_id, Some(run));
            round_outcomes.push(ReviewerOutcome {
                reviewer_profile_id: reviewer.id,
                name: reviewer.name.clone(),
                verdict,
                review,
                error,
            });
        }
        db.lock().set_pr_review_progress(review_id, round)?;
        emit_consensus_update(app, db, review_id, None);

        last_round = round_outcomes;

        let verdicts: Vec<PrReviewVerdict> = last_round.iter().map(|o| o.verdict).collect();
        if let Some(verdict) = verdicts_converged(&verdicts) {
            converged = true;
            agreed_verdict = verdict;
            break;
        }
    }

    // Merge the final round into one consensus review the human can paste.
    let synth_prompt = build_synthesis_prompt(pr_number, meta, converged, &last_round);
    let synth_raw = run_reviewer_command(synthesizer, worktree_path, &synth_prompt, None, None)?.text;
    let (synth_verdict, synth_review) = parse_pr_review_output(&synth_raw);
    // When the reviewers agreed, that shared verdict is authoritative; otherwise
    // trust the synthesizer's read of the merged review.
    let final_verdict = if converged { agreed_verdict } else { synth_verdict };
    Ok((converged, final_verdict, synth_review))
}

/// Run every reviewer for one round concurrently on scoped threads, preserving
/// input order. `run_reviewer_command` blocks on a child process, so a thread
/// per reviewer is the right fit; a panicked thread becomes an error result.
fn run_round_parallel(
    plans: &[(&AgentProfile, String, Option<String>)],
    worktree_path: &Path,
) -> Vec<Result<ReviewerRunOutput, String>> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = plans
            .iter()
            .map(|(reviewer, prompt, resume)| {
                scope.spawn(move || {
                    run_reviewer_command(reviewer, worktree_path, prompt, resume.as_deref(), None)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err("Reviewer thread panicked".to_string()))
            })
            .collect()
    })
}

fn emit_consensus_update(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    review_id: i64,
    latest_run: Option<PrReviewRun>,
) {
    let Ok(Some(pr_review)) = db.lock().pr_review_by_id(review_id) else {
        return;
    };
    let _ = app.emit(
        "pr_review_updated",
        PrReviewUpdatedEvent {
            pr_review,
            latest_run,
        },
    );
}

/// The agreed verdict when every reviewer reported the same non-`Inconclusive`
/// verdict, otherwise `None`. An empty slice or any `Inconclusive` (which a
/// failed or marker-less review yields) never counts as consensus.
fn verdicts_converged(verdicts: &[PrReviewVerdict]) -> Option<PrReviewVerdict> {
    let first = *verdicts.first()?;
    if first == PrReviewVerdict::Inconclusive {
        return None;
    }
    verdicts.iter().all(|verdict| *verdict == first).then_some(first)
}

fn pr_context(pr_number: i64, meta: &PrMeta) -> String {
    let author = meta.author.as_deref().unwrap_or("unknown");
    let base = meta.base_branch.as_deref().unwrap_or("the base branch");
    format!(
        "GitHub pull request #{pr_number}\nPR title: {title}\nAuthor: {author}\nBase branch: {base}",
        title = meta.title,
    )
}

fn clip(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= MAX_PEER_REVIEW_CHARS {
        return trimmed.to_string();
    }
    let mut end = MAX_PEER_REVIEW_CHARS;
    while !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…[truncated]", &trimmed[..end])
}

/// Build a later-round prompt for `current_reviewer_id`: the PR context plus the
/// other reviewers' previous-round reviews, asking them to reconsider and
/// re-emit a verdict marker.
fn build_debate_prompt(
    pr_number: i64,
    meta: &PrMeta,
    round: i64,
    current_reviewer_id: i64,
    prior: &[ReviewerOutcome],
) -> String {
    let mut peers = String::new();
    for outcome in prior {
        if outcome.reviewer_profile_id == current_reviewer_id {
            continue;
        }
        let body = match &outcome.error {
            Some(error) => format!("(this reviewer failed to run: {error})"),
            None if outcome.review.trim().is_empty() => "(no review text)".to_string(),
            None => clip(&outcome.review),
        };
        peers.push_str(&format!(
            "\n--- {name} (verdict: {verdict}) ---\n{body}\n",
            name = outcome.name,
            verdict = outcome.verdict.as_str(),
        ));
    }

    format!(
        "\
You are one of several AI reviewers independently reviewing the same pull request, now in review round {round}.

{context}

You are in a checked-out worktree of the PR branch; re-inspect the actual changes with `git diff origin/{base}...HEAD` as needed.

Here are the other reviewers' reviews from the previous round:
{peers}
Reconsider your own review in light of theirs. Adopt points they got right that you missed, drop any of your own findings that they correctly refuted, and hold a position only when the actual code justifies it — explain briefly where you still disagree and why. The goal is to converge on a shared, correct conclusion without conceding real blocking issues.

Output your updated review in GitHub-flavored Markdown (summary, blocking issues with file paths, non-blocking suggestions, what's done well), then on the final line by itself the verdict: exactly `{marker} BLOCKERS` if any blocking issue remains, or `{marker} CLEAN` if there are none.",
        base = meta.base_branch.as_deref().unwrap_or("main"),
        context = pr_context(pr_number, meta),
        marker = PR_VERDICT_MARKER,
    )
}

/// Build the final synthesis prompt: merge the last round's reviews into one
/// consensus review, preserving every distinct blocking issue and flagging any
/// remaining disagreement when the reviewers did not converge.
fn build_synthesis_prompt(
    pr_number: i64,
    meta: &PrMeta,
    converged: bool,
    reviews: &[ReviewerOutcome],
) -> String {
    let mut sections = String::new();
    for outcome in reviews {
        let body = match &outcome.error {
            Some(error) => format!("(this reviewer failed to run: {error})"),
            None if outcome.review.trim().is_empty() => "(no review text)".to_string(),
            None => clip(&outcome.review),
        };
        sections.push_str(&format!(
            "\n--- {name} (verdict: {verdict}) ---\n{body}\n",
            name = outcome.name,
            verdict = outcome.verdict.as_str(),
        ));
    }

    let agreement = if converged {
        "The reviewers reached the same verdict."
    } else {
        "The reviewers did NOT reach the same verdict; surface the disagreement honestly rather than papering over it."
    };

    format!(
        "\
{count} AI reviewers reviewed the same pull request and iterated by sharing their reviews. {agreement}

{context}

You are in a checked-out worktree of the PR branch and may re-inspect the diff. Here are the reviewers' final reviews:
{sections}
Produce ONE consolidated review in GitHub-flavored Markdown that a human can paste into the pull request:
- A short summary of what the PR does and the overall consensus assessment.
- Blocking issues: include every distinct blocking issue any reviewer raised (deduplicated), each with its file path. Omit the section if there are none.
- Non-blocking suggestions worth keeping.
- Where the reviewers disagreed, a brief \"Points of disagreement\" section noting the split.

Do not invent issues beyond what the reviewers raised. On the final line by itself, output the verdict: exactly `{marker} BLOCKERS` if the consolidated review contains any blocking issue, or `{marker} CLEAN` if it does not.",
        count = reviews.len(),
        context = pr_context(pr_number, meta),
        marker = PR_VERDICT_MARKER,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> PrMeta {
        PrMeta {
            title: "Add request caching".to_string(),
            author: Some("octocat".to_string()),
            base_branch: Some("main".to_string()),
        }
    }

    fn outcome(id: i64, name: &str, verdict: PrReviewVerdict, review: &str) -> ReviewerOutcome {
        ReviewerOutcome {
            reviewer_profile_id: id,
            name: name.to_string(),
            verdict,
            review: review.to_string(),
            error: None,
        }
    }

    #[test]
    fn converges_only_when_all_verdicts_match_and_are_decisive() {
        assert_eq!(
            verdicts_converged(&[PrReviewVerdict::Passed, PrReviewVerdict::Passed]),
            Some(PrReviewVerdict::Passed)
        );
        assert_eq!(
            verdicts_converged(&[PrReviewVerdict::Blockers, PrReviewVerdict::Blockers]),
            Some(PrReviewVerdict::Blockers)
        );
        assert_eq!(
            verdicts_converged(&[PrReviewVerdict::Passed, PrReviewVerdict::Blockers]),
            None
        );
        // Inconclusive (a failed or marker-less review) is never agreement.
        assert_eq!(
            verdicts_converged(&[PrReviewVerdict::Inconclusive, PrReviewVerdict::Inconclusive]),
            None
        );
        assert_eq!(verdicts_converged(&[]), None);
    }

    #[test]
    fn debate_prompt_includes_other_reviewers_but_not_self() {
        let prior = vec![
            outcome(1, "Codex", PrReviewVerdict::Blockers, "Codex found a null deref."),
            outcome(2, "Claude", PrReviewVerdict::Passed, "Claude says it looks fine."),
        ];

        let prompt = build_debate_prompt(42, &meta(), 2, 1, &prior);

        assert!(prompt.contains("round 2"));
        // The current reviewer (id 1, Codex) sees Claude's review, not its own.
        assert!(prompt.contains("Claude"));
        assert!(prompt.contains("Claude says it looks fine."));
        assert!(!prompt.contains("Codex found a null deref."));
        assert!(prompt.contains("NECTUS_PR_VERDICT: BLOCKERS"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: CLEAN"));
    }

    #[test]
    fn synthesis_prompt_lists_all_reviews_and_flags_disagreement() {
        let reviews = vec![
            outcome(1, "Codex", PrReviewVerdict::Blockers, "Blocking: missing test."),
            outcome(2, "Claude", PrReviewVerdict::Passed, "No blockers found."),
        ];

        let converged = build_synthesis_prompt(7, &meta(), true, &reviews);
        assert!(converged.contains("reached the same verdict"));
        assert!(converged.contains("Blocking: missing test."));
        assert!(converged.contains("No blockers found."));
        assert!(converged.contains("NECTUS_PR_VERDICT: BLOCKERS"));

        let split = build_synthesis_prompt(7, &meta(), false, &reviews);
        assert!(split.contains("did NOT reach the same verdict"));
    }
}
