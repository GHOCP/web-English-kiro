import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './Markdown';
import { ALLOWED_TAG_NAMES } from '@/lib/markdown';

/**
 * Property 10 — Markdown render safety.
 *
 * "For any stored `text`, the rendered output contains no executable script and
 * no disallowed HTML elements."
 *
 * We render the <Markdown> component to a static HTML string and assert that,
 * regardless of input (including adversarial XSS payloads), the output never
 * contains:
 *   - <script> / <iframe> / <object> / <embed> tags
 *   - inline event-handler attributes (on*=)
 *   - javascript: (or other dangerous) URLs
 *   - any HTML element outside the allowed safe subset
 *
 * **Validates: Requirements 3.2**
 * **Validates: Requirements 3.3**
 * **Validates: NFR 4.1**
 */

/** Render Markdown source to a static HTML string (no React runtime needed). */
function render(markdown: string): string {
  return renderToStaticMarkup(<Markdown>{markdown}</Markdown>);
}

/**
 * Assert the universal safety invariants by parsing the rendered HTML into a
 * real DOM and inspecting actual elements/attributes (not the serialized
 * string). This is the meaningful interpretation of Property 10: dangerous
 * *markup* must not survive. Adversarial text that ends up as escaped, visible
 * text content (e.g. the literal characters "javascript:" or "<script>") is
 * harmless because it cannot execute — only live elements and attributes can.
 *
 * The top-level wrapper <div> emitted by the component is the only tag allowed
 * in addition to the safe Markdown subset.
 */
function assertSafe(html: string): void {
  const container = document.createElement('div');
  // jsdom does not execute scripts inserted via innerHTML, but it DOES
  // materialize them as elements — so if anything dangerous survived, the
  // structural checks below would catch it.
  container.innerHTML = html;

  // No executable / framing / style / vector elements anywhere in the output.
  expect(
    container.querySelector(
      'script, iframe, object, embed, style, svg, img, a, link, meta',
    ),
  ).toBeNull();

  const allowed = new Set<string>([...ALLOWED_TAG_NAMES, 'div']);
  const elements = container.querySelectorAll('*');
  elements.forEach((el) => {
    // Every surviving element must be in the safe allow-list.
    expect(allowed.has(el.tagName.toLowerCase())).toBe(true);

    // The restrictive schema strips ALL attributes; in particular there must be
    // no event handlers and no javascript:/data:text/html URLs.
    Array.from(el.attributes).forEach((attr) => {
      expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      expect(/javascript:/i.test(attr.value)).toBe(false);
      expect(/data:text\/html/i.test(attr.value)).toBe(false);
    });
  });
}

describe('Property 10: Markdown render safety', () => {
  it('strips known XSS payloads (regression examples)', () => {
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      '<a href="javascript:alert(1)">x</a>',
      '<iframe src="https://evil.example"></iframe>',
      '<div onclick="steal()">hi</div>',
      '<svg/onload=alert(1)>',
      '<object data="javascript:alert(1)"></object>',
      '<embed src="evil.swf">',
      '![x](javascript:alert(1))',
      '<style>body{display:none}</style>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      '<<script>script>alert(1)<</script>/script>',
      '`<script>alert(1)</script>`',
    ];
    for (const payload of payloads) {
      assertSafe(render(payload));
    }
  });

  it('preserves the safe formatting subset', () => {
    const html = render('**bold** _italic_\n\n- a\n- b\n\n1. x\n2. y');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>');
    assertSafe(html);
  });

  it('holds for arbitrary unicode strings', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (input) => {
        assertSafe(render(input));
      }),
      { numRuns: 500 },
    );
  });

  it('holds for adversarial payloads assembled from dangerous fragments', () => {
    const fragment = fc.constantFrom(
      '<script>',
      '</script>',
      'alert(1)',
      '<img src=x onerror=alert(1)>',
      'javascript:',
      'onerror=',
      'onclick=',
      'onload=',
      '<iframe>',
      '</iframe>',
      '<svg onload=alert(1)>',
      '[x](javascript:alert(1))',
      '![y](javascript:alert(1))',
      '<a href="javascript:void(0)">',
      'data:text/html,',
      '<style>',
      '**bold**',
      '_em_',
      '- item',
      '\n\n',
      '> quote',
      '# heading',
      '<div onmouseover=x>',
      '"',
      "'",
      '<',
      '>',
    );
    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 30 }), (parts) => {
        assertSafe(render(parts.join('')));
      }),
      { numRuns: 500 },
    );
  });
});
