"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Database, Files, Gauge, LayoutTemplate, ListChecks, ListVideo, ScrollText, Settings } from "lucide-react";
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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link className="brand" href="/"><BrandMark /> TunarrTube</Link>
      <nav className="nav" aria-label="Main navigation">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link href={href} key={href} aria-current={active ? "page" : undefined}>
              <Icon size={17} /><span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>
  );
}
