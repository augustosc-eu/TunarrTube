import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from "@/components/theme-constants";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "TunarrTube", template: "%s · TunarrTube" },
  description: "A local-first online-video companion for Tunarr"
};

// Runs before hydration so the correct theme is painted on first frame —
// avoids a flash of the wrong theme. Falls back to the system preference
// (handled by CSS media query) if localStorage is unavailable or empty.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var storage = window.localStorage;
    var stored = storage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var legacy = storage.getItem(${JSON.stringify(LEGACY_THEME_STORAGE_KEY)});
    if (legacy !== null) {
      if (stored === null) { stored = legacy; storage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, legacy); }
      storage.removeItem(${JSON.stringify(LEGACY_THEME_STORAGE_KEY)});
    }
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div className="shell">
          <Sidebar />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
