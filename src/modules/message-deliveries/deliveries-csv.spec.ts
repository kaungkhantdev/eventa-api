import { deliveriesCsv } from './deliveries-csv';
import type { DeliveryRow } from './message-deliveries.repository';

const row = (over: Partial<DeliveryRow> = {}): DeliveryRow => ({
  id: '1',
  kind: 'registration-confirmation',
  channel: 'email',
  recipientEmail: 'anong.p@gmail.com',
  recipientName: 'Anong Pattana',
  eventId: 'e-1',
  eventName: 'Tech Summit 2026',
  status: 'sent',
  error: null,
  sentAt: new Date('2026-07-09T03:24:00.000Z'),
  ...over,
});

describe('the delivery log as a file (US-MSG-07)', () => {
  it('keeps the full instant, which is what a mail server log is matched against', () => {
    const [line] = deliveriesCsv([row()]).rows;
    expect(line[0]).toBe('2026-07-09T03:24:00.000Z');
    expect(line[1]).toBe('2026-07-09 10:24');
  });

  it('gives the failure reason a column of its own', () => {
    const [line] = deliveriesCsv([
      row({ status: 'failed', error: 'smtp 550 mailbox unavailable' }),
    ]).rows;
    expect(line.at(-1)).toBe('smtp 550 mailbox unavailable');
  });

  it('leaves a successful send’s reason empty, not dashed', () => {
    // A dash is a word a spreadsheet cannot filter out.
    expect(deliveriesCsv([row()]).rows[0].at(-1)).toBe('');
  });

  it('leaves an unnamed recipient and a deleted event blank', () => {
    const [line] = deliveriesCsv([
      row({ recipientName: null, eventName: null }),
    ]).rows;
    expect(line[2]).toBe('');
    expect(line[5]).toBe('');
  });
});
