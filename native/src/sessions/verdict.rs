//! Shared verdict contract for the ACP reviewer surfaces. A reviewer ends its
//! response with a fenced ` ```json ` block carrying
//! `{"verdict": "clean|blockers|feedback"}`; `parse_verdict_block` extracts the
//! last recognized block, strips it from the returned human-facing text, and
//! returns the corresponding `VerdictToken`. Output with no such block yields
//! `(None, text)` — there is deliberately no natural-language fallback (prose
//! heuristics produced false positives). Each surface maps `VerdictToken` to its
//! own domain enum: `ReviewVerdict` for the task loop (via
//! `review_loop::verdict_from_token`) and `PrReviewVerdict` for PR reviews (via
//! `pr_verdict::pr_verdict_from_token`). The expected trailing block looks like:
//!
//! ````text
//! ```json
//! {"verdict": "clean"}
//! ```
//! ````

use serde::Deserialize;

/// A parsed verdict token, domain-agnostic. Each caller maps it to its own enum
/// (`PrReviewVerdict` for PR reviews — whose mapping never yields `Feedback` — and
/// `ReviewVerdict` for the task review loop).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum VerdictToken {
    Clean,
    Blockers,
    Feedback,
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

#[cfg(test)]
mod tests {
    use super::*;

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
