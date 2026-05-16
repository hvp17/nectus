import { useEffect } from "react";
import type { AppSettings } from "../types";

export function useAppTheme(settings?: AppSettings) {
  useEffect(() => {
    const root = document.documentElement;
    const colorSchemeQuery =
      typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
    const applyTheme = () => {
      const prefersDark = colorSchemeQuery?.matches ?? false;
      root.classList.toggle("dark", settings?.theme === "dark" || (settings?.theme === "system" && prefersDark));
    };

    applyTheme();
    root.dataset.density = settings?.density ?? "comfortable";

    if (settings?.theme !== "system" || !colorSchemeQuery) {
      return undefined;
    }

    colorSchemeQuery.addEventListener("change", applyTheme);
    return () => colorSchemeQuery.removeEventListener("change", applyTheme);
  }, [settings?.theme, settings?.density]);
}
