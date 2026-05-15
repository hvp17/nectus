export const FINISHED_ATTENTION_PREVIEW_LIMIT = 180;

export function truncateFinishedAttentionPreview(content: string) {
  if (content.length <= FINISHED_ATTENTION_PREVIEW_LIMIT) return content;
  return `${content.slice(0, FINISHED_ATTENTION_PREVIEW_LIMIT).trimEnd()}...`;
}
