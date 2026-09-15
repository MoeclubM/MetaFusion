// 由 scripts/gen-theme.mjs 生成，勿手改：改配色请看 scripts/theme-palette.mjs。
// 首帧同步执行：把 localStorage 里的主题选择写到 <html> 上，避免加载瞬间闪默认配色。
// 不校验取值——CSS 里没有对应变量块时会自动回落到默认配色（ThemeProvider 挂载后再校验一次）。
(function () {
  try {
    var m = localStorage.getItem("metafusion_theme_mode") || "dark";
    var a = localStorage.getItem("metafusion_theme_accent") || "blue";
    var t = localStorage.getItem("metafusion_theme_tone") || "neutral";
    if (["blue","sky","cyan","teal","emerald","lime","amber","orange","red","rose","fuchsia","purple","violet","indigo","slate","monochrome"].indexOf(a) < 0) a = "blue";
    if (["neutral","cool","warm","deep"].indexOf(t) < 0) t = "neutral";
    var e = m === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : (m === "light" ? "light" : "dark");
    var r = document.documentElement;
    r.setAttribute("data-theme-mode", e);
    r.setAttribute("data-theme-accent", a);
    r.setAttribute("data-theme-tone", t);
    r.classList.remove("dark", "light");
    r.classList.add(e);
    r.style.colorScheme = e;
  } catch (_) {}
})();
