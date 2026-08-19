/** What the attendee asked their saved list for. */
export interface SavedEventsQuery {
  page?: number;
  limit?: number;
}

/** Offset paging, resolved and clamped, as the repository wants it. */
export interface SavedEventsPage {
  limit: number;
  offset: number;
}
