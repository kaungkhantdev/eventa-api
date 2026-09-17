import { sanitizeDescription } from './rich-text';

/**
 * The event description is the one field an organizer writes as HTML and an
 * ATTENDEE loads on a public landing page. Everything dangerous is stripped
 * here, on write, so what the database holds is already safe for every reader —
 * this app, a future mobile client, an email. Nothing downstream re-checks.
 */
describe('sanitizeDescription', () => {
  describe('keeps what the editor can produce', () => {
    it.each([
      ['<p>Two days of talks.</p>'],
      ['<p><strong>Agenda</strong></p>'],
      ['<p><em>bring a laptop</em></p>'],
      ['<p><u>note</u></p>'],
      ['<p><s>cancelled</s></p>'],
      ['<blockquote>Doors at 08:30</blockquote>'],
      ['<ol><li>Introductions</li></ol>'],
      ['<ul><li>Coffee</li></ul>'],
      ['<h2>Welcome</h2>'],
      ['<p>line<br />break</p>'],
    ])('%s', (html) => {
      expect(sanitizeDescription(html)).toBe(html);
    });
  });

  describe('strips what could attack whoever opens the page', () => {
    it('removes a script outright, tag and body', () => {
      const out = sanitizeDescription('<p>hi</p><script>alert(1)</script>');
      expect(out).toBe('<p>hi</p>');
      expect(out).not.toContain('alert');
    });

    it('removes inline event handlers', () => {
      expect(sanitizeDescription('<p onclick="steal()">hi</p>')).toBe(
        '<p>hi</p>',
      );
    });

    it('removes a javascript: link but keeps the text', () => {
      const out = sanitizeDescription(
        '<a href="javascript:alert(1)">click</a>',
      );
      expect(out).not.toContain('javascript:');
      expect(out).toContain('click');
    });

    it('removes an iframe, so no page can be framed into an event', () => {
      expect(
        sanitizeDescription('<iframe src="https://evil.test"></iframe>'),
      ).toBe('');
    });

    /**
     * Dropped deliberately, not by oversight: Quill's image button inlines a
     * base64 data URI, which would blow the length limit on its own, and a
     * remote <img> on a public page is a tracking pixel for whoever is reading.
     * Covers go through the cover-image upload, which is checked.
     */
    it('removes images', () => {
      expect(
        sanitizeDescription('<p>a</p><img src="https://evil.test/px.gif" />'),
      ).toBe('<p>a</p>');
    });

    it('removes style attributes, which can position an overlay', () => {
      expect(sanitizeDescription('<p style="position:fixed">hi</p>')).toBe(
        '<p>hi</p>',
      );
    });
  });

  describe('links an attendee can trust', () => {
    it('keeps an http link and hardens the target', () => {
      const out = sanitizeDescription(
        '<a href="https://meetup.test/x">Details</a>',
      );
      expect(out).toContain('href="https://meetup.test/x"');
      // Opening in a new tab without this hands the opener to the target page.
      expect(out).toContain('rel="noopener noreferrer nofollow"');
      expect(out).toContain('target="_blank"');
    });
  });

  it('is empty for empty input, so a blank description stays null', () => {
    expect(sanitizeDescription('')).toBe('');
    expect(sanitizeDescription('<p><br /></p>')).toBe('');
  });
});
