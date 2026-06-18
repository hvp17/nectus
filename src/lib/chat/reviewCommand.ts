/** Parse a composer message for the reserved `/review [focus]` app command. */
export function parseReviewCommand(text: string):
  | { isReview: true; focus: string | undefined }
  | { isReview: false } {
  const trimmed = text.trim();
  if (trimmed !== "/review" && !trimmed.startsWith("/review ")) {
    return { isReview: false };
  }
  const focus = trimmed.slice("/review".length).trim();
  return { isReview: true, focus: focus.length > 0 ? focus : undefined };
}
