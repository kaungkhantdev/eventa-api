import { ApiProperty } from '@nestjs/swagger';
import { issuedTicketStatusEnum } from '../../../db/schema';

/** One registration card in My Events (US-DISC-09). */
export class MyRegistrationDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'ORD-7K2M9QX4' })
  reference!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({
    example: 'bangkok-tech-week',
    description: 'Links to the event page',
  })
  eventSlug!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timezone!: string;

  @ApiProperty({ nullable: true, type: String })
  venueName!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Street address — what a map needs to place the venue; a name alone rarely resolves',
  })
  venueAddress!: string | null;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({ nullable: true, type: String })
  coverImage!: string | null;

  @ApiProperty({ example: 'General', nullable: true, type: String })
  ticketTypeName!: string | null;

  @ApiProperty({ example: 2 })
  ticketCount!: number;

  @ApiProperty({
    example: '6 days left',
    nullable: true,
    type: String,
    description: "'Today', 'Tomorrow' or 'N days left'; null for past events",
  })
  countdown!: string | null;

  @ApiProperty({
    description: 'True once a ticket was scanned at the door (E8)',
  })
  attended!: boolean;
}

export class MyEventsCountsDto {
  @ApiProperty({ example: 2 })
  upcoming!: number;

  @ApiProperty({ example: 5 })
  past!: number;
}

/** The whole My Events view: both sections at once, each with its count. */
export class MyEventsDto {
  @ApiProperty({ type: [MyRegistrationDto], description: 'Soonest first' })
  upcoming!: MyRegistrationDto[];

  @ApiProperty({ type: [MyRegistrationDto], description: 'Most recent first' })
  past!: MyRegistrationDto[];

  @ApiProperty({ type: MyEventsCountsDto })
  counts!: MyEventsCountsDto;
}

export class TicketSeatDto {
  @ApiProperty({ nullable: true, type: String })
  section!: string | null;

  @ApiProperty({ nullable: true, type: String })
  row!: string | null;

  @ApiProperty({ nullable: true, type: String })
  number!: string | null;
}

/** One ticket, as the pass screen shows it (US-DISC-07). */
export class TicketPassDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ORD-7K2M9QX4' })
  reference!: string;

  @ApiProperty({
    example: 'K7M2Q9XW4RT8V3NP6JHY5CBD',
    description: 'What the QR encodes — the bearer credential for the door',
  })
  qrToken!: string;

  @ApiProperty({ enum: issuedTicketStatusEnum.enumValues })
  status!: string;

  @ApiProperty({ description: 'False once refunded, voided or transferred' })
  valid!: boolean;

  @ApiProperty({ nullable: true, type: String })
  holderName!: string | null;

  @ApiProperty({ example: 'VIP', nullable: true, type: String })
  ticketLabel!: string | null;

  @ApiProperty({
    example: '2 of 3',
    description: 'Admission number within the order',
  })
  admissionNumber!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ example: 'bangkok-tech-week' })
  eventSlug!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ example: 'Asia/Bangkok' })
  timezone!: string;

  @ApiProperty({ nullable: true, type: String })
  venueName!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Street address — what a map needs to place the venue; a name alone rarely resolves',
  })
  venueAddress!: string | null;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;

  @ApiProperty()
  isOnline!: boolean;

  @ApiProperty({ type: TicketSeatDto, nullable: true })
  seat!: TicketSeatDto | null;
}
