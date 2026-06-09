type AgentProfileId = { id: number };

export function resolveAgentProfileId(
  agentProfiles: readonly AgentProfileId[],
  ...preferredIds: Array<number | null | undefined>
): number | undefined {
  for (const preferredId of preferredIds) {
    if (preferredId != null && agentProfiles.some((profile) => profile.id === preferredId)) return preferredId;
  }
  return agentProfiles[0]?.id;
}

export function resolveReviewerProfileId(
  agentProfiles: readonly AgentProfileId[],
  workerProfileId?: number | null,
): number | undefined {
  return agentProfiles.find((profile) => profile.id !== workerProfileId)?.id ?? agentProfiles[0]?.id;
}
