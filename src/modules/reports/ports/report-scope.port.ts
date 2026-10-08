/**
 * What Reports needs in order to SAY what it was filtered to (US-RPT-11),
 * without reading the events table.
 *
 * Every other port here fetches a report's figures. This one fetches a single
 * word for the file's "Applied filters" line: an export filtered to one event
 * has to name that event, and `eventId` on the query is a UUID no reader can
 * check.
 *
 * Tenant-scoped like everything else, and deliberately answering `null` rather
 * than throwing for an id this workspace does not own — the file then says
 * "Selected event" instead of leaking another organization's event name.
 */
export abstract class ReportScopePort {
  abstract eventName(
    organizationId: number,
    eventId: string,
  ): Promise<string | null>;
}
