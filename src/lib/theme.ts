// The theme: light, dark or the system's, kept in the browser and applied as
// the `dark` class on <html>. The root route calls `initTheme` as soon as
// the app mounts; the document before that is the light default, and no
// inline script is used, which keeps the Content-Security-Policy at
// `script-src 'self'`.
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "yap.theme";
const THEMES: readonly Theme[] = ["light", "dark", "system"];
const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : "system";
  } catch {
    return "system";
  }
}

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? (media().matches ? "dark" : "light") : theme;
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  const dark = resolve(theme) === "dark";
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/** Applies the stored theme and follows the system while "system" is chosen. Call once before rendering. */
export function initTheme(): void {
  apply(stored());
  media().addEventListener("change", () => {
    if (stored() === "system") apply("system");
    for (const listener of listeners) listener();
  });
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The choice does not survive a reload in this browser; the page is still themed.
  }
  apply(theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen theme and the one in effect. */
export function useTheme(): { theme: Theme; resolved: "light" | "dark" } {
  const theme = useSyncExternalStore(subscribe, stored, () => "system" as Theme);
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolve(stored()),
    () => "light" as const,
  );
  return { theme, resolved };
}
