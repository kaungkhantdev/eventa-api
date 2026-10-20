import { events } from '../../db/schema/index';
import { default as sanitizeHtml } from 'sanitize-html';

/** The events module's named constants. */

/** Keys are issued by the server, but they still arrive as input on confirm. */
export const MAX_KEY_LENGTH = 200;

export const LIVE_STATUSES = ['planned', 'upcoming', 'live'] as const;

/** An allocation of 0 means unlimited — mirrors `TicketingPolicy`. */
export const UNLIMITED = 0;

export const PERCENT = 100;

/** Routing key for an organizer's "Email all attendees" broadcast request. */
export const EVENTS_ATTENDEES_EMAIL_REQUESTED =
  'events.attendees_email_requested';

/** Routing key for a cancellation (consumed by eventa-worker: refunds, notices). */
export const EVENTS_CANCELLED = 'events.cancelled';

/** Routing key for the "event published" notice (consumed by eventa-worker). */
export const EVENTS_PUBLISHED = 'events.published';

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const DEFAULT_UPCOMING_LIMIT = 20;

export const MAX_UPCOMING_LIMIT = 100;

/** The `CheckoutEvent` projection, shared by the public and organizer lookups. */
export const CHECKOUT_EVENT_COLUMNS = {
  id: events.id,
  organizationId: events.organizationId,
  slug: events.slug,
  name: events.name,
  startAt: events.startAt,
  endAt: events.endAt,
  timezone: events.timezone,
  isOnline: events.isOnline,
  onlineNote: events.onlineNote,
  venueName: events.venueName,
  venueAddress: events.venueAddress,
  city: events.city,
  coverImage: events.coverImage,
  organizerName: events.organizerName,
  seatingMode: events.seatingMode,
  waitlistEnabled: events.waitlistEnabled,
  requiresApproval: events.requiresApproval,
};

/** Only a public event is buyable by an anonymous visitor. */
export const PUBLIC_VISIBILITY = 'public';

/** Slug used when a name carries no latin alphanumerics (e.g. a Thai-only name). */
export const EVENT_SLUG_FALLBACK = 'event';

/** Why an event with registrations or payment history is never hard-deleted. */
export const HAS_REGISTRATIONS =
  "This event has registrations and can't be deleted. Cancel it instead to refund and notify attendees.";

/** Postgres SQLSTATE for a delete that would orphan rows still referring to it. */
export const FOREIGN_KEY_VIOLATION = '23503';

/** Human phrase per publish requirement, listed back when one is missing. */
export const PUBLISH_REQUIREMENTS = {
  title: 'a title',
  description: 'a description',
  schedule: 'a start date & time',
  location: 'a venue or an online link',
  tickets: 'at least one ticket type',
} as const;

/** The reserved-seating refusal's key among the publish gaps (US-EVT-05). */
export const SEATING_GAP = 'seating' as const;

export const RESERVED_SEATING = 'reserved';

export const UNTYPED_SEATS = 'Give every seat a ticket type before publishing.';

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
export const ALLOWED: sanitizeHtml.IOptions = {
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
export const EMPTY_PARAGRAPH = /^(<p>(\s|<br\s*\/?>|&nbsp;)*<\/p>)+$/;
