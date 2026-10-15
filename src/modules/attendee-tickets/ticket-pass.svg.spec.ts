import { qrSvg } from '../../common/qr/qr';
import type { TicketPassDto } from './dto/my-events.dto';
import { renderPassSvg } from './ticket-pass.svg';

const PASS: TicketPassDto = {
  id: 't1',
  reference: 'ORD-ABCD1234',
  qrToken: 'token',
  status: 'issued',
  valid: true,
  holderName: 'Anan Suksawat',
  ticketLabel: 'General',
  admissionNumber: '1 of 2',
  eventName: 'Upcoming Meetup',
  eventSlug: 'upcoming-meetup',
  startAt: '2026-10-17T10:00:00.000Z',
  timezone: 'Asia/Bangkok',
  venueName: 'QSNCC',
  venueAddress: null,
  city: 'Bangkok',
  isOnline: false,
  seat: null,
};

/** The opening tag of the QR nested inside the pass. */
function nestedQrTag(svg: string): string {
  const tag = /<svg x="[^>]*>/.exec(svg);
  if (!tag) throw new Error('no nested QR');
  return tag[0];
}

/*
 * US-DISC-07: "download a printable pass". The QR generator writes its own
 * width and height, and placing it on the pass added a second pair, so every
 * pass was invalid XML: browsers drew nothing and refused the downloaded file.
 */
describe('renderPassSvg', () => {
  it('nests the QR with one width and one height, so the pass is valid SVG', async () => {
    const tag = nestedQrTag(renderPassSvg(PASS, await qrSvg('token')));

    expect(tag.match(/ width="/g)).toHaveLength(1);
    expect(tag.match(/ height="/g)).toHaveLength(1);
    expect(tag).toContain('width="440"');
    expect(tag).toContain('viewBox="0 0 ');
  });

  it('carries the event, reference and admission number', async () => {
    const svg = renderPassSvg(PASS, await qrSvg('token'));

    expect(svg).toContain('Upcoming Meetup');
    expect(svg).toContain('ORD-ABCD1234');
    expect(svg).toContain('Admission 1 of 2 · Anan Suksawat');
  });
});
