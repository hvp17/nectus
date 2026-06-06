//! The PR-review verdict contract shared by the single (`pr_review.rs`) and
//! consensus (`pr_consensus.rs`) runtimes: the marker reviewers append and the
//! parser that splits it back out. Kept in a neutral module so consensus doesn't
//! depend upward on the single-review module for this cross-cutting contract.

use crate::models::PrReviewVerdict;

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
}
