import { useMemo } from 'react';
import { marked } from 'marked';

/**
 * 班级资源 markdown → HTML (styles in global.css under .md-body; font-family is
 * inherited so it fits both the IBM Plex admin pages and the Nunito classroom).
 * Content is authored by same-org teachers behind the login wall, so plain
 * marked output without a sanitizer is an accepted risk here.
 */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text, { async: false, gfm: true, breaks: true }), [text]);
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
