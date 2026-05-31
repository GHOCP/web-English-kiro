import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePage, validateImportDocument } from '@/lib/migration';

const HTMLS = join(process.cwd(), 'htmls');

function countEntries(cats: { entries: unknown[]; children: any[] }[]): number {
  let n = 0;
  for (const c of cats) {
    n += c.entries.length;
    n += countEntries(c.children);
  }
  return n;
}

describe('real legacy page smoke test', () => {
  it('parses index02-thesaurus and produces a valid document', () => {
    const html = readFileSync(join(HTMLS, 'index02-thesaurus/index.html'), 'utf8');
    const { document, warnings } = parsePage(html, { categoryName: 'Thesaurus', pageType: 'thesaurus' });
    expect(validateImportDocument(document).success).toBe(true);
    const n = countEntries(document.categories);
    console.log('thesaurus entries:', n, 'warnings:', warnings.length);
    console.log('POS groups:', document.categories[0].children.map((c) => `${c.name}(${c.partOfSpeech})`));
    expect(n).toBeGreaterThan(100);
  });

  it('parses index03-words_by_genres and produces a valid document with images', () => {
    const html = readFileSync(join(HTMLS, 'index03-words_by_genres/index.html'), 'utf8');
    const { document, warnings } = parsePage(html, { categoryName: 'Words by genres', pageType: 'genre' });
    expect(validateImportDocument(document).success).toBe(true);
    const n = countEntries(document.categories);
    let images = 0;
    const walk = (cats: any[]) => cats.forEach((c) => { c.entries.forEach((e: any) => (images += e.images.length)); walk(c.children); });
    walk(document.categories);
    console.log('genre entries:', n, 'images:', images, 'warnings:', warnings.length);
    expect(n).toBeGreaterThan(50);
    expect(images).toBeGreaterThan(10);
  });

  it('parses index04-words_look_around and produces a valid document', () => {
    const html = readFileSync(join(HTMLS, 'index04-words_look_around/index.html'), 'utf8');
    const { document, warnings } = parsePage(html, { categoryName: 'Look-around', pageType: 'look-around' });
    expect(validateImportDocument(document).success).toBe(true);
    const n = countEntries(document.categories);
    console.log('look-around entries:', n, 'warnings:', warnings.length);
    console.log('topics:', document.categories[0].children.map((c) => c.name));
    expect(n).toBeGreaterThan(5);
  });
});
