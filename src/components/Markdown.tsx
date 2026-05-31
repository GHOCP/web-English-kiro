// Safe Markdown renderer.
//
// Renders stored Markdown content (definitions, examples, notes) to HTML while
// guaranteeing that only the safe formatting subset survives. All sanitization
// rules live in `sanitizeSchema` (src/lib/markdown.ts) so the component, the
// server, and the property tests share one source of truth.
//
// Security: `react-markdown` does NOT pass raw HTML through by default, and we
// additionally run `rehype-sanitize` with a restrictive schema. The result is
// that scripts, iframes, images, anchors, event-handler attributes and
// `javascript:` URLs cannot appear in the output, regardless of input.
//
// Requirements: 3.2, 3.3, NFR 4.1.
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { sanitizeSchema } from '@/lib/markdown';

export interface MarkdownProps {
  /** Raw Markdown source (may contain mixed English/Chinese text). */
  children: string;
  /** Optional wrapper class for layout/typography styling. */
  className?: string;
}

/**
 * Render sanitized Markdown. The output is limited to paragraphs, line breaks,
 * bold/italic emphasis, and lists; everything else is stripped.
 */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        // Disable raw HTML pass-through and sanitize the produced HAST. The
        // empty-attributes schema also strips any dangerous attributes.
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        // We do not register any custom HTML element components, so disallowed
        // tags simply do not render.
        skipHtml
      >
        {children ?? ''}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
