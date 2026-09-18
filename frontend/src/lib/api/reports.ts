// 举报与申诉的互动服务客户端（/api/community/reports）。
//
// 为什么不并进 lib/api.ts（barrel）与 lib/api/community.ts：两个文件当时都有在途改动，
// 这一域独立成文件，只在组件里直接 import。
//
// 错误体统一是 {"error":"机器码"}，由 lib/api/client.ts 的 fetchApi 原样放进 ApiError.message；
// 机器码到四语文案的映射在 lib/reportErrors.ts，界面层不显示裸码。
import { fetchApi } from "./client";
import { requireArray, safeCount } from "./fields";

/** 举报对象类型：与 /works、/community、/users 各入口一一对应。 */
export type ReportTargetType = "entity" | "comment" | "post" | "user" | "resource";

/** 举报理由码：顺序即服务端校验顺序，展示顺序也照此（见 REPORT_REASONS）。 */
export type ReportReason =
  | "illegal"
  | "copyright"
  | "privacy"
  | "abuse"
  | "harassment"
  | "spam"
  | "misinformation"
  | "other";

/** 举报处理状态。 */
export type ReportStatus = "pending" | "accepted" | "rejected" | "resolved";
/** 申诉处理状态（申诉只有三种终态，没有 resolved）。 */
export type AppealStatus = "pending" | "accepted" | "rejected";
/** 处置结论：空串表示尚未处置。 */
export type Enforcement = "none" | "content_removed" | "user_banned" | "";

/** 理由码的展示顺序 = 服务端校验顺序；下拉/单选一律遍历它，不在组件里另排一份。 */
export const REPORT_REASONS: readonly ReportReason[] = [
  "illegal",
  "copyright",
  "privacy",
  "abuse",
  "harassment",
  "spam",
  "misinformation",
  "other",
];

/** 被举报对象的上下文（服务端补齐，用于"我的举报"里认出举报的是哪条内容）。 */
export interface ReportTargetContext {
  content_kind?: string;
  board_code?: string;
  topic_id?: string;
  entity_id?: string;
  excerpt?: string;
  excerpt_truncated?: boolean;
}

export interface ReportAppeal {
  id: string;
  body: string;
  status: AppealStatus;
  created_at: string;
  reviewer_name?: string;
  review_note?: string;
  reviewed_at?: string;
}

export interface MyReportItem {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  target_context?: ReportTargetContext | null;
  reason: ReportReason;
  detail?: string;
  evidence_url?: string;
  status: ReportStatus;
  reviewer_name?: string;
  review_note?: string;
  enforcement?: Enforcement;
  reviewed_at?: string;
  created_at: string;
  /** 是否可以申诉：服务端算好的判据（本人 + 已受理/已处置 + 未申诉过），前端不重算。 */
  can_appeal?: boolean;
  appeal?: ReportAppeal | null;
}

export interface SubmitReportInput {
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  detail?: string;
  evidence_url?: string;
}

/** 提交举报；失败时抛 ApiError，message 是机器码（duplicate_report / rate_limited / ...）。 */
export async function submitReport(input: SubmitReportInput): Promise<MyReportItem> {
  const body: Record<string, string> = {
    target_type: input.target_type,
    target_id: input.target_id,
    reason: input.reason,
  };
  // 空串与"没填"同义：不把空字符串当证据地址送去校验（invalid_evidence_url 会把它挡下）。
  const detail = (input.detail || "").trim();
  if (detail) body.detail = detail;
  const evidence = (input.evidence_url || "").trim();
  if (evidence) body.evidence_url = evidence;

  const res = await fetchApi<{ ok: boolean; item: MyReportItem }>("/community/reports", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.item;
}

/** 我的举报列表（分页）；数组字段非数组即抛，交给调用方的失败分支，不折成"没有举报"。 */
export async function fetchMyReports(
  page = 1,
  pageSize = 20
): Promise<{ items: MyReportItem[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const res = await fetchApi<{ items: unknown; total: unknown }>(
    `/community/reports/mine?${params.toString()}`
  );
  const items = requireArray<MyReportItem>(res.items, "items");
  return { items, total: safeCount(res.total, items.length) };
}

/** 被处置方提交申诉（每条举报一次）；是否显示入口一律以 item.can_appeal 为准。 */
export async function submitAppeal(reportId: string, body: string): Promise<MyReportItem> {
  const res = await fetchApi<{ ok: boolean; item: MyReportItem }>(
    `/community/reports/${encodeURIComponent(reportId)}/appeal`,
    { method: "POST", body: JSON.stringify({ body: body.trim() }) }
  );
  return res.item;
}
