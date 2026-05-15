import { useEffect } from "react";
import type { AppSettings } from "../types";

export function useAppTheme(settings?: AppSettings) {
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = () => {
      const prefersDark =
        typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", settings?.theme === "dark" || (settings?.theme === "system" && prefersDark));
    };

    applyTheme();
    root.dataset.density = settings?.density ?? "comfortable";
  }, [settings?.theme, settings?.density]);
}
