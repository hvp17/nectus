//! The PR-review verdict adapter: maps the shared `NECTUS_VERDICT` token contract
//! (see [`super::verdict`]) to the PR-review domain enum. Kept in a neutral module
//! so the single (`pr_review.rs`) and consensus (`pr_consensus.rs`) runtimes share
//! it without depending upward on each other.

use super::verdict::{parse_and_strip, VerdictToken};
use crate::models::PrReviewVerdict;

/// Re-export of the shared marker so the PR prompt builders interpolate the exact
/// token the parser expects.
pub(super) use super::verdict::VERDICT_MARKER;

/// Split a raw reviewer response into its verdict and the human-facing Markdown.
/// A missing or unrecognized marker — or a `FEEDBACK` token, which PR reviews do
/// not use — yields `Inconclusive`; the marker line is always stripped.
pub(super) fn parse_pr_review_output(raw: &str) -> (PrReviewVerdict, String) {
    let (token, text) = parse_and_strip(raw);
    let verdict = match token {
        Some(VerdictToken::Clean) => PrReviewVerdict::Passed,
        Some(VerdictToken::Blockers) => PrReviewVerdict::Blockers,
        _ => PrReviewVerdict::Inconclusive,
    };
    (verdict, text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_blockers_verdict_and_strips_marker() {
        let raw = "## Review\nBlocking: missing test.\n\nNECTUS_VERDICT: BLOCKERS";

        let (verdict, review) = parse_pr_review_output(raw);

        assert_eq!(verdict, PrReviewVerdict::Blockers);
        assert_eq!(review, "## Review\nBlocking: missing test.");
        assert!(!review.contains("NECTUS_VERDICT"));
    }

    #[test]
    fn parses_clean_verdict_as_passed() {
        let raw = "Looks solid.\nnectus_verdict: clean\n";

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
