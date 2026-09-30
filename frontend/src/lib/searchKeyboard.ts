export type SearchKeyAction = "ignore" | "submit" | "select" | "next" | "previous" | "dismiss" | "none";
export function searchKeyAction(event: { key: string; isComposing?: boolean; keyCode?: number }, open: boolean, active: number, count: number): SearchKeyAction {
  // keyCode 229 covers composition-confirmation Enter in browsers that clear isComposing early.
  if (event.isComposing || event.keyCode === 229) return "ignore";
  if (event.key === "Enter") return open && active >= 0 && active < count ? "select" : "submit";
  if (!open) return "none";
  if (event.key === "ArrowDown") return "next";
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "Escape") return "dismiss";
  return "none";
}
