//! The PR-review verdict adapter: maps the shared `VerdictToken` to the PR-review
//! domain enum. Kept in a neutral module so the single (`pr_review.rs`) and
//! consensus (`pr_consensus.rs`) runtimes share it without depending on each other.

use super::verdict::VerdictToken;
use crate::models::PrReviewVerdict;

/// Map the shared verdict token to the PR-review domain enum. PR reviews do not use
/// `Feedback`; a missing or `Feedback` token is `Inconclusive`.
pub(super) fn pr_verdict_from_token(token: Option<VerdictToken>) -> PrReviewVerdict {
    match token {
        Some(VerdictToken::Clean) => PrReviewVerdict::Passed,
        Some(VerdictToken::Blockers) => PrReviewVerdict::Blockers,
        _ => PrReviewVerdict::Inconclusive,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_tokens_to_pr_verdicts() {
        assert_eq!(
            pr_verdict_from_token(Some(VerdictToken::Clean)),
            PrReviewVerdict::Passed
        );
        assert_eq!(
            pr_verdict_from_token(Some(VerdictToken::Blockers)),
            PrReviewVerdict::Blockers
        );
        assert_eq!(
            pr_verdict_from_token(Some(VerdictToken::Feedback)),
            PrReviewVerdict::Inconclusive
        );
        assert_eq!(pr_verdict_from_token(None), PrReviewVerdict::Inconclusive);
    }
}
