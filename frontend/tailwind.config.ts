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
      borderRadius: {
        card: "8px",
        hero: "10px",
        chip: "4px",
        tech: "6px",
        pill: "9999px",
      },
      boxShadow: {
        soft: "0 8px 24px -8px rgba(0,0,0,0.4)",
        elevated: "0 16px 48px -12px rgba(0,0,0,0.55)",
        glow: "0 2px 20px rgba(59,130,246,0.12)",
        "glow-amber": "0 2px 20px rgba(245,158,11,0.14)",
      },
      animation: {
        "fade-in": "fadeIn 0.35s cubic-bezier(0.16,1,0.3,1)",
        "slide-up": "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
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
