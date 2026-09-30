/** Compact, factual disambiguation for same-title records; no inferred edition or author. */
export function entityIdentitySuffix(entity: { id?: string; external_ids?: Record<string, string> }): string {
  const external = Object.entries(entity.external_ids || {})
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${value}`);
  return [...external, ...(entity.id ? [entity.id.slice(0, 8)] : [])].join(" · ");
}
