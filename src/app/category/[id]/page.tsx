// Category content page (Task 19, R11.1/R11.4/R11.5, R5.4).
//
// A Server Component that fetches the category's page data DIRECTLY from the
// database via the lib layer (no HTTP round-trip) for a fast first paint
// (design Q4, R11.1). An invalid id or a missing category renders the framework
// 404 via `notFound()`. The fetched data is handed to the client `CategoryView`
// wrapper, which hydrates SWR for client-side caching/interactivity (R11.4) and
// picks the correct read view by `viewType`.
//
// Requirements: 11.1, 11.4, 11.5, 5.4
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCategoryPageData } from '@/lib/pageData';
import { CategoryView } from '@/components/CategoryView';

// The collection changes at runtime (CRUD), so render on demand, not at build.
export const dynamic = 'force-dynamic';

interface CategoryPageProps {
  params: { id: string };
}

/** Parse the `:id` route param into a positive integer, or `null` if invalid. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const id = parseId(params.id);
  if (id === null) notFound();

  const data = await getCategoryPageData(prisma, id);
  if (!data) notFound();

  return <CategoryView id={id} initialData={data} />;
}
