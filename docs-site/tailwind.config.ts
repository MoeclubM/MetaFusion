import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--bg-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        primary: "var(--primary-color)",
        "primary-hover": "var(--primary-hover-color)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Noto Sans SC", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        display: ["Instrument Serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
