import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const storageKey = 'theme';

function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

/** Applies the theme to <html>; index.html runs the same logic before first paint. */
export function applyTheme(choice: ThemeChoice = readChoice()) {
  const dark = choice === 'dark' || (choice === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1f1d' : '#1B3834');
  return dark;
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    setDark(applyTheme(choice));
    if (choice !== 'system') return;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => setDark(applyTheme('system'));
    media?.addEventListener('change', onChange);
    return () => media?.removeEventListener('change', onChange);
  }, [choice]);
  const toggle = () => {
    const next: ThemeChoice = dark ? 'light' : 'dark';
    try { localStorage.setItem(storageKey, next); } catch { /* private mode */ }
    setChoice(next);
  };
  return { dark, toggle };
}
