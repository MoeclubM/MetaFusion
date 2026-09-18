// 时长展示口径（审计 2026-09-19 第 17 条）。
//
// 同一份时长此前有两种写法：轨表是 H:MM:SS（8:03），而"附加信息"面板把 duration
// 直出成裸秒数（时长（秒）7200）。这里给唯一实现：分钟级 M:SS，超过一小时 H:MM:SS；
// 原始秒数由调用方放进 title 里，需要精确值时仍可读到。
//
// 无效值与非正数返回空串（"没有时长"由调用方决定显示成什么，不在格式化函数里替它决定）。

export function formatDuration(totalSeconds?: number | null): string {
  const s = Math.round(Number(totalSeconds));
  if (!Number.isFinite(s) || s <= 0) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return hours > 0 ? hours + ":" + pad(minutes) + ":" + pad(seconds) : minutes + ":" + pad(seconds);
}
