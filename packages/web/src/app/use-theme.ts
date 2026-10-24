import { useEffect, useState, type SetStateAction } from 'react';
function systemTheme() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  } catch {
    return false;
  }
}
export function useTheme() {
  const [preference, setPreference] = useState<'light' | 'dark' | null>(() => {
    try {
      const saved = localStorage.getItem('hcd.theme');
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch {
      return null;
    }
  });
  const [systemDark, setSystemDark] = useState(systemTheme);
  const dark = preference ? preference === 'dark' : systemDark;
  useEffect(() => {
    try {
      const query = window.matchMedia?.('(prefers-color-scheme: dark)');
      if (!query) return;
      const update = () => setSystemDark(query.matches);
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    } catch {
      /* MatchMedia may be unavailable in embedded browsers. */
    }
  }, []);
  useEffect(() => {
    if (preference) document.documentElement.dataset.theme = preference;
    else delete document.documentElement.dataset.theme;
  }, [preference]);
  const setDark = (value: SetStateAction<boolean>) => {
    const next = (typeof value === 'function' ? value(dark) : value) ? 'dark' : 'light';
    setPreference(next);
    try {
      localStorage.setItem('hcd.theme', next);
    } catch {
      /* Reading remains available without storage. */
    }
  };
  return { dark, setDark };
}
