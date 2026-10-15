import { ApiProperty } from '@nestjs/swagger';

/** Whether a booking's address already has an attendee account (US-DISC-15). */
export class BookingAccountDto {
  @ApiProperty({
    description:
      'True when an attendee account already uses the booking’s email — offer sign-in, never sign-up',
  })
  accountExists!: boolean;
}
