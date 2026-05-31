import { describe, it, expect } from 'vitest';
import {
  markdownToPlainText,
  markdownToSnippet,
  sanitizeSchema,
  ALLOWED_TAG_NAMES,
} from './markdown';

/**
 * Unit tests for the Markdown library (Task 5).
 *
 * Covers the plain-text extraction helper used for FTS indexing / snippets
 * (Requirements 3.2, 6.3) and sanity-checks the restrictive sanitize schema
 * (NFR 4.1). The Property 10 (Markdown render safety) property-based test lives
 * in `src/components/Markdown.test.tsx`, where Markdown is rendered to HTML.
 *
 * Requirements: 3.2, 3.3, NFR 4.1
 */
describe('markdownToPlainText', () => {
  it('returns empty string for empty/whitespace input', () => {
    expect(markdownToPlainText('')).toBe('');
    expect(markdownToPlainText('   \n  ')).toBe('');
  });

  it('strips bold/italic formatting markers', () => {
    expect(markdownToPlainText('**bold** and *italic*')).toBe(
      'bold and italic',
    );
    expect(markdownToPlainText('__strong__ _em_')).toBe('strong em');
  });

  it('flattens lists into space-separated text', () => {
    const md = '- one\n- two\n- three';
    expect(markdownToPlainText(md)).toBe('one two three');
  });

  it('removes heading markers but keeps heading text', () => {
    expect(markdownToPlainText('# Title\n\nBody')).toBe('Title Body');
  });

  it('keeps link text and drops the URL', () => {
    expect(markdownToPlainText('see [docs](https://example.com)')).toBe(
      'see docs',
    );
  });

  it('preserves mixed English/Chinese content (UTF-8)', () => {
    expect(markdownToPlainText('**激发** to stimulate')).toBe(
      '激发 to stimulate',
    );
  });

  it('treats embedded raw HTML as inert text, not markup', () => {
    const out = markdownToPlainText('hello <script>alert(1)</script> world');
    // The text never executes; only readable text content remains.
    expect(out).not.toContain('<script>');
  });

  it('collapses internal whitespace and newlines to single spaces', () => {
    expect(markdownToPlainText('a\n\n\nb   c')).toBe('a b c');
  });
});

describe('markdownToSnippet', () => {
  it('returns the full text when within the limit', () => {
    expect(markdownToSnippet('**short** text', 100)).toBe('short text');
  });

  it('truncates long text and appends an ellipsis', () => {
    const long = 'word '.repeat(100).trim();
    const snippet = markdownToSnippet(long, 40);
    expect(snippet.length).toBeLessThanOrEqual(41); // 40 + ellipsis char
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('does not append an ellipsis at exactly the limit', () => {
    const text = 'abcdefghij'; // 10 chars
    expect(markdownToSnippet(text, 10)).toBe('abcdefghij');
  });
});

describe('sanitizeSchema', () => {
  it('allows only the safe formatting subset of tags', () => {
    expect(sanitizeSchema.tagNames).toEqual([...ALLOWED_TAG_NAMES]);
  });

  it('permits no attributes on any element', () => {
    expect(sanitizeSchema.attributes).toEqual({});
  });

  it('permits no URL protocols', () => {
    expect(sanitizeSchema.protocols).toEqual({});
  });

  it('does not allow comments or doctypes', () => {
    expect(sanitizeSchema.allowComments).toBe(false);
    expect(sanitizeSchema.allowDoctypes).toBe(false);
  });

  it('excludes dangerous tags from the allow-list', () => {
    const tags = sanitizeSchema.tagNames ?? [];
    for (const dangerous of ['script', 'iframe', 'img', 'a', 'style', 'svg']) {
      expect(tags).not.toContain(dangerous);
    }
  });
});
