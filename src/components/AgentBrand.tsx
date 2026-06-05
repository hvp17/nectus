import { Bot } from "lucide-react";
import claudeLogo from "../assets/logos/claude.svg";
import codexLogo from "../assets/logos/codex.svg";
import geminiLogo from "../assets/logos/gemini.svg";
import { cn } from "../lib/utils";
import type { AgentKind } from "../types";

type BrandKey = "codex" | "claude" | "gemini" | "custom";
type LogoSize = "xs" | "sm" | "md" | "lg";

const brandLabels: Record<BrandKey, string> = {
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  custom: "Custom model",
};

const brandLogos: Partial<Record<BrandKey, string>> = {
  codex: codexLogo,
  claude: claudeLogo,
  gemini: geminiLogo,
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
      className={cn("brand-logo", `brand-logo-${size}`, `brand-logo-${brand}`, className)}
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
    case "gemini":
      return "gemini";
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
  if (normalized.includes("gemini")) {
    return "gemini";
  }
  if (!normalized) {
    return brandForAgentKind(agentKind);
  }
  return "custom";
}
