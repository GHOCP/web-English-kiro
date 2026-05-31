'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Wraps next-themes so the rest of the app can stay in Server Components.
 * Defaults to dark (preserving the legacy black-sidebar identity) and toggles
 * the `class` attribute on <html> for Tailwind's `dark:` variants.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
