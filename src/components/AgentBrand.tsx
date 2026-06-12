import { Bot } from "lucide-react";
import claudeLogo from "../assets/logos/claude.svg";
import codexLogo from "../assets/logos/codex.svg";
import antigravityLogo from "../assets/logos/antigravity.svg";
import opencodeLogo from "../assets/logos/opencode.svg";
import { cn } from "../lib/utils";
import type { AgentKind } from "../types";

type BrandKey = "codex" | "claude" | "antigravity" | "opencode" | "custom";
type LogoSize = "xs" | "sm" | "md" | "lg";

const brandLabels: Record<BrandKey, string> = {
  codex: "Codex",
  claude: "Claude",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  custom: "Custom model",
};

const brandLogos: Partial<Record<BrandKey, string>> = {
  codex: codexLogo,
  claude: claudeLogo,
  antigravity: antigravityLogo,
  opencode: opencodeLogo,
};

const logoSizes: Record<LogoSize, string> = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-[22px]",
  lg: "size-7",
};

export function AgentLogo({
  agentKind,
  size = "md",
  className,
}: {
  agentKind: AgentKind;
  size?: LogoSize;
  className?: string;
}) {
  return <BrandLogo brand={brandForAgentKind(agentKind)} size={size} className={className} />;
}

export function ModelLogo({
  agentKind,
  model,
  size = "sm",
  className,
}: {
  agentKind: AgentKind;
  model?: string | null;
  size?: LogoSize;
  className?: string;
}) {
  return <BrandLogo brand={brandForModel(agentKind, model)} size={size} className={className} />;
}

function BrandLogo({
  brand,
  size,
  className,
}: {
  brand: BrandKey;
  size: LogoSize;
  className?: string;
}) {
  const logo = brandLogos[brand];

  return (
    <span
      role="img"
      aria-label={`${brandLabels[brand]} ${brand === "custom" ? "icon" : "logo"}`}
      className={cn(
        "inline-grid shrink-0 place-items-center text-foreground [&>img]:block [&>img]:size-full [&>svg]:block [&>svg]:size-full",
        logoSizes[size],
        className,
      )}
    >
      {logo ? (
        <img src={logo} alt="" aria-hidden="true" />
      ) : (
        <Bot aria-hidden="true" strokeWidth={2} />
      )}
    </span>
  );
}

function brandForAgentKind(agentKind: AgentKind): BrandKey {
  switch (agentKind) {
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "antigravity":
      return "antigravity";
    case "opencode":
      return "opencode";
    case "custom":
      return "custom";
  }
}

function brandForModel(agentKind: AgentKind, model?: string | null): BrandKey {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("gpt-") || normalized.startsWith("o1") || normalized.startsWith("o3") || normalized.startsWith("o4")) {
    return "codex";
  }
  if (normalized.includes("claude") || normalized.includes("sonnet") || normalized.includes("opus") || normalized.includes("haiku")) {
    return "claude";
  }
  if (normalized.includes("antigravity") || normalized.includes("agy") || normalized.includes("gemini")) {
    return "antigravity";
  }
  if (normalized.startsWith("opencode/") || normalized.includes("opencode")) {
    return "opencode";
  }
  if (!normalized) {
    return brandForAgentKind(agentKind);
  }
  return "custom";
}
