import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ApplicationBoundary } from "@/components/ApplicationBoundary";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ThemeProvider } from "@/lib/themeContext";
import { DEFAULT_ACCENT, DEFAULT_TONE } from "@/lib/theme.generated";

export const metadata: Metadata = {
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  title: "MetaFusion",
  description: "MetaFusion",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0b0f17",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="dark"
      data-theme-mode="dark"
      data-theme-accent={DEFAULT_ACCENT}
      data-theme-tone={DEFAULT_TONE}
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content="#0b0f17" />
        {/* 首帧前同步应用主题：见 public/theme-boot.js（静态文件，无需内联拼字符串） */}
        <script src="/theme-boot.js" />
      </head>
      <body className="font-sans min-h-screen bg-background text-gray-100 flex flex-col antialiased">
        <ThemeProvider>
          <I18nProvider>
            <ApplicationBoundary>{children}</ApplicationBoundary>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
