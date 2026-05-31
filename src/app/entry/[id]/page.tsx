// Single entry page (Task 19, R2.4, R11.1).
//
// A Server Component that loads the fully-populated entry DIRECTLY from the
// database via the lib layer (no HTTP round-trip) for a fast first paint
// (R11.1). An invalid id or a missing entry renders the framework 404 via
// `notFound()` (R2). The entry is handed to the client `EntryDetail` wrapper,
// which hydrates SWR for caching/interactivity and hosts the in-place editor.
//
// Requirements: 2.4, 11.1
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getEntryPageData } from '@/lib/pageData';
import { EntryDetail } from '@/components/EntryDetail';

export const dynamic = 'force-dynamic';

interface EntryPageProps {
  params: { id: string };
}

/** Parse the `:id` route param into a positive integer, or `null` if invalid. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function EntryPage({ params }: EntryPageProps) {
  const id = parseId(params.id);
  if (id === null) notFound();

  const entry = await getEntryPageData(prisma, id);
  if (!entry) notFound();

  return <EntryDetail id={id} initialEntry={entry} />;
}
