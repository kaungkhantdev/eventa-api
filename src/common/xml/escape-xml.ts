/**
 * Escape a stored string for interpolation into SVG/XML markup. Organizer
 * names, event titles and buyer names are user data, not markup — a `&` in
 * "Barnes & Co" would otherwise produce a document no parser will open, and an
 * angle bracket would let stored text rewrite the page around it.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
