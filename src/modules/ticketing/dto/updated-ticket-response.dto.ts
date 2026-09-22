import { ApiProperty } from '@nestjs/swagger';
import { TicketResponseDto } from './ticket-response.dto';

/** A ticket tier just edited, and what its new places did for the waitlist. */
export class UpdatedTicketResponseDto extends TicketResponseDto {
  @ApiProperty({
    example: 2,
    description:
      'Waitlisted registrations given a place by this change, in line order (US-REG-04): paid ones held for the offer window and sent the offer, free ones confirmed. 0 when the allocation did not rise, the event has no open general-admission waitlist, the event requires approval (a place there is for the organizer to decide on, offering it by hand from the waitlist), nobody is waiting, or the person at the front wants more than is free.',
  })
  waitlistOffered!: number;
}
