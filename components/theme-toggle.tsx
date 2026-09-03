"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "@/components/theme-constants";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => { setThemeState(currentTheme()); }, []);

  function setTheme(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* privacy mode: ignore */ }
    setThemeState(next);
  }

  const active = theme ?? "dark";
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(active === "dark" ? "light" : "dark")} aria-label={`Switch to ${active === "dark" ? "light" : "dark"} mode`}>
      {active === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      <span>{active === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
