#!/usr/bin/env python3
"""Scrub PII from captured `acli ... --json` output so it can be committed as a
test fixture.

Reads JSON on stdin, writes scrubbed JSON on stdout. Account identifiers, display
names, emails, host names, avatar hashes, and user initials are replaced with
stable placeholders, while the field *shape* is preserved exactly — most
importantly `description` stays an Atlassian Document Format object, which is the
shape `native/src/jira.rs` must keep parsing. See `README.md` for the capture and
refresh procedure.
"""
import json
import re
import sys

# Any Atlassian / gravatar host becomes one placeholder host.
HOST_RE = re.compile(r"https://[a-z0-9.-]*(?:atl-paas\.net|atlassian\.net|gravatar\.com)")
# The 32-hex gravatar hash is derived from the user's email.
HEX32_RE = re.compile(r"\b[0-9a-f]{32}\b")
# User initials leak through avatar URLs (plain or URL-encoded `/initials/TG-0.png`).
INITIALS_RE = re.compile(r"(initials(?:/|%2[Ff]))[^/%.]+(\.png)")

# Values replaced wholesale by their JSON key name.
KEY_REPLACEMENTS = {
    "accountId": "5b10ac8d82e05b22cc7d4ef5",
    "displayName": "Test User",
    "uuid": "00000000-0000-0000-0000-000000000000",
}


def scrub_string(value):
    value = HOST_RE.sub("https://nectus-test.example", value)
    value = INITIALS_RE.sub(r"\1XX\2", value)
    value = HEX32_RE.sub("0" * 32, value)
    return value


def scrub(node, key=None):
    if isinstance(node, dict):
        return {k: scrub(v, k) for k, v in node.items()}
    if isinstance(node, list):
        return [scrub(v) for v in node]
    if isinstance(node, str):
        if key in KEY_REPLACEMENTS:
            return KEY_REPLACEMENTS[key]
        if key == "emailAddress":
            return "test@example.com"
        value = node
        if key == "self":
            # The account id is also embedded in the user `self` URL query.
            value = re.sub(
                r"accountId=[^&\"]+",
                "accountId=" + KEY_REPLACEMENTS["accountId"],
                value,
            )
        return scrub_string(value)
    return node


def main():
    data = json.load(sys.stdin)
    json.dump(scrub(data), sys.stdout, indent=2, sort_keys=True, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
