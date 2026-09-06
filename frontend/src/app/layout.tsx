import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ApplicationBoundary } from "@/components/ApplicationBoundary";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ThemeProvider } from "@/lib/themeContext";

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
  themeColor: "#0a0c10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
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
