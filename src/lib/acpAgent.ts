import type { AcpProviderInfo, AgentKind } from "@/types";

/** Agents that ship an ACP provider descriptor — chat is the primary surface. */
export function isAcpCapableAgent(agentKind: AgentKind | string, providers: AcpProviderInfo[]): boolean {
  return providers.some((provider) => provider.agentKind === agentKind);
}

/** Custom profiles have no ACP descriptor and still use the embedded PTY terminal. */
export function usesTerminalPrimary(agentKind: AgentKind | string, providers: AcpProviderInfo[]): boolean {
  return !isAcpCapableAgent(agentKind, providers);
}
