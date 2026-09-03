import Link from "next/link";
import { Database, Files, Gauge, ListVideo, ScrollText, Settings } from "lucide-react";

const links = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/sources", label: "Sources", icon: ListVideo },
  { href: "/videos", label: "Videos", icon: Files },
  { href: "/cache", label: "Cache", icon: Database },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link className="brand" href="/"><span className="brand-mark">YT</span> YTarr</Link>
      <nav className="nav" aria-label="Main navigation">
        {links.map(({ href, label, icon: Icon }) => (
          <Link href={href} key={href}><Icon size={17} /><span>{label}</span></Link>
        ))}
      </nav>
    </aside>
  );
}
