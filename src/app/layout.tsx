import type { Metadata } from 'next';
import Link from 'next/link';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Sidebar } from '@/components/Sidebar';
import { SearchBar } from '@/components/SearchBar';
import { ThemeToggle } from '@/components/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lexical Resources System',
  description: 'A bilingual (English-Chinese) lexical collection manager.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning is required by next-themes because it adjusts
    // the html class/style before React hydrates, preventing a theme flash.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {/* App shell: black-sidebar identity on the left, content on the
              right. On md+ the shell is pinned to the viewport height and the
              sidebar and content scroll INDEPENDENTLY (each is its own scroll
              container). Below md it collapses to a single normal-flow column
              with the sidebar as a hamburger overlay. */}
          <div className="flex min-h-screen flex-col md:h-screen md:flex-row md:overflow-hidden">
            {/* The Sidebar renders both the in-flow nav (md+) and the
                hamburger toggle (below md); it fetches the tree via SWR.
                maxDepth=1 shows top-level categories and their immediate children,
                but deeper levels are surfaced as in-content headers. */}
            <Sidebar maxDepth={1} />

            <div className="flex min-w-0 flex-1 flex-col md:h-screen md:overflow-hidden">
              <header className="flex shrink-0 items-center gap-4 border-b border-border bg-surface px-4 py-3">
                <Link
                  href="/"
                  className="shrink-0 text-base font-bold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  Lexical Resources
                </Link>
                <div className="flex-1">
                  <SearchBar />
                </div>
                <ThemeToggle />
              </header>

              {/* The content area scrolls on its own (md+), independent of the
                  sidebar; the header above stays fixed at the top. */}
              <main className="min-w-0 flex-1 overflow-y-auto p-6">
                {children}
              </main>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
