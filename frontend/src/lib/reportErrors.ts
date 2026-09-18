// 举报/申诉接口的错误码 → 四语文案键。
//
// 与 lib/communityErrors.ts 同风格，但**不回退原文**：举报对话框和"我的举报"页都有失败文案位，
// 用户不该看到 duplicate_report / rate_limited 这类机器码（接口契约里它们是给程序看的）。
// 未覆盖的码与网络异常分别归到 report.err.unknown / report.err.network，也不回显裸码。
import { ApiError } from "./api/client";

// 码表来源：互动服务报告/申诉处理器的失败码（见接口契约）。
const CODE_KEYS: Record<string, string> = {
  invalid_target_type: "report.err.invalid_target_type",
  invalid_target_id: "report.err.invalid_target_id",
  invalid_reason: "report.err.invalid_reason",
  invalid_evidence_url: "report.err.invalid_evidence_url",
  detail_too_long: "report.err.detail_too_long",
  appeal_too_long: "report.err.appeal_too_long",
  not_found: "report.err.not_found",
  duplicate_report: "report.err.duplicate_report",
  rate_limited: "report.err.rate_limited",
  authentication_required: "report.err.authentication_required",
  appeal_not_available: "report.err.appeal_not_available",
  not_appealed_party: "report.err.not_appealed_party",
  report_not_disposed: "report.err.report_not_disposed",
  duplicate_appeal: "report.err.duplicate_appeal",
  invalid_report_state: "report.err.invalid_report_state",
  content_still_present: "report.err.content_still_present",
  enforcement_not_supported: "report.err.enforcement_not_supported",
  note_required: "report.err.note_required",
  module_error: "report.err.module_error",
  upstream_unavailable: "report.err.upstream_unavailable",
  forbidden: "report.err.forbidden",
};

/** 取错误码对应的文案键；未知码返回 null。 */
export function reportErrorKey(code: string | null | undefined): string | null {
  if (!code) return null;
  // 与 lib/communityErrors.ts 同一扫描口径：按冒号分段取第一个已知码，兼容被外层包住的码。
  for (const segment of code.trim().split(":")) {
    const key = CODE_KEYS[segment.trim()];
    if (key) return key;
  }
  return null;
}

/** 任意失败 → 四语人话：HTTP 错误按机器码，取不到响应体（断网/DNS）按 network。 */
export function localizeReportError(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    const key = reportErrorKey(err.message);
    return t(key || "report.err.unknown");
  }
  return t("report.err.network");
}
