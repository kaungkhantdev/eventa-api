import { ApiProperty } from '@nestjs/swagger';

/** One upcoming paid order the deleter forfeits — tickets are non-refundable. */
export class UpcomingPaidOrderDto {
  @ApiProperty({ example: 'ORD-7K2M9QX4' })
  reference!: string;

  @ApiProperty({ example: 'Bangkok Tech Week' })
  eventName!: string;

  @ApiProperty({ format: 'date-time' })
  startAt!: string;

  @ApiProperty({ example: 2 })
  ticketCount!: number;

  @ApiProperty({ example: 188000, description: 'Integer satang' })
  totalSatang!: number;
}

/** The danger-zone preflight: what deleting the account walks away from. */
export class DeletionWarningDto {
  @ApiProperty({
    description: 'True when re-verification also needs an authenticator code',
  })
  requiresTwoFactorCode!: boolean;

  @ApiProperty({ type: [UpcomingPaidOrderDto] })
  upcomingPaidOrders!: UpcomingPaidOrderDto[];

  @ApiProperty({ example: 188000, description: 'Integer satang' })
  totalAtRiskSatang!: number;
}
