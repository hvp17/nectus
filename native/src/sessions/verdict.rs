//! The single agent-verdict marker contract, shared by the task review loop
//! (`review_loop.rs`) and the PR-review runtimes (`pr_review.rs`,
//! `pr_consensus.rs`). A reviewer appends a `NECTUS_VERDICT: <TOKEN>` line; this
//! module parses the token back out and strips the marker from the human-facing
//! text. Each surface maps the shared token to its own domain enum. Output with
//! no marker is treated as "no verdict" — there is deliberately no
//! natural-language fallback heuristic (it produced false positives whenever a
//! review merely quoted a phrase like "blocking issue").

/// Marker a reviewer appends so its machine verdict can be read without parsing
/// prose. The marker line is removed from the human-facing review by
/// [`parse_and_strip`].
pub(super) const VERDICT_MARKER: &str = "NECTUS_VERDICT:";

/// A parsed verdict token, domain-agnostic. Each caller maps it to its own enum
/// (`PrReviewVerdict` for PR reviews — which never emit `Feedback` — and
/// `ReviewVerdict` for the task review loop).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VerdictToken {
    Clean,
    Blockers,
    Feedback,
}

/// Parse a single line into a verdict token when it carries the marker.
/// Case-insensitive; ignores surrounding whitespace. Returns `None` for a
/// non-marker line or a marker with an unrecognized value.
pub(super) fn parse_verdict_line(line: &str) -> Option<VerdictToken> {
    let upper = line.trim().to_ascii_uppercase();
    let value = upper.strip_prefix(VERDICT_MARKER)?;
    match value.trim() {
        "CLEAN" => Some(VerdictToken::Clean),
        "BLOCKERS" => Some(VerdictToken::Blockers),
        "FEEDBACK" => Some(VerdictToken::Feedback),
        _ => None,
    }
}

/// Split a raw reviewer response into its verdict token (the last recognized
/// marker line wins, so a trailing summary verdict overrides an earlier mention)
/// and the human-facing text with every marker line removed and trimmed. Returns
/// `(None, text)` when no recognized marker is present.
pub(super) fn parse_and_strip(raw: &str) -> (Option<VerdictToken>, String) {
    let mut token = None;
    let mut kept = Vec::new();
    for line in raw.lines() {
        if let Some(parsed) = parse_verdict_line(line) {
            token = Some(parsed);
            continue;
        }
        // Drop any marker line — even one with an unrecognized value — so the
        // marker never leaks into the human-facing output.
        if line.trim().to_ascii_uppercase().starts_with(VERDICT_MARKER) {
            continue;
        }
        kept.push(line);
    }
    (token, kept.join("\n").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_token_case_insensitively() {
        assert_eq!(
            parse_verdict_line("NECTUS_VERDICT: CLEAN"),
            Some(VerdictToken::Clean)
        );
        assert_eq!(
            parse_verdict_line("nectus_verdict: blockers"),
            Some(VerdictToken::Blockers)
        );
        assert_eq!(
            parse_verdict_line("  NECTUS_VERDICT:feedback  "),
            Some(VerdictToken::Feedback)
        );
    }

    #[test]
    fn non_marker_and_unknown_value_lines_are_none() {
        assert_eq!(parse_verdict_line("Looks good."), None);
        assert_eq!(parse_verdict_line("NECTUS_VERDICT: MAYBE"), None);
    }

    #[test]
    fn strips_marker_and_returns_last_token() {
        let raw = "## Review\nNECTUS_VERDICT: FEEDBACK\nmore text\nNECTUS_VERDICT: BLOCKERS";
        let (token, text) = parse_and_strip(raw);
        assert_eq!(token, Some(VerdictToken::Blockers));
        assert_eq!(text, "## Review\nmore text");
        assert!(!text.contains("NECTUS_VERDICT"));
    }

    #[test]
    fn drops_unrecognized_marker_line_but_keeps_prior_token() {
        let raw = "NECTUS_VERDICT: CLEAN\nbody\nNECTUS_VERDICT: GARBAGE";
        let (token, text) = parse_and_strip(raw);
        assert_eq!(token, Some(VerdictToken::Clean));
        assert_eq!(text, "body");
    }

    #[test]
    fn no_marker_yields_none_and_keeps_text() {
        let (token, text) = parse_and_strip("Just prose, no verdict here.");
        assert_eq!(token, None);
        assert_eq!(text, "Just prose, no verdict here.");
    }
}
