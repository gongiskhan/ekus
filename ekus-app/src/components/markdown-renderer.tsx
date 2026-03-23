'use client';

import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function fixFileSrc(src: string | undefined): string {
  if (!src) return '';
  // Already a valid API or external URL
  if (src.startsWith('/api/') || src.startsWith('http')) return src;
  // Absolute file path containing uploads directory — extract relative path
  const uploadsMatch = src.match(/uploads\/(.+)$/);
  if (uploadsMatch) return `/api/uploads/${uploadsMatch[1]}`;
  // Relative upload path (e.g. "2026-03-20/abc.png" from upload API)
  if (!src.startsWith('/')) return `/api/uploads/${src}`;
  return src;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`markdown-content text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        rehypePlugins={[rehypeHighlight]}
        components={{
          img: ({ src, alt, ...props }) => (
            <img {...props} src={fixFileSrc(typeof src === 'string' ? src : undefined)} alt={alt || ''} loading="lazy" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
