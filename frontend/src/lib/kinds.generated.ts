// 本文件由 frontend/scripts/generate-contracts.mjs 生成，勿手改。
// 实体骨架八元组（目录库基线的 catalog.entities.kind 约束）。
// 来源：backend/migrations/000001_catalog_core.up.sql
// 校验：cd frontend && node scripts/generate-contracts.mjs --check

export const ENTITY_KINDS = [
  "agent",
  "collection",
  "work",
  "content_unit",
  "expression",
  "release",
  "medium",
  "track",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];
