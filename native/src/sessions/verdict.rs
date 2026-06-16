//! The single agent-verdict marker contract, shared by the task review loop
//! (`review_loop.rs`) and the PR-review runtimes (`pr_review.rs`,
//! `pr_consensus.rs`). A reviewer appends a `NECTUS_VERDICT: <TOKEN>` line; this
//! module parses the token back out and strips the marker from the human-facing
//! text. Each surface maps the shared token to its own domain enum. Output with
//! no marker is treated as "no verdict" — there is deliberately no
//! natural-language fallback heuristic (it produced false positives whenever a
//! review merely quoted a phrase like "blocking issue").

use serde::Deserialize;

/// Marker a reviewer appends so its machine verdict can be read without parsing
/// prose. The marker line is removed from the human-facing review by
/// [`parse_and_strip`].
// legacy marker API, removed in a follow-up task
#[allow(dead_code)]
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
// legacy marker API, removed in a follow-up task
#[allow(dead_code)]
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

#[derive(Deserialize)]
struct VerdictBlock {
    verdict: String,
}

/// Map a verdict string (case-insensitive) to its token, or `None` if unrecognized.
fn token_from_str(value: &str) -> Option<VerdictToken> {
    match value.trim().to_ascii_lowercase().as_str() {
        "clean" => Some(VerdictToken::Clean),
        "blockers" => Some(VerdictToken::Blockers),
        "feedback" => Some(VerdictToken::Feedback),
        _ => None,
    }
}

/// Extract the machine verdict from a reviewer's response. The reviewer ends its
/// message with a fenced ```json block carrying `{"verdict": "clean|blockers|feedback"}`.
/// The LAST block that parses to a recognized verdict wins; every recognized verdict
/// block is stripped from the returned human-facing text. A non-verdict json block
/// (or prose) is left intact. Returns `(None, trimmed_text)` when no verdict block is
/// present — there is deliberately no prose fallback. An unclosed ```json fence is
/// left intact and yields no verdict (fail-open). A line closes the block only when
/// it is exactly ` ``` ` after trimming, so a non-bare close like ` ```text ` does not
/// terminate it. CRLF input is normalized to `\n` (via `lines()`/`join`).
pub(super) fn parse_verdict_block(raw: &str) -> (Option<VerdictToken>, String) {
    let lines: Vec<&str> = raw.lines().collect();
    let mut token: Option<VerdictToken> = None;
    let mut drop_ranges: Vec<(usize, usize)> = Vec::new(); // inclusive (open_fence, close_fence)
    let mut i = 0;
    while i < lines.len() {
        let fence = lines[i].trim();
        let is_json_open = fence.starts_with("```")
            && fence.trim_start_matches('`').trim().eq_ignore_ascii_case("json");
        if is_json_open {
            let mut j = i + 1;
            while j < lines.len() && lines[j].trim() != "```" {
                j += 1;
            }
            if j < lines.len() {
                let body = lines[i + 1..j].join("\n");
                if let Ok(parsed) = serde_json::from_str::<VerdictBlock>(&body) {
                    if let Some(tok) = token_from_str(&parsed.verdict) {
                        token = Some(tok); // last valid wins
                        drop_ranges.push((i, j));
                    }
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    let kept: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(idx, _)| !drop_ranges.iter().any(|(a, b)| idx >= a && idx <= b))
        .map(|(_, l)| *l)
        .collect();
    (token, kept.join("\n").trim().to_string())
}

/// Split a raw reviewer response into its verdict token (the last recognized
/// marker line wins, so a trailing summary verdict overrides an earlier mention)
/// and the human-facing text with every marker line removed and trimmed. Returns
/// `(None, text)` when no recognized marker is present.
// legacy marker API, removed in a follow-up task
#[allow(dead_code)]
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

    #[test]
    fn extracts_verdict_from_trailing_json_block() {
        let raw = "## Review\nLooks risky.\n\n```json\n{\"verdict\": \"blockers\"}\n```";
        let (token, text) = parse_verdict_block(raw);
        assert_eq!(token, Some(VerdictToken::Blockers));
        assert_eq!(text, "## Review\nLooks risky.");
        assert!(!text.contains("```"));
    }

    #[test]
    fn verdict_token_is_case_insensitive() {
        let (token, _) = parse_verdict_block("ok\n```json\n{\"verdict\": \"CLEAN\"}\n```");
        assert_eq!(token, Some(VerdictToken::Clean));
    }

    #[test]
    fn last_valid_json_block_wins() {
        let raw =
            "```json\n{\"verdict\": \"feedback\"}\n```\nmore\n```json\n{\"verdict\": \"blockers\"}\n```";
        let (token, text) = parse_verdict_block(raw);
        assert_eq!(token, Some(VerdictToken::Blockers));
        assert_eq!(text, "more");
    }

    #[test]
    fn malformed_or_missing_block_yields_none_and_keeps_text() {
        assert_eq!(parse_verdict_block("Just prose.").0, None);
        assert_eq!(parse_verdict_block("```json\n{\"verdict\": \"maybe\"}\n```").0, None);
        assert_eq!(parse_verdict_block("```json\nnot json\n```").0, None);
        let (token, text) = parse_verdict_block("```json\n{\"other\": 1}\n```");
        assert_eq!(token, None);
        assert!(text.contains("other"));
    }

    #[test]
    fn unclosed_fence_yields_none_and_keeps_text() {
        // A truncated message whose verdict fence never closes must fail open.
        let (token, text) = parse_verdict_block("prose\n```json\n{\"verdict\": \"clean\"}");
        assert_eq!(token, None);
        assert!(text.contains("prose"));
    }

    #[test]
    fn keeps_non_verdict_block_between_two_verdict_blocks() {
        let raw = "```json\n{\"verdict\": \"feedback\"}\n```\n\
                   text\n\
                   ```json\n{\"other\": 1}\n```\n\
                   ```json\n{\"verdict\": \"blockers\"}\n```";
        let (token, text) = parse_verdict_block(raw);
        assert_eq!(token, Some(VerdictToken::Blockers));
        // The non-verdict block survives; both verdict blocks are stripped.
        assert!(text.contains("other"));
        assert!(text.contains("text"));
        assert!(!text.contains("verdict"));
    }

    #[test]
    fn normalizes_crlf_input() {
        let (token, text) = parse_verdict_block("ok\r\n```json\r\n{\"verdict\": \"clean\"}\r\n```");
        assert_eq!(token, Some(VerdictToken::Clean));
        assert_eq!(text, "ok");
    }
}
