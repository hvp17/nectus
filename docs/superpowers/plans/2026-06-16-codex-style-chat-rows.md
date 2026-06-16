# Codex-style Chat Tool Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the ACP chat transcript's tool rows to the Codex look — quiet resting rows, consecutive read/search calls collapsed into one summary row, a command block with a success/failure badge, and edit rows with inline `+N −M` stats.

**Architecture:** Grouping is a pure presentation-time transform over a message's `parts[]` (`groupToolParts`); no Rust/ACP/cache changes. The generic AI-elements `ToolHeader` gains `glyph` / `trailing` / `hideStatusBadge` slots plus a quiet resting style; `renderChatParts` dispatches each tool `kind` (execute / read|search|fetch / edit) to its presentation and renders grouped runs.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, Tailwind utilities over `styles.css` OKLCH tokens, lucide-react icons, shadcn `Collapsible`.

**Spec:** `docs/superpowers/specs/2026-06-16-codex-style-chat-rows-design.md`
**Mockup:** `design-mockups/codex-chat-rows.html`

**Key data facts (verified):**
- Frontend `ChatPart` tool `kind` values (from `native/src/sessions/acp.rs:463-476`): `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, or `null`.
- `file_edit` part shape (`src/types.ts:419`): `{ type: "file_edit"; path: string; additions: number; deletions: number; diff?: string | null }`. `diff` is the **new text only** (no `old_text`) — render as a code block, not a red/green diff.
- Tool part shape (`src/types.ts:409-418`): `{ type: "tool"; toolCallId; title; kind?; status: ChatToolStatus; locations: ChatLocation[]; rawInput?: unknown; output?: string | null }`. `ChatToolStatus = "pending" | "running" | "completed" | "failed"`.

---

## File Structure

- **Create** `src/lib/chat/groupToolParts.ts` — pure transform: `ChatPart[]` → `RenderItem[]`, folding adjacent read/search/fetch tool parts into one group. Plus the group summary/status helpers.
- **Create** `src/lib/chat/groupToolParts.test.ts` — unit tests for the transform.
- **Create** `src/lib/chat/toolGlyph.tsx` — pure presentation helpers: `toolGlyph(kind, status)`, `commandText(rawInput)`, `CommandStatusBadge`, `groupTrailingPill`.
- **Create** `src/lib/chat/toolGlyph.test.tsx` — unit tests for `commandText` + glyph selection.
- **Modify** `src/components/ai-elements/tool.tsx` — add `glyph`, `trailing`, `hideStatusBadge` props to `ToolHeader`; quiet resting style on `Tool`.
- **Modify** `src/lib/chat/renderChatParts.tsx` — dispatch tool `kind`; render `tool-group`; richer `file_edit` row; consume `groupToolParts` in `ChatMessageRow`.
- **Modify** `src/lib/chat/renderChatParts.test.tsx` — add tests for command/edit/group rendering and the no-group-for-single rule.

---

## Task 1: Grouping transform

**Files:**
- Create: `src/lib/chat/groupToolParts.ts`
- Test: `src/lib/chat/groupToolParts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/chat/groupToolParts.test.ts
import { describe, it, expect } from "vitest";
import { groupToolParts, groupToolSummary, groupToolStatus } from "./groupToolParts";
import type { ChatPart } from "@/types";

const tool = (over: Partial<Extract<ChatPart, { type: "tool" }>>): ChatPart => ({
  type: "tool",
  toolCallId: over.toolCallId ?? "t",
  title: over.title ?? "Read file",
  kind: over.kind ?? "read",
  status: over.status ?? "completed",
  locations: over.locations ?? [],
  rawInput: over.rawInput,
  output: over.output ?? null,
});
const text = (t: string): ChatPart => ({ type: "text", text: t });

describe("groupToolParts", () => {
  it("returns singles unchanged when nothing is groupable", () => {
    const parts = [text("hi"), tool({ kind: "execute", title: "Ran ls" })];
    const items = groupToolParts(parts);
    expect(items.map((i) => i.kind)).toEqual(["single", "single"]);
  });

  it("groups a run of >= 2 adjacent read/search/fetch parts", () => {
    const parts = [
      tool({ toolCallId: "a", kind: "read" }),
      tool({ toolCallId: "b", kind: "search" }),
      tool({ toolCallId: "c", kind: "fetch" }),
    ];
    const items = groupToolParts(parts);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tool-group");
    if (items[0].kind === "tool-group") expect(items[0].parts).toHaveLength(3);
  });

  it("does NOT group a run of length 1", () => {
    const parts = [tool({ kind: "read" }), text("x"), tool({ kind: "read" })];
    expect(groupToolParts(parts).map((i) => i.kind)).toEqual([
      "single",
      "single",
      "single",
    ]);
  });

  it("breaks runs on any non-groupable part, preserving order", () => {
    const parts = [
      tool({ toolCallId: "a", kind: "read" }),
      tool({ toolCallId: "b", kind: "read" }),
      tool({ toolCallId: "x", kind: "execute" }),
      tool({ toolCallId: "c", kind: "search" }),
      tool({ toolCallId: "d", kind: "search" }),
    ];
    expect(groupToolParts(parts).map((i) => i.kind)).toEqual([
      "tool-group",
      "single",
      "tool-group",
    ]);
  });

  it("summarizes reads-only, search-only, and mixed runs", () => {
    expect(groupToolSummary([tool({ kind: "read" }), tool({ kind: "read" })])).toEqual({
      title: "Read 2 files",
      count: 2,
    });
    expect(groupToolSummary([tool({ kind: "search" }), tool({ kind: "search" })])).toEqual({
      title: "Searched code",
      count: 2,
    });
    expect(
      groupToolSummary([tool({ kind: "read" }), tool({ kind: "search" })]),
    ).toEqual({ title: "Read 1 file and searched code", count: 2 });
  });

  it("derives the worst group status", () => {
    expect(groupToolStatus([tool({ status: "completed" }), tool({ status: "completed" })])).toBe(
      "completed",
    );
    expect(groupToolStatus([tool({ status: "completed" }), tool({ status: "running" })])).toBe(
      "running",
    );
    expect(groupToolStatus([tool({ status: "running" }), tool({ status: "failed" })])).toBe(
      "failed",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/chat/groupToolParts.test.ts`
Expected: FAIL — `groupToolParts` (and helpers) not found / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/chat/groupToolParts.ts
import type { ChatPart, ChatToolStatus } from "@/types";

export type ToolPart = Extract<ChatPart, { type: "tool" }>;

/** A read/search/fetch tool part may be folded into a summary group. */
const GROUPABLE_KINDS = new Set(["read", "search", "fetch"]);

export function isGroupable(part: ChatPart): part is ToolPart {
  return part.type === "tool" && part.kind != null && GROUPABLE_KINDS.has(part.kind);
}

export type RenderItem =
  | { kind: "single"; key: string; part: ChatPart; index: number }
  | { kind: "tool-group"; key: string; parts: ToolPart[] };

/**
 * Fold a message's parts into a render list. A maximal run of >= 2 adjacent
 * read/search/fetch tool parts becomes one `tool-group`; everything else (incl.
 * a run of length 1) passes through as a `single`, preserving transcript order.
 */
export function groupToolParts(parts: ChatPart[]): RenderItem[] {
  const items: RenderItem[] = [];
  let run: { part: ToolPart; index: number }[] = [];

  const flush = () => {
    if (run.length >= 2) {
      items.push({
        kind: "tool-group",
        key: `g-${run[0].index}`,
        parts: run.map((r) => r.part),
      });
    } else {
      for (const r of run) {
        items.push({ kind: "single", key: String(r.index), part: r.part, index: r.index });
      }
    }
    run = [];
  };

  parts.forEach((part, index) => {
    if (isGroupable(part)) {
      run.push({ part, index });
      return;
    }
    flush();
    items.push({ kind: "single", key: String(index), part, index });
  });
  flush();
  return items;
}

export function groupToolSummary(parts: ToolPart[]): { title: string; count: number } {
  const reads = parts.filter((p) => p.kind === "read" || p.kind === "fetch").length;
  const searches = parts.filter((p) => p.kind === "search").length;
  const fileWord = reads === 1 ? "file" : "files";
  let title: string;
  if (searches === 0) title = `Read ${reads} ${fileWord}`;
  else if (reads === 0) title = "Searched code";
  else title = `Read ${reads} ${fileWord} and searched code`;
  return { title, count: parts.length };
}

export function groupToolStatus(parts: ToolPart[]): ChatToolStatus {
  if (parts.some((p) => p.status === "failed")) return "failed";
  if (parts.some((p) => p.status === "pending" || p.status === "running")) return "running";
  return "completed";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/chat/groupToolParts.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/groupToolParts.ts src/lib/chat/groupToolParts.test.ts
git commit -m "feat(chat): group consecutive read/search tool parts"
```

---

## Task 2: Presentation helpers (glyphs, command text, badges)

**Files:**
- Create: `src/lib/chat/toolGlyph.tsx`
- Test: `src/lib/chat/toolGlyph.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/lib/chat/toolGlyph.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { commandText, toolGlyph, CommandStatusBadge } from "./toolGlyph";

describe("commandText", () => {
  it("reads a string rawInput", () => {
    expect(commandText("ls -la")).toBe("ls -la");
  });
  it("reads a { command } object (string or string[])", () => {
    expect(commandText({ command: "cargo test" })).toBe("cargo test");
    expect(commandText({ command: ["cargo", "test"] })).toBe("cargo test");
  });
  it("returns null for shapes it cannot read", () => {
    expect(commandText(null)).toBeNull();
    expect(commandText({ foo: 1 })).toBeNull();
  });
});

describe("toolGlyph", () => {
  it("renders an svg icon for a kind", () => {
    const { container } = render(<>{toolGlyph("execute", "completed")}</>);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("CommandStatusBadge", () => {
  it("labels success / failed / running", () => {
    const { rerender } = render(<CommandStatusBadge status="completed" />);
    expect(screen.getByText("Success")).toBeInTheDocument();
    rerender(<CommandStatusBadge status="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    rerender(<CommandStatusBadge status="running" />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/chat/toolGlyph.test.tsx`
Expected: FAIL — module `./toolGlyph` not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/lib/chat/toolGlyph.tsx
import {
  FileText,
  Loader2,
  Pencil,
  Search,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ChatToolStatus } from "@/types";

/** Tint a glyph/badge by tool status, matching the mockup's resting/active states. */
function statusTint(status: ChatToolStatus): string {
  switch (status) {
    case "completed":
      return "text-status-success";
    case "failed":
      return "text-destructive";
    case "running":
    case "pending":
      return "text-status-info";
    default:
      return "text-muted-foreground";
  }
}

/** The lucide glyph for a tool kind, tinted by status (spinning while running). */
export function toolGlyph(kind: string | null | undefined, status: ChatToolStatus): ReactNode {
  const running = status === "running" || status === "pending";
  const tint = cn("size-3.5 shrink-0", running ? "text-status-info" : statusTint(status));
  if (running) return <Loader2 className={cn(tint, "animate-spin")} />;
  switch (kind) {
    case "execute":
      return <TerminalSquare className={tint} />;
    case "search":
    case "fetch":
      return <Search className={tint} />;
    case "read":
      return <FileText className={tint} />;
    case "edit":
      return <Pencil className={tint} />;
    default:
      return <Wrench className={tint} />;
  }
}

/** The glyph for a grouped read/search row (Search if the run searched, else FileText). */
export function groupGlyph(anySearch: boolean, status: ChatToolStatus): ReactNode {
  const running = status === "running" || status === "pending";
  const tint = cn("size-3.5 shrink-0", running ? "text-status-info" : statusTint(status));
  if (running) return <Loader2 className={cn(tint, "animate-spin")} />;
  return anySearch ? <Search className={tint} /> : <FileText className={tint} />;
}

/** Best-effort command string from a tool's rawInput (string | {command}). */
export function commandText(rawInput: unknown): string | null {
  if (typeof rawInput === "string") return rawInput;
  if (rawInput && typeof rawInput === "object" && "command" in rawInput) {
    const cmd = (rawInput as { command: unknown }).command;
    if (typeof cmd === "string") return cmd;
    if (Array.isArray(cmd) && cmd.every((c) => typeof c === "string")) return cmd.join(" ");
  }
  return null;
}

const BADGE_LABEL: Record<ChatToolStatus, string> = {
  completed: "Success",
  failed: "Failed",
  running: "Running",
  pending: "Running",
};

/** A labelled status badge with a coloured dot, for command rows. */
export function CommandStatusBadge({ status }: { status: ChatToolStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs",
        statusTint(status),
      )}
      data-testid="command-status-badge"
    >
      <span className="size-1.5 rounded-full bg-current" />
      {BADGE_LABEL[status]}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/chat/toolGlyph.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/toolGlyph.tsx src/lib/chat/toolGlyph.test.tsx
git commit -m "feat(chat): tool glyphs, command-text parser, status badge"
```

---

## Task 3: Extend ToolHeader with glyph / trailing / hideStatusBadge slots

**Files:**
- Modify: `src/components/ai-elements/tool.tsx:26-31` (Tool), `:101-161` (ToolHeader)

- [ ] **Step 1: Quiet resting style on `Tool`**

Replace the `Tool` definition (lines 26-31):

```tsx
export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      // Quiet at rest: transparent, no border. Gains a hairline border + faint card
      // tint on hover and when open, per the Codex look.
      "group not-prose mb-0.5 w-full rounded-md border border-transparent transition-colors",
      "hover:bg-card/50 data-[state=open]:border-border data-[state=open]:bg-card/40",
      className,
    )}
    {...props}
  />
);
```

- [ ] **Step 2: Add the three slot props to `ToolHeader`**

Replace the `ToolHeader` signature and body (lines 101-161) with:

```tsx
export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  compact = false,
  expandable = true,
  glyph,
  trailing,
  hideStatusBadge = false,
  ...props
}: ToolHeaderProps & {
  compact?: boolean;
  expandable?: boolean;
  glyph?: ReactNode;
  trailing?: ReactNode;
  hideStatusBadge?: boolean;
}) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  const row = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {glyph ?? (
          <WrenchIcon
            className={cn("shrink-0 text-muted-foreground", compact ? "size-3" : "size-4")}
          />
        )}
        <span
          className={cn(
            "truncate font-medium",
            compact ? "text-xs text-foreground/80" : "text-sm",
          )}
          title={title ?? derivedName}
        >
          {title ?? derivedName}
        </span>
        {!hideStatusBadge && getStatusBadge(state, compact)}
      </div>
      {trailing}
      {expandable && (
        <ChevronDownIcon
          className={cn(
            "shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180",
            compact ? "size-3" : "size-4",
          )}
        />
      )}
    </>
  );

  const triggerClass = cn(
    "flex w-full items-center justify-between gap-2",
    compact ? "px-2 py-1.5" : "gap-4 p-3",
    className,
  );

  if (!expandable) {
    return (
      <div className={triggerClass} data-testid="tool-header-static">
        {row}
      </div>
    );
  }

  return (
    <CollapsibleTrigger className={triggerClass} {...props}>
      {row}
    </CollapsibleTrigger>
  );
};
```

`ReactNode` is already imported (line 19). No new imports needed.

- [ ] **Step 3: Run the existing tool/transcript suite to verify nothing broke**

Run: `pnpm test -- src/lib/chat/renderChatParts.test.tsx src/components/chat/ChatTranscript.test.tsx`
Expected: PASS — the new props are optional and default to current behavior (status badge still shown, Wrench glyph fallback).

- [ ] **Step 4: Typecheck**

Run: `pnpm build`
Expected: PASS (no unused params; `glyph`/`trailing`/`hideStatusBadge` are all consumed).

- [ ] **Step 5: Commit**

```bash
git add src/components/ai-elements/tool.tsx
git commit -m "feat(chat): glyph/trailing/hideStatusBadge slots + quiet resting tool row"
```

---

## Task 4: Wire kind-specific rows + grouping into renderChatParts

**Files:**
- Modify: `src/lib/chat/renderChatParts.tsx` (imports, `renderChatPart` tool/file_edit cases, new `renderToolGroup`, `ChatMessageRow`)
- Test: `src/lib/chat/renderChatParts.test.tsx`

- [ ] **Step 1: Write the failing tests** (append inside `describe("renderChatPart", ...)` and add a new describe block)

```tsx
  it("renders a command row with a success badge and the command", () => {
    const part: ChatPart = {
      type: "tool",
      toolCallId: "c1",
      title: "Ran command",
      kind: "execute",
      status: "completed",
      locations: [],
      rawInput: { command: "cargo test acp_cancel" },
      output: "test result: ok. 2 passed",
    };
    renderWithProviders(<>{renderChatPart({ part, partKey: "0" })}</>);
    expect(screen.getByTestId("command-status-badge")).toHaveTextContent("Success");
    fireEvent.click(screen.getByTestId("chat-tool"));
    expect(screen.getByText(/cargo test acp_cancel/)).toBeInTheDocument();
  });

  it("renders an edit row with inline +/- stats and opens the diff on title click", () => {
    const part: ChatPart = {
      type: "file_edit",
      path: "src/lib.rs",
      additions: 4,
      deletions: 6,
      diff: "let x = 1;",
    };
    const onOpenFile = vi.fn();
    renderWithProviders(
      <>{renderChatPart({ part, partKey: "0", handlers: { onOpenFile } })}</>,
    );
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("-6")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-file-chip"));
    expect(onOpenFile).toHaveBeenCalledWith("src/lib.rs");
  });
});

describe("ChatMessageRow grouping", () => {
  it("collapses a run of reads into one summary row", () => {
    const message: ChatMessage = {
      id: "m1",
      role: "agent",
      parts: [
        { type: "tool", toolCallId: "a", title: "Read", kind: "read", status: "completed", locations: [{ path: "a.rs" }], output: null },
        { type: "tool", toolCallId: "b", title: "Read", kind: "read", status: "completed", locations: [{ path: "b.rs" }], output: null },
        { type: "tool", toolCallId: "c", title: "Search", kind: "search", status: "completed", locations: [], output: null },
      ],
      createdAt: "t0",
      completedAt: "t1",
    };
    renderWithProviders(<ChatMessageRow message={message} />);
    expect(screen.getByTestId("chat-tool-group")).toBeInTheDocument();
    expect(screen.getByText("Read 2 files and searched code")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // count pill
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/chat/renderChatParts.test.tsx`
Expected: FAIL — no command badge, no `+4`/`-6` text node, no `chat-tool-group`.

- [ ] **Step 3: Implement — update imports**

Replace the import block at the top of `renderChatParts.tsx` (the `Tool` import group lines 28-42) so it also pulls the new helpers and `ReactNode`/`CodeBlock`:

```tsx
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { cn } from "@/lib/utils";
import { formatToolDisplayName } from "@/lib/chat/toolDisplayName";
import {
  groupToolParts,
  groupToolSummary,
  groupToolStatus,
  type RenderItem,
  type ToolPart as GroupToolPart,
} from "@/lib/chat/groupToolParts";
import {
  CommandStatusBadge,
  commandText,
  groupGlyph,
  toolGlyph,
} from "@/lib/chat/toolGlyph";
import type {
  ChatMessage,
  ChatPart,
  ChatPlanStatus,
  ChatToolStatus,
} from "@/types";
```

- [ ] **Step 4: Implement — split the `tool` case into command vs read/generic**

Replace the entire `case "tool": { ... }` block (lines 111-152) with:

```tsx
    case "tool": {
      const state = mapToolState(part.status);
      const glyph = toolGlyph(part.kind, part.status);
      const cmd = part.kind === "execute" ? commandText(part.rawInput) : null;
      const hasBody =
        part.locations.length > 0 || Boolean(part.output) || part.rawInput != null;
      const displayName =
        part.kind === "execute"
          ? `Ran ${cmd ?? formatToolDisplayName(part.title, part.kind)}`
          : formatToolDisplayName(part.title, part.kind);
      return (
        <Tool key={partKey} data-status={part.status} data-testid="chat-tool" defaultOpen={false}>
          <ToolHeader
            compact
            expandable={hasBody}
            glyph={glyph}
            hideStatusBadge
            state={state}
            title={displayName}
            toolName={part.kind ?? "tool"}
            trailing={part.kind === "execute" ? <CommandStatusBadge status={part.status} /> : null}
            type="dynamic-tool"
          />
          <span className="sr-only" data-testid="chat-tool-status">
            {toolStatusLabel(part.status)}
          </span>
          {hasBody && (
            <ToolContent>
              {cmd != null && (
                <div className="overflow-hidden rounded-md border bg-card">
                  <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
                    <span>Shell</span>
                    <CommandStatusBadge status={part.status} />
                  </div>
                  <div className="px-3 py-2 font-mono text-xs">
                    <div className="text-foreground">
                      <span className="mr-2 text-muted-foreground">$</span>
                      {cmd}
                    </div>
                  </div>
                </div>
              )}
              {cmd == null && part.rawInput != null && <ToolInput input={part.rawInput} />}
              {part.locations.length > 0 && (
                <ul className="space-y-1 font-mono text-xs">
                  {part.locations.map((location, index) => (
                    <li key={`${location.path}-${index}`}>
                      {location.path}
                      {location.line != null ? `:${location.line}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {(part.output || part.status === "failed") && (
                <ToolOutput
                  errorText={part.status === "failed" ? part.output ?? "Tool failed" : undefined}
                  output={part.status === "failed" ? undefined : part.output ?? undefined}
                />
              )}
            </ToolContent>
          )}
        </Tool>
      );
    }
```

- [ ] **Step 5: Implement — richer `file_edit` row** (collapsible, inline stats, new-text body)

Replace the `case "file_edit": { ... }` block (lines 153-170) with:

```tsx
    case "file_edit": {
      const fileName = part.path.split("/").pop() ?? part.path;
      const stats = (
        <span className="shrink-0 font-mono text-xs tabular-nums" data-testid="edit-stats">
          <span className="text-status-success">+{part.additions}</span>{" "}
          <span className="text-destructive">-{part.deletions}</span>
        </span>
      );
      const editGlyph = toolGlyph("edit", "completed");
      // Title click jumps to the full Diff tab; chevron toggles the inline new-text preview.
      const titleButton = (
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          data-testid="chat-file-chip"
          type="button"
          onClick={() => handlers?.onOpenFile?.(part.path)}
        >
          {editGlyph}
          <span className="truncate text-xs">
            Edited <span className="font-mono">{fileName}</span>
          </span>
        </button>
      );
      if (!part.diff) {
        return (
          <div
            key={partKey}
            className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-card/50"
            data-testid="chat-tool"
          >
            {titleButton}
            {stats}
          </div>
        );
      }
      return (
        <Tool key={partKey} data-testid="chat-tool" defaultOpen={false}>
          <ToolHeader
            compact
            glyph={editGlyph}
            hideStatusBadge
            state="output-available"
            title={`Edited ${fileName}`}
            toolName="edit"
            trailing={stats}
            type="dynamic-tool"
          />
          <ToolContent>
            <CodeBlock code={part.diff} language="diff" />
          </ToolContent>
        </Tool>
      );
    }
```

Note: the `data-testid="chat-file-chip"` button preserves the existing `onOpenFile` test. The title is plain text (`Edited <file>`) inside the header for the diff case, with the same chip button reused for the no-diff case.

- [ ] **Step 6: Implement — `renderToolGroup` and consume grouping in `ChatMessageRow`**

Add this helper just above `chatMessageRole` (after the `renderChatPart` function closes, ~line 226):

```tsx
function renderToolGroup({
  parts,
  handlers,
  groupKey,
}: {
  parts: GroupToolPart[];
  handlers?: ChatPartHandlers;
  groupKey: string;
}) {
  const { title, count } = groupToolSummary(parts);
  const status = groupToolStatus(parts);
  const anySearch = parts.some((p) => p.kind === "search");
  const pill = (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
      {count}
    </span>
  );
  return (
    <Tool key={groupKey} data-testid="chat-tool-group" defaultOpen={false}>
      <ToolHeader
        compact
        glyph={groupGlyph(anySearch, status)}
        hideStatusBadge
        state={mapToolState(status)}
        title={title}
        toolName="tool-group"
        trailing={pill}
        type="dynamic-tool"
      />
      <ToolContent>
        <ul className="space-y-1.5">
          {parts.map((p, index) => {
            const verb = p.kind === "search" ? "Searched" : "Read";
            const target =
              p.locations[0]?.path ?? formatToolDisplayName(p.title, p.kind);
            const openable = p.locations[0]?.path;
            return (
              <li
                key={`${p.toolCallId}-${index}`}
                className="flex items-baseline gap-2 text-xs"
              >
                <span className="w-16 shrink-0 text-muted-foreground">{verb}</span>
                {openable ? (
                  <button
                    className={cn("truncate text-left font-mono text-foreground/70 hover:text-foreground")}
                    type="button"
                    onClick={() => handlers?.onOpenFile?.(openable)}
                  >
                    {target}
                  </button>
                ) : (
                  <span className="truncate font-mono text-foreground/70">{target}</span>
                )}
              </li>
            );
          })}
        </ul>
      </ToolContent>
    </Tool>
  );
}
```

Then replace the body of `ChatMessageRow` (the `MessageContent` children, lines 242-251) with a grouped render:

```tsx
      <MessageContent>
        {groupToolParts(message.parts).map((item: RenderItem) =>
          item.kind === "tool-group"
            ? renderToolGroup({
                parts: item.parts,
                handlers,
                groupKey: `${message.id}-${item.key}`,
              })
            : renderChatPart({
                part: item.part,
                handlers,
                isStreaming: isStreaming && item.part.type === "text",
                partKey: `${message.id}-${item.key}`,
              }),
        )}
      </MessageContent>
```

- [ ] **Step 7: Run the renderChatParts suite**

Run: `pnpm test -- src/lib/chat/renderChatParts.test.tsx`
Expected: PASS — including the new command-row, edit-row, and grouping tests, and the pre-existing text/permission/file-chip/ChatMessageRow tests.

- [ ] **Step 8: Run the full chat-adjacent suite + typecheck**

Run: `pnpm test -- src/lib/chat src/components/chat && pnpm build`
Expected: PASS. If `pnpm build` flags an unused import (e.g. `ToolInput` if no longer reached), remove it — strict mode (`noUnusedLocals`) will fail otherwise.

- [ ] **Step 9: Commit**

```bash
git add src/lib/chat/renderChatParts.tsx src/lib/chat/renderChatParts.test.tsx
git commit -m "feat(chat): Codex-style command, edit, and grouped tool rows"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the standard verification set**

Run: `pnpm verify`
Expected: lint + typecheck + full frontend test suite green. (Per the memory note, `pnpm test` also runs any `.claude/worktrees/*` copies — a failure path under `.claude/worktrees/` is not this code.)

- [ ] **Step 2: Manual visual check (user-driven; do not auto-launch)**

The user launches `pnpm desktop:dev`, opens a task with a live ACP chat, and diffs each row against `design-mockups/codex-chat-rows.html`:
- a run of reads collapses to `Read N files…` with a count pill, expands to the per-file list;
- a command shows `Ran <cmd>` + `✓ Success` / `✗ Failed` badge, expands to the `$ cmd` shell block;
- an edit shows `Edited <file>  +N −M`, title click opens the Diff tab, chevron reveals the new text;
- rows sit quiet at rest and gain a hairline border + faint tint on hover/open.

- [ ] **Step 3: Update docs**

Per `CLAUDE.md`, update `docs/features.md` where it describes the chat transcript / tool-call rendering to note the grouped read/search rows, command block, and edit rows. Keep it concrete (row types + grouping rule). Commit:

```bash
git add docs/features.md
git commit -m "docs: describe Codex-style chat tool rows"
```

---

## Self-Review notes

- **Spec coverage:** grouping (Task 1 + 4), command rows (Task 4 step 4), edit rows (Task 4 step 5), quiet resting style (Task 3) — all covered. Edit "diff" honestly scoped to `file_edit.diff` new-text per the corrected spec line.
- **Type consistency:** `RenderItem` / `ToolPart` from `groupToolParts.ts` are reused by name in Task 4; `ChatToolStatus` drives `toolGlyph`, `CommandStatusBadge`, `groupToolStatus`, and `mapToolState` consistently. Helper names match across tasks (`groupToolSummary`, `groupToolStatus`, `groupGlyph`, `toolGlyph`, `commandText`, `CommandStatusBadge`).
- **Placeholders:** none — every code step is complete.
