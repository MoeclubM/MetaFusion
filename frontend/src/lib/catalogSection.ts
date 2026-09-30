/** Keep unavailable sections distinct from a successful, empty list. */
export async function loadCatalogSection<T extends { items: unknown[] }>(
  request: Promise<T>,
  fallback: T,
  validate?: (value: T) => boolean,
): Promise<{ data: T; failed: boolean }> {
  try {
    const data = await request;
    if (!data || !Array.isArray(data.items) || (validate && !validate(data))) throw new Error("invalid_section_response");
    return { data, failed: false };
  } catch {
    return { data: fallback, failed: true };
  }
}
