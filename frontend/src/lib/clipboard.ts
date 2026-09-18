// 剪贴板复制：优先 Clipboard API，非安全上下文（http 局域网调试）退回 execCommand。
//
// 返回是否成功——调用方要如实告诉用户"没复制上"，而不是让按钮看着像成功了。
// 同一个降级逻辑原先在邀请码页与开发者中心各写了一份，PAT 面板起收在这里。
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 非安全上下文或用户拒绝授权：落到下面的 execCommand
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
