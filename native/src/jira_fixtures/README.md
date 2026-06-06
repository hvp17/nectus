# JIRA `acli` golden fixtures

Real `acli ... --json` output, captured from a live Atlassian site and scrubbed
of PII, used by the parser tests in `native/src/jira.rs` (`include_str!`ed under
`#[cfg(test)]`).

These exist because the original `description` parse bug
(`invalid type: map, expected a string`) slipped through a unit test built from a
**hand-invented** payload (`"description":"details"`) — which encoded our wrong
assumption instead of reality. Fixtures must therefore come from running `acli`,
never typed by hand, so the tests assert against what JIRA Cloud actually emits.

## Files

| File | Captured from | Exercises |
| --- | --- | --- |
| `view_with_assignee.json` | `acli jira workitem view <KEY> --json` | ADF `description` object + `assignee` object (`displayName`) |
| `view_simple.json` | `acli jira workitem view <KEY> --json` | single-paragraph ADF `description`, `null` assignee |
| `search.json` | `acli jira workitem search --jql … --json` | board path: array of items, `description` absent, `priority` present |
| `project_list.json` | `acli jira project list --json` | `parse_projects` |

The key fact these pin down: JIRA Cloud's **v3** API returns rich-text fields
(notably `description`) as an **Atlassian Document Format object**, not a string,
while `search` omits `description` entirely. `native/src/jira.rs` must keep
accepting all of those shapes.

## Refreshing (after an `acli` / JIRA upgrade)

Re-capture, scrub, and write each fixture, then run the tests:

```bash
acli jira workitem view <KEY> --json     | python3 native/src/jira_fixtures/scrub.py > native/src/jira_fixtures/view_with_assignee.json
acli jira workitem view <KEY> --json     | python3 native/src/jira_fixtures/scrub.py > native/src/jira_fixtures/view_simple.json
acli jira workitem search --jql "project = <KEY> ORDER BY created DESC" --json --limit 3 \
                                         | python3 native/src/jira_fixtures/scrub.py > native/src/jira_fixtures/search.json
acli jira project list --json --limit 3  | python3 native/src/jira_fixtures/scrub.py > native/src/jira_fixtures/project_list.json

cd native && cargo test --lib jira::
```

`scrub.py` replaces account ids, display names, emails, host names, avatar
hashes, and initials with stable placeholders while preserving the field shape.
After refreshing, confirm no PII remains:

```bash
grep -REn "Tomas|Gadliauskas|@gmail|atlassian\.net|gravatar" native/src/jira_fixtures/*.json
```

(Only the generic, shared `avatar-management…atl-paas.net` CDN host inside the
URL-encoded avatar `d=` query may remain; it carries no personal data and the
parser ignores `avatarUrls`.)

> `acli jira workitem create --json` is intentionally **not** captured here:
> running it writes a real work item to the tracker. The create path only needs
> the new key, which `parse_created_key` recovers from JSON, a URL, or free text
> (covered by unit tests in `jira.rs`).
