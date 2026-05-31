// Theme toggle (Task 13, Q14).
//
// Accessible button that switches between the light and dark themes via
// `next-themes`. The app defaults to dark (preserving the legacy black-sidebar
// identity); this lets the owner switch to the clean light variant. The choice
// is persisted by `next-themes` (localStorage) and applied before paint by the
// provider, so there is no theme flash on reload.
//
// Hydration: `next-themes` only knows the resolved theme on the client, so we
// guard with a `mounted` flag and render a stable, inert placeholder during SSR
// / first paint. This prevents a hydration mismatch between server and client
// markup (NFR 2.x accessibility/robustness).
//
// Requirements: 5.x (layout shell), NFR 2.1, NFR 2.2, NFR 2.4
'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

/** Sun icon shown in dark mode (click → switch to light). */
function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

/** Moon icon shown in light mode (click → switch to dark). */
function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const BUTTON_CLASS =
  'inline-flex h-9 w-9 items-center justify-center rounded-md border ' +
  'border-border text-foreground transition-colors ' +
  'hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-writing';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // After mount we can trust `resolvedTheme`. Until then render an inert
  // placeholder with identical dimensions to avoid layout shift / mismatch.
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        className={BUTTON_CLASS}
        aria-label="Toggle theme"
        aria-hidden="true"
        tabIndex={-1}
        disabled
      />
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      className={BUTTON_CLASS}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export default ThemeToggle;
