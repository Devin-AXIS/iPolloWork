export const FEEDBACK_RATING_SCALE = 10;

export function parseFeedbackRating(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const rating = Number(trimmed);
  if (!Number.isInteger(rating)) return null;
  if (rating < 0 || rating > FEEDBACK_RATING_SCALE) return null;
  return rating;
}
