// 目录写入错误码 → 四语文案键。
//
// 后端返回的是稳定错误码（translation_required / parent_required …）。直接把码丢给用户等于没解释，
// 所以这里统一映射成人话；未知码才回退原文，避免把没覆盖的码伪装成已解释。
const CODE_KEYS: Record<string, string> = {
  translation_required: "catalog.error.translationRequired",
  evidence_required: "catalog.error.evidenceRequired",
  parent_required: "catalog.error.parentRequired",
  version_conflict: "catalog.error.versionConflict",
  immutable_scope: "catalog.error.immutableScope",
  invalid_payload: "catalog.error.invalidPayload",
  unknown_field: "catalog.error.unknownField",
  invalid_term: "catalog.error.invalidTerm",
  invalid_reference: "catalog.error.invalidReference",
  duplicate_relation: "catalog.error.duplicateRelation",
  duplicate_content: "catalog.error.duplicateContent",
  duplicate_position: "catalog.error.duplicatePosition",
  undeclared_release_subject: "catalog.error.undeclaredSubject",
  invalid_structural_field: "catalog.error.invalidStructuralField",
  use_lifecycle_endpoint: "catalog.error.useLifecycle",
  id_must_be_empty: "catalog.error.idMustBeEmpty",
  forbidden: "catalog.error.forbidden",
  authentication_required: "catalog.error.authenticationRequired",
};

/** 取错误码对应的文案键；未知码返回 null（调用方回退原文）。 */
export function catalogErrorKey(message: string): string | null {
  if (!message) return null;
  // 后端可能带补充信息（如 unknown_field: duration）：取冒号前的码
  const code = message.trim().split(":")[0].trim();
  return CODE_KEYS[code] || null;
}

/** 把后端错误消息本地化：命中码就用人话，未命中保留原文（不伪装成已解释）。 */
export function localizeCatalogError(message: string, t: (k: string) => string): string {
  const key = catalogErrorKey(message);
  if (!key) return message;
  const text = t(key);
  return text && text !== key ? text : message;
}
