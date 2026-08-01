import { ApiProperty } from '@nestjs/swagger';
import { paymentStatusEnum } from '../../../../db/schema';

/** One row of the Registrations tab (attendee PII is gated behind regView). */
export class RegistrationRowDto {
  @ApiProperty({ example: 'ORD-2026-000045' })
  reference!: string;

  @ApiProperty({ example: 'Somchai P.' })
  attendeeName!: string;

  @ApiProperty({ example: 2, description: 'Tickets in this registration' })
  tickets!: number;

  @ApiProperty({ example: 89000, description: 'Order total in satang' })
  amountSatang!: number;

  @ApiProperty({ enum: paymentStatusEnum.enumValues, example: 'paid' })
  paymentStatus!: string;

  @ApiProperty({ format: 'date-time' })
  registeredAt!: string;
}

/** Per-payment-status counts driving the Registrations tab badges. */
export class RegistrationStatusCountsDto {
  @ApiProperty({ example: 42 })
  all!: number;

  @ApiProperty({ example: 30 })
  paid!: number;

  @ApiProperty({ example: 10 })
  pending!: number;

  @ApiProperty({ example: 2 })
  refunded!: number;
}

/** The Registrations tab payload: a page of rows plus the status badge counts. */
export class RegistrationsPageDto {
  @ApiProperty({ type: [RegistrationRowDto] })
  items!: RegistrationRowDto[];

  @ApiProperty({ type: RegistrationStatusCountsDto })
  statusCounts!: RegistrationStatusCountsDto;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}
