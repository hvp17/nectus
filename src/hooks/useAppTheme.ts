import { useEffect } from "react";
import type { AppSettings } from "../types";

export function useAppTheme(settings?: AppSettings) {
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings?.theme ?? "system";
    root.dataset.density = settings?.density ?? "comfortable";

    if (theme !== "system") {
      root.classList.toggle("dark", theme === "dark");
      return undefined;
    }

    const colorSchemeQuery =
      typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
    const applyTheme = () => {
      const prefersDark = colorSchemeQuery?.matches ?? false;
      root.classList.toggle("dark", prefersDark);
    };

    applyTheme();

    if (!colorSchemeQuery) {
      return undefined;
    }

    colorSchemeQuery.addEventListener("change", applyTheme);
    return () => colorSchemeQuery.removeEventListener("change", applyTheme);
  }, [settings?.theme, settings?.density]);
}
