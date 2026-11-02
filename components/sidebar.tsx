"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Database, Files, Gauge, LayoutTemplate, ListChecks, ListVideo, Power, ScrollText, Settings } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/sources", label: "Sources", icon: ListVideo },
  { href: "/videos", label: "Videos", icon: Files },
  { href: "/channels", label: "Channels", icon: Clapperboard },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/jobs", label: "Queue", icon: ListChecks },
  { href: "/cache", label: "Cache", icon: Database },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings }
];

// Only offered when a desktop app started TunarrTube (see lib/system/quit.ts).
function QuitButton() {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<"idle" | "quitting" | "stopped" | "failed">("idle");

  useEffect(() => {
    fetch("/api/system/quit").then((response) => response.json()).then((body) => setAvailable(Boolean(body.data?.available))).catch(() => undefined);
  }, []);

  async function quit() {
    if (!window.confirm("Quit TunarrTube? Downloads and other running jobs stop and resume the next time you open it.")) return;
    setState("quitting");
    try {
      const response = await fetch("/api/system/quit", { method: "POST" });
      setState(response.ok ? "stopped" : "failed");
    } catch {
      setState("failed");
    }
  }

  if (!available) return null;
  return <>
    <button className="theme-toggle" type="button" onClick={quit} disabled={state === "quitting"} title="Quit TunarrTube"><Power size={17} /><span>Quit TunarrTube</span></button>
    {state === "stopped" && <div className="quit-overlay" role="alertdialog" aria-label="TunarrTube has stopped"><div className="card"><h2>TunarrTube has stopped</h2><p className="muted">You can close this tab. Open TunarrTube again from Applications or the Dock whenever you need it.</p></div></div>}
    {state === "failed" && <span className="meta error-text">Couldn&apos;t quit.</span>}
  </>;
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link className="brand" href="/"><BrandMark /> TunarrTube</Link>
      <nav className="nav" aria-label="Main navigation">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link href={href} key={href} aria-label={label} title={label} aria-current={active ? "page" : undefined}>
              <Icon size={17} /><span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <QuitButton />
        <ThemeToggle />
      </div>
    </aside>
  );
}
