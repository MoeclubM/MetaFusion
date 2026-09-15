import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--bg-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        surfaceHover: "rgb(var(--surface-hover-rgb) / <alpha-value>)",
        surfaceBorder: "var(--surface-border-color)",
        primary: {
          DEFAULT: "var(--primary-color)",
          hover: "var(--primary-hover-color)",
          light: "var(--primary-light-color)",
        },
        accent: {
          gold: "#f59e0b",
          cyan: "#06b6d4",
          emerald: "#10b981",
        },
        // 语义色：界面里只用这几个，不再逐处写 `border-black/10 dark:border-white/[0.06]`。
        // 深色/浅色由 CSS 变量切换（globals.css），组件侧与主题解耦。
        line: {
          DEFAULT: "var(--line-color)",
          subtle: "var(--line-subtle-color)",
          strong: "var(--line-strong-color)",
        },
        surfaceSubtle: "var(--surface-subtle-color)",
        text: {
          strong: "var(--text-strong-color)",
          body: "var(--text-body-color)",
          muted: "var(--text-muted-color)",
          faint: "var(--text-faint-color)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Noto Sans SC",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
        display: [
          "Instrument Serif",
          "Noto Serif SC",
          "Georgia",
          "serif",
        ],
      },
      // Landing-page-grade radii: inner pages share the hero's soft pill curvature.
      // Small elements (chips, badges) clamp visually to near-pill since the radius
      // dominates their height — matching the rounded-full signature of the landing page.
      // 角色化圆角：同一个角色在任何页面必须是同一个值。
      // 迁移目标是把 655 处 `rounded-sm/md/lg/xl` 的混用收敛到下面五个角色：
      //   chip（标签/徽章）< control（输入框/按钮）< card（卡片/列表行）< panel（面板/弹窗）< hero（首屏大块）
      // 数值按"角色"对齐：sm=标签 8 / md=控件 12 / lg=卡片 16 / xl=面板 20 / 2xl=大块 24。
      // 本轮把混用的 rounded-sm/md/lg/xl 直接对齐到同一套角色值，组件侧再逐步换成语义名。
      borderRadius: {
        none: "0px",
        xs: "6px",
        sm: "8px",
        DEFAULT: "12px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
        card: "16px",
        panel: "20px",
        hero: "24px",
        control: "12px",
        chip: "8px",
        tech: "12px",
        pill: "9999px",
        full: "9999px",
      },
      // 容器宽度只留三档：page（主内容）/ narrow（阅读与表单）/ form（登录等窄卡）。
      maxWidth: {
        page: "80rem",
        narrow: "48rem",
        form: "26rem",
      },
      // 动效统一：时长与缓动固定，组件不再各写 duration-150/200/300。
      transitionDuration: { fast: "120ms", base: "200ms", slow: "320ms" },
      transitionTimingFunction: { soft: "cubic-bezier(0.16, 1, 0.3, 1)" },
      boxShadow: {
        soft: "0 8px 24px -8px rgba(0,0,0,0.4)",
        elevated: "0 16px 48px -12px rgba(0,0,0,0.55)",
        glow: "0 2px 20px rgba(59,130,246,0.12)",
        "glow-amber": "0 2px 20px rgba(245,158,11,0.14)",
      },
      animation: {
        "fade-in": "fadeIn 0.35s cubic-bezier(0.16,1,0.3,1)",
        "slide-up": "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
        "rise-in": "riseIn 0.32s cubic-bezier(0.16,1,0.3,1)",
        "scale-in": "scaleIn 0.18s cubic-bezier(0.16,1,0.3,1)",
        shimmer: "shimmer 1.6s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        riseIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "100% 0" },
          "100%": { backgroundPosition: "-100% 0" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
