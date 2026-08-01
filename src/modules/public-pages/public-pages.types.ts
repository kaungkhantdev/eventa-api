/** Everything the public page renders (US-PAGE-01…06). Anonymous, read-only. */
export interface PublicPage {
  event: PublicEvent;
  highlights: PublicHighlight[];
  agenda: PublicSession[];
  speakers: PublicSpeaker[];
  tickets: PublicTicket[];
  faqs: PublicFaq[];
  registration: RegistrationState;
  sections: SectionTitles;
  share: ShareMeta;
}

export interface PublicEvent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
  categoryName: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string;
  isOnline: boolean;
  /** How the join link arrives — the link itself is NEVER public. */
  onlineNote: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  coverImage: string | null;
  accentColor: string;
  organizerName: string;
  template: string;
  locale: string;
}

export interface PublicHighlight {
  text: string;
  icon: string | null;
}

export interface PublicSession {
  title: string;
  /** Which day of a multi-day event (1-based), as the organizer arranged it. */
  day: number;
  /** Clock times in the event's timezone, e.g. "09:30". */
  startTime: string;
  endTime: string | null;
  type: string;
  room: string | null;
  speakerNames: string[];
}

export interface PublicSpeaker {
  name: string;
  /** Their job role, e.g. "Head of Engineering". */
  role: string | null;
  /** The talk they give, when the organizer recorded one. */
  talkTitle: string | null;
  /** Rendered as an avatar fallback — there is no photo column. */
  initials: string | null;
  tone: string | null;
}

export interface PublicTicket {
  id: string;
  name: string;
  /** Formatted, VAT-inclusive: "฿1,070", "Free" or "RSVP". */
  priceLabel: string;
  priceSatang: number;
  isFree: boolean;
  includes: string[];
  isRecommended: boolean;
  badge: string | null;
  soldOut: boolean;
  /** Set only when stock is low — "Going fast — only 3 left". */
  urgency: string | null;
  /** False when sold out or registration is closed. */
  canRegister: boolean;
}

export interface PublicFaq {
  question: string;
  answer: string;
}

export interface RegistrationState {
  open: boolean;
  /** Why it isn't open, for the disabled button's hint. */
  reason: string | null;
}

export interface SectionTitles {
  agenda: string;
  speakers: string;
}

/** Rich-card + sharing metadata (US-PAGE-08). */
export interface ShareMeta {
  title: string;
  description: string;
  image: string | null;
  url: string;
  /** True for previews and unpublished pages — never index those. */
  noIndex: boolean;
}
