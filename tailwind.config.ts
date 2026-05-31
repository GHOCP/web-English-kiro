import type { Config } from 'tailwindcss';

const config: Config = {
  // Toggle dark mode via the `class` strategy so `next-themes` can control it.
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Layout surfaces driven by CSS variables (see globals.css) so light
        // and dark themes share the same utility classes.
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        sidebar: 'var(--color-sidebar)',
        'sidebar-foreground': 'var(--color-sidebar-foreground)',
        foreground: 'var(--color-foreground)',
        muted: 'var(--color-muted)',
        border: 'var(--color-border)',
        // Category accent colors (red Vocabulary / purple Accretion /
        // green Speaking / blue Writing).
        vocabulary: 'var(--accent-vocabulary)',
        accretion: 'var(--accent-accretion)',
        speaking: 'var(--accent-speaking)',
        writing: 'var(--accent-writing)',
      },
    },
  },
  plugins: [],
};

export default config;
