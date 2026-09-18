// 读接口字段的统一口径（契约漂移守卫）。
//
// 规则：**界面上"空"有文案的列表，归一必须发生在能区分失败的那一层**。
// 数组字段缺失或换型时，不要把 undefined/换型值折成 [] 交给界面——那会把"取不到"讲成"没有"；
// 要么在这里抛 invalid_response: <字段名> 让调用方的失败分支接住，要么（该处界面上没有"空"文案、
// 只是少一块次要内容时）明确用默认值并在调用点写清理由。只有确认为数组（含空数组）才是"真的没有"。
//
// 错误码前缀沿用既有约定：message 形如 "invalid_response: items"，各处的 code→文案映射会把它显示出来。

/** 数组字段：非数组即抛。 */
export function requireArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) throw new Error(`invalid_response: ${field}`);
  return value as T[];
}

/** 计数类字段：只接受有限、非负、不超过安全整数的数，其余（缺失 / NaN / 负数 / Infinity / 超大值）退回 fallback。 */
export function safeCount(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return fallback;
  }
  return Math.floor(value);
}
