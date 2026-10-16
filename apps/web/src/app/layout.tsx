import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/locale";
import { SyncBootstrap } from "./sync-bootstrap";

export const metadata: Metadata = {
  title: "Papyr — private notes, on your device",
  description: "A self-hosted, local-first notebook.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Papyr", statusBarStyle: "default" },
  icons: { apple: "/icons/papyr-192.png" },
};

export const viewport: Viewport = { themeColor: "#f5f3ee", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LocaleProvider>
          <SyncBootstrap />
          {children}
        </LocaleProvider>
        <script src="/register-sw.js" defer />
      </body>
    </html>
  );
}
