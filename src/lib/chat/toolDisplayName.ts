/** Strip verbose MCP / ACP tool identifiers down to a short human label. */
export function formatToolDisplayName(title: string, kind?: string | null): string {
  const raw = title.trim();
  if (!raw) {
    return kind?.trim() || "Tool";
  }

  let name = raw;

  // `mcp__claude_ai_Interactive_Brokers_IBKR__get_account_summary` → `get_account_summary`
  if (name.includes("__")) {
    const suffix = name.split("__").pop()?.trim();
    if (suffix && suffix.length < name.length) {
      name = suffix;
    }
  }

  if (name.startsWith("mcp_")) {
    name = name.slice(4);
  }

  // Short curated titles from agents pass through unchanged.
  if (!name.includes("_") && name.length <= 48) {
    return name;
  }

  name = humanizeSnakeCase(name);

  if (name.length > 56) {
    return `${name.slice(0, 53)}…`;
  }

  return name;
}

function humanizeSnakeCase(value: string): string {
  if (!value.includes("_")) {
    return value;
  }
  const words = value.split("_").filter(Boolean).map((word) => word.toLowerCase());
  if (words.length === 0) {
    return value;
  }
  words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1);
  return words.join(" ");
}
