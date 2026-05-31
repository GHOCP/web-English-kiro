// JSON export serializer (R8.2).
//
// Produces the round-trippable `ExportDocument` shape as a pretty-printed JSON
// string. `JSON.stringify` preserves every text field byte-for-byte (Unicode,
// mixed English/Chinese, Markdown markers, embedded newlines) via reversible
// escaping, which is what makes JSON the canonical round-trip format
// (Property 3 — full inverse validated in Task 14 once import exists).
//
// Requirements: 8.2, 8.5
import type { ExportDocument } from '@/types';

/** Serialize an {@link ExportDocument} to a pretty-printed JSON string. */
export function serializeJson(doc: ExportDocument): string {
  return JSON.stringify(doc, null, 2);
}
