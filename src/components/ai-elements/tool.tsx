"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

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

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusLabelsCompact: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Done",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"], compact = false) => {
  const label = compact ? statusLabelsCompact[status] : statusLabels[status];
  const iconOnly =
    compact &&
    (status === "output-available" ||
      status === "output-error" ||
      status === "output-denied" ||
      status === "input-available" ||
      status === "input-streaming");

  return (
    <Badge
      className={cn(
        "shrink-0 gap-1 rounded-full text-xs",
        iconOnly ? "size-5 justify-center p-0" : "gap-1.5",
      )}
      variant="secondary"
    >
      {statusIcons[status]}
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </Badge>
  );
};

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

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "space-y-3 border-t px-3 py-2 text-popover-foreground outline-none data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
