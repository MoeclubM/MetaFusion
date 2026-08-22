/** Show original_title only when it differs from the primary display title. */
export function isDistinctOriginalTitle(
  originalTitle?: string | null,
  displayTitle?: string | null,
): boolean {
  const original = (originalTitle ?? "").trim();
  if (!original) return false;
  const display = (displayTitle ?? "").trim();
  if (!display) return true;
  return original.toLocaleLowerCase() !== display.toLocaleLowerCase();
}
