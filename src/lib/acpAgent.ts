import type { AcpProviderInfo, AgentKind } from "@/types";

/** Agents that ship an ACP provider descriptor — chat is the primary surface. */
export function isAcpCapableAgent(agentKind: AgentKind | string, providers: AcpProviderInfo[]): boolean {
  return providers.some((provider) => provider.agentKind === agentKind);
}
