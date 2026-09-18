/**
 * 写接口的幂等键：绑定"一次提交意图" = 编辑会话 + 载荷指纹。
 *
 * 服务端只对 POST /catalog/entities 与 POST /catalog/relations 认这个头
 * （backend/internal/catalog/http.go 的接口说明），键是"路由 + 用户 + 客户端 key"，
 * **不做载荷哈希**。所以这里有两条约束：
 *   · 同一份载荷重试（双击保存、超时重发、网关重试）必须复用同一个键，服务端只落一次；
 *   · 载荷变了就换新键——复用旧键会把上一份载荷的首发响应当成本次结果返回。
 * 会话键由调用方在编辑会话内保持稳定（组件挂载期间的一个 ref），载荷指纹在本模块算。
 *
 * 审计 2026-09-19 第二轮架构报告 #5/#6：此前建实体根本不带该头、建关系每次点击现生成
 * UUID，两次重试就是两把键，幂等形同虚设。
 */

/** 新建一次编辑会话的键。只在客户端事件处理里调用（SSR 期不该读 crypto）。 */
export function newSubmissionSession(): string {
  return crypto.randomUUID();
}

/** 组装幂等键：同一个会话 + 同一份载荷 → 同一个键。 */
export function submissionKey(sessionKey: string, payload: unknown): string {
  return `${sessionKey}.${fingerprint(payload)}`;
}

/** 载荷指纹：djb2 变体 + 长度。只为区分同一表单里的不同载荷，不是安全摘要。 */
function fingerprint(payload: unknown): string {
  const text = JSON.stringify(payload) ?? "";
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}-${h.toString(36)}`;
}
