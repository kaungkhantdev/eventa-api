import { AttendanceReportService } from './attendance-report.service';
import type {
  AttendanceCounts,
  AttendancePage,
  AttendanceReportPort,
} from './ports/attendance-report.port';

/**
 * Attendance and no-shows (US-RPT-09).
 *
 * The counts come from the ticket read model; what is tested here is the part
 * that decides what a rate MEANS — including the two cases where the honest
 * answer is no rate at all.
 */

const NOW = new Date('2026-07-19T11:40:00.000Z');
const ORG = 42;

const counts = (over: Partial<AttendanceCounts> = {}): AttendanceCounts => ({
  eventId: 'e1',
  eventName: 'Tech Summit 2026',
  startAt: new Date('2026-07-10T02:00:00.000Z'),
  registered: 400,
  checkedIn: 320,
  onTime: 240,
  started: true,
  ...over,
});

function portReturning(page: Partial<AttendancePage> = {}) {
  const port: AttendanceReportPort = {
    attendanceByEvent: () =>
      Promise.resolve({
        rows: [counts()],
        matchedEvents: 1,
        totals: {
          registered: 400,
          checkedIn: 320,
          checkedInAll: 320,
          onTime: 240,
        },
        ...page,
      }),
  };
  return port;
}

const serviceWith = (port: AttendanceReportPort) =>
  new AttendanceReportService(port, { now: () => NOW });

describe('AttendanceReportService', () => {
  describe('one event’s row', () => {
    it('reports no-shows as registered less checked in', async () => {
      // The story's own example: 400 registered, 320 in, 80 missing.
      const view = await serviceWith(portReturning()).load(ORG, {});
      expect(view.rows[0].noShows).toBe(80);
      expect(view.rows[0].attendanceRate).toBe(80);
    });

    it('reports no rate for an event that has not started', async () => {
      // "—", not 0%: nobody could have been checked in yet, and a zero would
      // read as an event nobody turned up to.
      const port = portReturning({
        rows: [counts({ started: false, checkedIn: 0, onTime: 0 })],
      });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.rows[0].attendanceRate).toBeNull();
    });

    it('still reports the no-show count as unknown before the event', async () => {
      // Nobody has failed to turn up to an event that has not happened.
      const port = portReturning({
        rows: [counts({ started: false, checkedIn: 0, onTime: 0 })],
      });
      expect(
        (await serviceWith(port).load(ORG, {})).rows[0].noShows,
      ).toBeNull();
    });

    it('reports 0% for a finished event nobody attended', async () => {
      // This one IS zero, and saying so is the point of the report.
      const port = portReturning({
        rows: [counts({ started: true, checkedIn: 0, onTime: 0 })],
      });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.rows[0].attendanceRate).toBe(0);
      expect(view.rows[0].noShows).toBe(400);
    });

    it('gives no rate for an event with nothing registered', async () => {
      // A percentage of nothing is not 0%, it is undefined.
      const port = portReturning({
        rows: [counts({ registered: 0, checkedIn: 0, onTime: 0 })],
      });
      expect(
        (await serviceWith(port).load(ORG, {})).rows[0].attendanceRate,
      ).toBeNull();
    });

    it('measures on-time against those who came, not those who registered', async () => {
      // 240 of the 320 who arrived were on time: 75%, not 60%.
      const view = await serviceWith(portReturning()).load(ORG, {});
      expect(view.rows[0].onTimeRate).toBe(75);
    });

    it('gives no on-time rate when nobody came', async () => {
      const port = portReturning({
        rows: [counts({ checkedIn: 0, onTime: 0 })],
      });
      expect(
        (await serviceWith(port).load(ORG, {})).rows[0].onTimeRate,
      ).toBeNull();
    });
  });

  describe('the tiles', () => {
    it('rates attendance over started events only', async () => {
      // An event still to come would otherwise drag the workspace's rate down
      // with registrations that have had no chance to be used.
      const port = portReturning({
        totals: {
          registered: 400,
          checkedIn: 320,
          checkedInAll: 320,
          onTime: 240,
        },
      });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.totals.attendanceRate).toBe(80);
    });

    it('counts every check-in in the window, started or not', async () => {
      const port = portReturning({
        totals: {
          registered: 400,
          checkedIn: 320,
          checkedInAll: 335,
          onTime: 240,
        },
      });
      expect((await serviceWith(port).load(ORG, {})).totals.checkedIn).toBe(
        335,
      );
    });

    it('gives no overall rate when no event in the window has started', async () => {
      const port = portReturning({
        rows: [],
        totals: { registered: 0, checkedIn: 0, checkedInAll: 0, onTime: 0 },
      });
      const view = await serviceWith(port).load(ORG, {});
      expect(view.totals.attendanceRate).toBeNull();
      expect(view.totals.noShows).toBeNull();
    });

    it('answers a filter matching nothing without erroring', async () => {
      const port = portReturning({
        rows: [],
        matchedEvents: 0,
        totals: { registered: 0, checkedIn: 0, checkedInAll: 0, onTime: 0 },
      });
      const view = await serviceWith(port).load(ORG, { eventId: 'nope' });
      expect(view.rows).toEqual([]);
      expect(view.totals.checkedIn).toBe(0);
    });
  });
});
