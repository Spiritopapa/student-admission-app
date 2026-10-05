import { createContext, useContext, useEffect, useState } from 'react';

const THEME_KEY = 'app-theme';
const ThemeContext = createContext(null);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  return ctx || { theme: 'light', toggleTheme: () => {}, setTheme: () => {} };
};

function systemPreference() {
  try {
    if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (err) {
    // ignore
  }
  return 'light';
}

/**
 * Global light/dark colour-theme provider.
 * - Persists the choice in localStorage ("app-theme").
 * - Applies it by toggling `data-theme="dark"` on <html>; the dark stylesheet
 *   in src/index.css is scoped to html[data-theme="dark"] so every page reuses
 *   the exact same Tailwind utility classes without adding `dark:` variants
 *   everywhere.
 * - Falls back to the OS preference the first time.
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (err) {
      // ignore
    }
    return systemPreference();
  });

  useEffect(() => {
    const root = document.documentElement;
    try {
      if (theme === 'dark') root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
      root.style.colorScheme = theme;
      localStorage.setItem(THEME_KEY, theme);
    } catch (err) {
      // ignore
    }
  }, [theme]);

  const setTheme = (next) => setThemeState(next === 'dark' ? 'dark' : 'light');
  const toggleTheme = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}