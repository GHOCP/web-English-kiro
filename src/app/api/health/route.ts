// GET /api/health — container health check (Task 12).
//
// Runs a lightweight DB liveness probe (`SELECT 1`). Returns 200 with
// { status: 'ok', database: 'up' } when the connection is alive, or 503 with
// { status: 'error', database: 'down' } when it is not, so Docker / orchestrators
// can mark the container unhealthy. Wired as the Docker health check in Task 21.
//
// Requirements: 12.5
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getHealth } from '@/lib/health';

// Health must always reflect the live database state, never a cached response.
export const dynamic = 'force-dynamic';

export async function GET() {
  const { body, status } = await getHealth(prisma);
  return NextResponse.json(body, { status });
}
