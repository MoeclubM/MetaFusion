import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/authContext";
import { AuthGate } from "@/components/AuthGate";
import { PlayerProvider } from "@/lib/playerContext";
import { GlobalAudioPlayer } from "@/components/GlobalAudioPlayer";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ThemeProvider } from "@/lib/themeContext";
import { ConditionalFooter } from "@/components/ConditionalFooter";

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
            <AuthProvider>
              <AuthGate>
                <PlayerProvider>
                  {children}
                  <GlobalAudioPlayer />
                  <ConditionalFooter />
                </PlayerProvider>
              </AuthGate>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
