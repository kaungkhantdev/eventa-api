import sanitizeHtml from 'sanitize-html';

/**
 * The event description, made safe to render.
 *
 * This is the only field in the product an ORGANIZER authors as HTML and an
 * ATTENDEE loads — on a public landing page, unauthenticated. So it is cleaned
 * here, on write: what the database holds is already safe for every reader, and
 * no consumer has to remember to re-sanitise. A client-side clean would be
 * advice, not a control — anything can call the API directly.
 *
 * The allowlist is exactly what the wizard's editor can produce, and nothing
 * else. `img` and `iframe` are absent on purpose: Quill inlines images as
 * base64 (which alone would exceed the length limit), a remote image on a
 * public page is a tracking pixel aimed at whoever is reading, and a frame is
 * somebody else's page wearing this event's URL. Covers have their own upload,
 * which verifies the bytes.
 */
const ALLOWED: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'blockquote',
    'ol',
    'ul',
    'li',
    'h1',
    'h2',
    'h3',
    'a',
  ],
  allowedAttributes: {
    // `class` carries Quill's indent levels (`ql-indent-1`), and nothing else
    // is permitted through — `style` would let a paragraph be positioned over
    // the page's own controls.
    '*': ['class'],
    a: ['href', 'target', 'rel'],
  },
  allowedClasses: { '*': [/^ql-indent-[1-8]$/] },
  // http(s) and mailto only. `javascript:` and `data:` are the two that turn a
  // link into code or a download.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  transformTags: {
    // A link an attendee follows leaves this site: `noopener` denies the target
    // a handle on the opener, and `nofollow` stops an event page becoming an
    // SEO donation to whatever an organizer pastes.
    a: sanitizeHtml.simpleTransform('a', {
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
    }),
  },
  // Text outside any tag is kept; tags that are dropped take their content with
  // them only where the content is itself the payload.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
};

/** An editor that has been typed into and cleared still emits this. */
const EMPTY_PARAGRAPH = /^(<p>(\s|<br\s*\/?>|&nbsp;)*<\/p>)+$/;

export function sanitizeDescription(html: string): string {
  const clean = sanitizeHtml(html, ALLOWED).trim();
  return EMPTY_PARAGRAPH.test(clean) ? '' : clean;
}
