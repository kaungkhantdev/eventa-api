import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MAX_SEATS_PER_BOOKING } from '../../../common/booking/booking.limits';
import { AddRegistrationDto } from './add-registration.dto';

const booking = (quantity: unknown) => ({
  eventId: '5b0d7c43-5d1b-4b8e-9a4c-0f0f3c6a9a11',
  ticketTypeId: '2f6c1e0a-8b1d-4c3e-a7d2-6e9f4b1c2d33',
  quantity,
  name: 'Anan Suksawat',
  email: 'anan@example.com',
});

/** The messages the panel shows for the quantity field, as the API sends them. */
const quantityMessages = (quantity: unknown): string[] =>
  validateSync(plainToInstance(AddRegistrationDto, booking(quantity)))
    .filter((e) => e.property === 'quantity')
    .flatMap((e) => Object.values(e.constraints ?? {}));

/**
 * US-REG-03: "Given I request more than the allowed maximum of 8 seats in one
 * booking, when I try to save, then I'm asked to choose between 1 and 8
 * seats." The DTO refuses the quantity before the service's own wording is
 * ever reached, so the DTO has to carry that wording itself.
 */
describe('AddRegistrationDto quantity (US-REG-03)', () => {
  const ASK = `Choose between 1 and ${MAX_SEATS_PER_BOOKING} seats per booking.`;

  it('accepts a booking within the cap', () => {
    expect(quantityMessages(MAX_SEATS_PER_BOOKING)).toEqual([]);
  });

  it('asks for between 1 and 8 seats when more than 8 are requested', () => {
    expect(quantityMessages(MAX_SEATS_PER_BOOKING + 1)).toEqual([ASK]);
  });

  it('asks for between 1 and 8 seats when none are requested', () => {
    expect(quantityMessages(0)).toEqual([ASK]);
  });
});
