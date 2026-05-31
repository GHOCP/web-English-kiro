/**
 * Placeholder home page so the app builds and runs. The real layout shell
 * (sidebar, search, TOC) and category/entry views arrive in later tasks.
 */
export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold">Lexical Resources System</h1>
      <p className="mt-2 text-muted">
        A bilingual English-Chinese lexical collection manager.
      </p>
      <ul className="mt-6 flex gap-4 text-sm font-medium">
        <li className="text-vocabulary">Vocabulary</li>
        <li className="text-accretion">Accretion</li>
        <li className="text-speaking">Speaking</li>
        <li className="text-writing">Writing</li>
      </ul>
    </main>
  );
}
