use super::review_loop::run_reviewer_command;
use crate::db::Database;
use crate::github::{self, PrMeta};
use crate::git_ops;
use crate::models::{
    AgentProfile, PrReviewConsensus, PrReviewRound, PrReviewStatus, PrReviewUpdatedEvent,
    PrReviewVerdict,
};
use parking_lot::Mutex;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Run a queued PR review on a background thread: fetch metadata, check out the
/// PR head into an ephemeral worktree, run the reviewer headless, store the
/// Markdown review, and always tear the worktree down.
pub(super) fn spawn_pr_review(app: AppHandle, db: Arc<Mutex<Database>>, review_id: i64) {
    std::thread::spawn(move || {
        if let Err(error) = run_pr_review(&app, &db, review_id) {
            tracing::warn!(?error, review_id, "pr review failed");
            let _ = db
                .lock()
                .set_pr_review_status(review_id, PrReviewStatus::Error, Some(&error));
            emit_pr_review_update(&app, &db, review_id);
        }
    });
}

fn run_pr_review(app: &AppHandle, db: &Arc<Mutex<Database>>, review_id: i64) -> Result<(), String> {
    let (pr_number, repo_path, default_worktree_root, reviewer_profile_id, consensus_config) = {
        let database = db.lock();
        let review = database
            .pr_review_by_id(review_id)?
            .ok_or_else(|| "PR review not found".to_string())?;
        let repo = database
            .repo_by_id(review.repo_id)?
            .ok_or_else(|| "Repository not found".to_string())?;
        let consensus_config = database.pr_review_consensus_config(review_id)?;
        database.set_pr_review_status(review_id, PrReviewStatus::Reviewing, None)?;
        (
            review.pr_number,
            repo.path,
            repo.default_worktree_root,
            review.reviewer_profile_id,
            consensus_config,
        )
    };
    emit_pr_review_update(app, db, review_id);

    let repo_path = PathBuf::from(&repo_path);

    // Backfill PR metadata so the list and detail show title/author/base.
    let meta = github::fetch_pull_request_meta(&repo_path, pr_number)?;
    db.lock().set_pr_review_meta(
        review_id,
        Some(&meta.title),
        meta.author.as_deref(),
        meta.base_branch.as_deref(),
    )?;
    emit_pr_review_update(app, db, review_id);

    let branch_name = format!("nectus-pr-review-{pr_number}");
    let worktree_path = PathBuf::from(&default_worktree_root).join(&branch_name);
    // Clear any worktree left by a previous run before re-adding.
    let _ = git_ops::remove_worktree(&repo_path, &worktree_path);

    // Review inside the worktree, single or consensus, capturing the final review
    // text, verdict, and (for consensus) the convergence matrix.
    let outcome = (|| -> Result<(String, PrReviewVerdict, Option<PrReviewConsensus>), String> {
        setup_worktree(db, review_id, &repo_path, &worktree_path, &branch_name, pr_number)?;
        match consensus_config {
            Some((reviewer_ids, rounds)) => {
                let reviewers = resolve_reviewers(db, &reviewer_ids)?;
                let (output, verdict, consensus) = run_consensus_review(
                    app,
                    db,
                    review_id,
                    &worktree_path,
                    &reviewers,
                    pr_number,
                    &meta,
                    rounds,
                )?;
                Ok((output, verdict, Some(consensus)))
            }
            None => {
                let reviewer = db
                    .lock()
                    .agent_profile_by_id(reviewer_profile_id)?
                    .ok_or_else(|| "Reviewer profile not found".to_string())?;
                let prompt = build_pr_review_prompt(pr_number, &meta);
                let raw = run_reviewer_command(&reviewer, &worktree_path, &prompt)?;
                let (verdict, output) = parse_pr_review_output(&raw);
                Ok((output, verdict, None))
            }
        }
    })();

    // Always tear the worktree down, whether or not the review succeeded.
    let _ = git_ops::remove_worktree(&repo_path, &worktree_path);
    let _ = db.lock().set_pr_review_worktree(review_id, None);

    let (review_output, verdict, consensus) = outcome?;
    if let Some(consensus) = consensus {
        db.lock().set_pr_review_consensus(review_id, &consensus)?;
    }
    db.lock()
        .set_pr_review_result(review_id, &review_output, verdict)?;
    emit_pr_review_update(app, db, review_id);
    Ok(())
}

/// Fetch the PR head into an ephemeral worktree and record its path.
fn setup_worktree(
    db: &Arc<Mutex<Database>>,
    review_id: i64,
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    pr_number: i64,
) -> Result<(), String> {
    git_ops::fetch_pull_request_ref(repo_path, pr_number, branch_name)?;
    git_ops::create_worktree_at_ref(repo_path, worktree_path, branch_name)?;
    db.lock()
        .set_pr_review_worktree(review_id, Some(&worktree_path.to_string_lossy()))?;
    Ok(())
}

fn resolve_reviewers(
    db: &Arc<Mutex<Database>>,
    reviewer_ids: &[i64],
) -> Result<Vec<AgentProfile>, String> {
    let database = db.lock();
    reviewer_ids
        .iter()
        .map(|id| {
            database
                .agent_profile_by_id(*id)?
                .ok_or_else(|| "Reviewer profile not found".to_string())
        })
        .collect()
}

/// Run a multi-model consensus review: every reviewer reads the PR each round,
/// seeing the other reviewers' prior notes from round 2 on, until they all agree
/// or the round budget runs out. The partial matrix is persisted and emitted each
/// round so the UI fills in live, then the synthesizer writes the consolidated
/// review. Returns the synthesized review text, the consensus verdict, and the
/// finished convergence matrix.
#[allow(clippy::too_many_arguments)]
fn run_consensus_review(
    app: &AppHandle,
    db: &Arc<Mutex<Database>>,
    review_id: i64,
    worktree_path: &Path,
    reviewers: &[AgentProfile],
    pr_number: i64,
    meta: &PrMeta,
    max_rounds: i64,
) -> Result<(String, PrReviewVerdict, PrReviewConsensus), String> {
    let mut consensus = db
        .lock()
        .pr_review_by_id(review_id)?
        .and_then(|review| review.consensus)
        .ok_or_else(|| "Consensus review is missing its reviewer roster".to_string())?;
    consensus.rounds.clear();
    consensus.converged = false;
    consensus.converged_in_rounds = None;

    let base_prompt = build_pr_review_prompt(pr_number, meta);
    let mut latest: HashMap<i64, (PrReviewVerdict, String)> = HashMap::new();
    let mut converged_round: Option<i64> = None;

    for round in 1..=max_rounds.max(1) {
        let mut verdicts: BTreeMap<String, PrReviewVerdict> = BTreeMap::new();
        for reviewer in reviewers {
            let prompt = if round == 1 {
                base_prompt.clone()
            } else {
                let others: Vec<(&str, &str)> = reviewers
                    .iter()
                    .filter(|other| other.id != reviewer.id)
                    .filter_map(|other| {
                        latest
                            .get(&other.id)
                            .map(|(_, text)| (other.name.as_str(), text.as_str()))
                    })
                    .collect();
                consensus_round_prompt(&base_prompt, &others)
            };
            let (verdict, text) = match run_reviewer_command(reviewer, worktree_path, &prompt) {
                Ok(raw) => parse_pr_review_output(&raw),
                Err(error) => {
                    tracing::warn!(?error, reviewer = %reviewer.name, "consensus reviewer failed");
                    (
                        PrReviewVerdict::Inconclusive,
                        format!("_{} could not complete its review: {error}_", reviewer.name),
                    )
                }
            };
            verdicts.insert(reviewer.id.to_string(), verdict);
            latest.insert(reviewer.id, (verdict, text));
        }
        consensus.rounds.push(PrReviewRound { round, verdicts });
        // Persist + emit the partial matrix so the UI fills in round by round.
        let _ = db.lock().set_pr_review_consensus(review_id, &consensus);
        emit_pr_review_update(app, db, review_id);

        let current: Vec<PrReviewVerdict> = reviewers
            .iter()
            .filter_map(|reviewer| latest.get(&reviewer.id).map(|(verdict, _)| *verdict))
            .collect();
        if all_agree(&current) {
            converged_round = Some(round);
            break;
        }
    }

    let final_verdicts: Vec<PrReviewVerdict> = reviewers
        .iter()
        .filter_map(|reviewer| latest.get(&reviewer.id).map(|(verdict, _)| *verdict))
        .collect();
    let agreed_verdict = consensus_verdict(&final_verdicts);
    consensus.converged = converged_round.is_some();
    consensus.converged_in_rounds = converged_round;

    // The synthesizer (first reviewer) folds every latest review into one.
    let synthesizer = reviewers
        .first()
        .ok_or_else(|| "Consensus review needs at least one reviewer".to_string())?;
    let reviews: Vec<(&str, &str)> = reviewers
        .iter()
        .filter_map(|reviewer| {
            latest
                .get(&reviewer.id)
                .map(|(_, text)| (reviewer.name.as_str(), text.as_str()))
        })
        .collect();
    let synthesis_prompt = consensus_synthesis_prompt(
        pr_number,
        meta,
        &reviews,
        agreed_verdict,
        consensus.converged,
        converged_round.unwrap_or(max_rounds.max(1)),
    );
    let raw = run_reviewer_command(synthesizer, worktree_path, &synthesis_prompt)?;
    let (parsed_verdict, output) = parse_pr_review_output(&raw);
    // Trust the synthesizer's marker when it parsed; otherwise fall back to the
    // computed majority so the verdict is never silently inconclusive.
    let verdict = if parsed_verdict == PrReviewVerdict::Inconclusive {
        agreed_verdict
    } else {
        parsed_verdict
    };

    Ok((output, verdict, consensus))
}

/// True when every reviewer landed on the same recognizable verdict.
fn all_agree(verdicts: &[PrReviewVerdict]) -> bool {
    match verdicts.split_first() {
        Some((first, rest)) => {
            *first != PrReviewVerdict::Inconclusive && rest.iter().all(|verdict| verdict == first)
        }
        None => false,
    }
}

/// The consensus verdict from the reviewers' latest positions: majority wins,
/// blockers win ties (the conservative choice), inconclusive only if no reviewer
/// reached a verdict.
fn consensus_verdict(verdicts: &[PrReviewVerdict]) -> PrReviewVerdict {
    let blockers = verdicts
        .iter()
        .filter(|verdict| **verdict == PrReviewVerdict::Blockers)
        .count();
    let passed = verdicts
        .iter()
        .filter(|verdict| **verdict == PrReviewVerdict::Passed)
        .count();
    if blockers == 0 && passed == 0 {
        PrReviewVerdict::Inconclusive
    } else if blockers >= passed {
        PrReviewVerdict::Blockers
    } else {
        PrReviewVerdict::Passed
    }
}

/// Augment the base review prompt with the other reviewers' prior-round notes so
/// each reviewer can reconsider against them before giving its verdict.
fn consensus_round_prompt(base: &str, others: &[(&str, &str)]) -> String {
    if others.is_empty() {
        return base.to_string();
    }
    let mut prompt = String::from(base);
    prompt.push_str(
        "\n\n---\nThis is a multi-model consensus review. The other reviewers gave the \
following assessments in the previous round. Read them, reconsider the PR, and give your own \
independent verdict — agree only if you genuinely concur, and keep the same verdict marker format.\n",
    );
    for (name, review) in others {
        prompt.push_str(&format!("\n## {name}'s review\n{review}\n"));
    }
    prompt
}

/// Prompt the synthesizer to fold every reviewer's latest review into one
/// consolidated review reflecting the consensus verdict.
fn consensus_synthesis_prompt(
    pr_number: i64,
    meta: &PrMeta,
    reviews: &[(&str, &str)],
    verdict: PrReviewVerdict,
    converged: bool,
    rounds: i64,
) -> String {
    let verdict_word = match verdict {
        PrReviewVerdict::Passed => "no blocking issues (CLEAN)",
        PrReviewVerdict::Blockers => "blocking issues (BLOCKERS)",
        PrReviewVerdict::Inconclusive => "no clear majority",
    };
    let convergence = if converged {
        format!("The reviewers converged after {rounds} round(s).")
    } else {
        "The reviewers did not fully converge; synthesize the majority position and note the disagreement."
            .to_string()
    };
    let mut prompt = format!(
        "You are synthesizing a multi-model consensus code review of GitHub pull request #{pr_number} ({title}). {convergence} The consensus verdict is {verdict_word}.\n\nHere are the individual reviews:\n",
        title = meta.title,
    );
    for (name, review) in reviews {
        prompt.push_str(&format!("\n## {name}\n{review}\n"));
    }
    prompt.push_str(&format!(
        "\nWrite a single consolidated review in GitHub-flavored Markdown that the human can paste into the pull request. Merge overlapping points, call out where reviewers disagreed, and lead with the consensus verdict. Output only the Markdown review, with no preamble.\n\nOn the final line by itself, output exactly `{marker} BLOCKERS` if the consensus has blocking issues, or `{marker} CLEAN` if there are none.",
        marker = PR_VERDICT_MARKER,
    ));
    prompt
}

fn emit_pr_review_update(app: &AppHandle, db: &Arc<Mutex<Database>>, review_id: i64) {
    let Ok(Some(pr_review)) = db.lock().pr_review_by_id(review_id) else {
        return;
    };
    let _ = app.emit(
        "pr_review_updated",
        PrReviewUpdatedEvent {
            pr_review,
            latest_run: None,
        },
    );
}

pub(super) fn build_pr_review_prompt(pr_number: i64, meta: &PrMeta) -> String {
    let author = meta.author.as_deref().unwrap_or("unknown");
    let base = meta.base_branch.as_deref().unwrap_or("the base branch");
    format!(
        "\
You are reviewing GitHub pull request #{pr_number} for a human reviewer who will paste your review back to the author.

PR title: {title}
Author: {author}
Base branch: {base}

You are in a checked-out worktree of the PR branch. Inspect the actual changes yourself before reviewing. If the base ref is missing locally, run `git fetch origin {base}` first, then start from:
- git log --oneline origin/{base}..HEAD
- git diff origin/{base}...HEAD

Write a clear, specific code review in GitHub-flavored Markdown that the reviewer can paste directly into the pull request. Structure it as:
- A one or two sentence summary of what the PR does and your overall assessment.
- Blocking issues: correctness, regressions, security, or missing tests, each with the file path and a concrete fix. Omit this section if there are none.
- Non-blocking suggestions and nits, clearly marked as optional.
- Anything done well that is worth keeping.

Reference real files and lines. Do not invent issues; if the PR looks solid, say so plainly. Output only the Markdown review, with no preamble before it.

After the review, on the final line by itself, output a machine-readable verdict: exactly `{marker} BLOCKERS` if you listed any blocking issues, or `{marker} CLEAN` if there were none. This line is stripped from the review before it is shown.",
        pr_number = pr_number,
        title = meta.title,
        author = author,
        base = base,
        marker = PR_VERDICT_MARKER,
    )
}

/// Marker the reviewer appends so the review's outcome can be tracked without
/// parsing prose. Kept out of the human-facing review by [`parse_pr_review_output`].
pub(super) const PR_VERDICT_MARKER: &str = "NECTUS_PR_VERDICT:";

/// Split a raw reviewer response into its verdict and the human-facing Markdown.
/// The reviewer appends a `NECTUS_PR_VERDICT:` line; it is parsed into a verdict
/// and removed from the returned review. A missing or unrecognized marker yields
/// `Inconclusive` and leaves the text otherwise untouched.
pub(super) fn parse_pr_review_output(raw: &str) -> (PrReviewVerdict, String) {
    let mut verdict = PrReviewVerdict::Inconclusive;
    let mut kept = Vec::new();
    for line in raw.lines() {
        if let Some(value) = line.trim().to_ascii_uppercase().strip_prefix(PR_VERDICT_MARKER) {
            match value.trim() {
                "BLOCKERS" => verdict = PrReviewVerdict::Blockers,
                "CLEAN" => verdict = PrReviewVerdict::Passed,
                _ => {}
            }
            // Drop the marker line from the human-facing review regardless of
            // whether its value parsed, so it never leaks into the output.
            continue;
        }
        kept.push(line);
    }
    (verdict, kept.join("\n").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_review_prompt_includes_details_and_requests_verdict_marker() {
        let meta = PrMeta {
            title: "Add request caching".to_string(),
            author: Some("octocat".to_string()),
            base_branch: Some("main".to_string()),
        };

        let prompt = build_pr_review_prompt(42, &meta);

        assert!(prompt.contains("#42"));
        assert!(prompt.contains("Add request caching"));
        assert!(prompt.contains("octocat"));
        assert!(prompt.contains("origin/main...HEAD"));
        assert!(prompt.to_lowercase().contains("markdown"));
        // The reviewer is asked to append a machine-readable verdict marker so
        // the Done state can distinguish passed from blocking.
        assert!(prompt.contains("NECTUS_PR_VERDICT: BLOCKERS"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: CLEAN"));
    }

    #[test]
    fn parses_blockers_verdict_and_strips_marker() {
        let raw = "## Review\nBlocking: missing test.\n\nNECTUS_PR_VERDICT: BLOCKERS";

        let (verdict, review) = parse_pr_review_output(raw);

        assert_eq!(verdict, PrReviewVerdict::Blockers);
        assert_eq!(review, "## Review\nBlocking: missing test.");
        assert!(!review.contains("NECTUS_PR_VERDICT"));
    }

    #[test]
    fn parses_clean_verdict_as_passed() {
        let raw = "Looks solid.\nnectus_pr_verdict: clean\n";

        let (verdict, review) = parse_pr_review_output(raw);

        assert_eq!(verdict, PrReviewVerdict::Passed);
        assert_eq!(review, "Looks solid.");
    }

    #[test]
    fn missing_marker_is_inconclusive_and_keeps_output() {
        let raw = "## Review\nNo verdict line here.";

        let (verdict, review) = parse_pr_review_output(raw);

        assert_eq!(verdict, PrReviewVerdict::Inconclusive);
        assert_eq!(review, "## Review\nNo verdict line here.");
    }

    #[test]
    fn pr_review_prompt_tolerates_missing_author_and_base() {
        let meta = PrMeta {
            title: "Tidy up".to_string(),
            author: None,
            base_branch: None,
        };

        let prompt = build_pr_review_prompt(7, &meta);

        assert!(prompt.contains("#7"));
        assert!(prompt.contains("Tidy up"));
        assert!(prompt.contains("unknown"));
    }

    #[test]
    fn all_agree_requires_a_shared_recognizable_verdict() {
        use PrReviewVerdict::*;
        assert!(all_agree(&[Passed, Passed]));
        assert!(all_agree(&[Blockers, Blockers, Blockers]));
        assert!(!all_agree(&[Passed, Blockers]));
        // Inconclusive is the absence of a verdict, so it never counts as agreement.
        assert!(!all_agree(&[Inconclusive, Inconclusive]));
        assert!(!all_agree(&[]));
    }

    #[test]
    fn consensus_verdict_takes_the_majority_with_blockers_winning_ties() {
        use PrReviewVerdict::*;
        assert_eq!(consensus_verdict(&[Passed, Passed, Blockers]), Passed);
        assert_eq!(consensus_verdict(&[Blockers, Blockers, Passed]), Blockers);
        // A tie resolves to the conservative blocking verdict.
        assert_eq!(consensus_verdict(&[Passed, Blockers]), Blockers);
        // No reviewer reached a verdict.
        assert_eq!(consensus_verdict(&[Inconclusive, Inconclusive]), Inconclusive);
    }

    #[test]
    fn consensus_round_prompt_appends_other_reviewers_notes() {
        let base = "Base review instructions.";
        let prompt = consensus_round_prompt(&base, &[("Codex", "Found a null deref."), ("Gemini", "Looks fine.")]);
        assert!(prompt.starts_with(base));
        assert!(prompt.contains("multi-model consensus"));
        assert!(prompt.contains("Codex's review"));
        assert!(prompt.contains("Found a null deref."));
        assert!(prompt.contains("Gemini's review"));
        // With no other reviewers the base prompt is returned unchanged (round 1).
        assert_eq!(consensus_round_prompt(&base, &[]), base);
    }

    #[test]
    fn consensus_synthesis_prompt_states_verdict_and_requests_marker() {
        let meta = PrMeta {
            title: "Migrate session store".to_string(),
            author: Some("hvp17".to_string()),
            base_branch: Some("main".to_string()),
        };
        let prompt = consensus_synthesis_prompt(
            408,
            &meta,
            &[("Claude", "Blocking: writer starvation."), ("Codex", "Agree, busy_timeout dropped.")],
            PrReviewVerdict::Blockers,
            true,
            2,
        );
        assert!(prompt.contains("#408"));
        assert!(prompt.contains("Migrate session store"));
        assert!(prompt.contains("blocking issues (BLOCKERS)"));
        assert!(prompt.contains("converged after 2 round"));
        assert!(prompt.contains("writer starvation"));
        assert!(prompt.contains("NECTUS_PR_VERDICT: BLOCKERS"));
    }
}
