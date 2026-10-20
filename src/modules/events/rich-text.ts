import sanitizeHtml from 'sanitize-html';
import {
  ALLOWED,
  EMPTY_PARAGRAPH,
} from '../../common/constants/events.constants';

export function sanitizeDescription(html: string): string {
  const clean = sanitizeHtml(html, ALLOWED).trim();
  return EMPTY_PARAGRAPH.test(clean) ? '' : clean;
}
