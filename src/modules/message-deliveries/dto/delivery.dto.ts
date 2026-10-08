import { ApiProperty } from '@nestjs/swagger';
import { deliveryStatusEnum, messageChannelEnum } from '../../../db/schema';
import type { DeliveryStatus } from '../message-deliveries.repository';

/** One message and what became of it (US-MSG-06). */
export class DeliveryDto {
  @ApiProperty({ example: '4821' })
  id!: string;

  @ApiProperty({
    example: 'registration-confirmation',
    description:
      'The catalog slug for an automated message, or `announcement` for a broadcast.',
  })
  kind!: string;

  @ApiProperty({ enum: messageChannelEnum.enumValues })
  channel!: string;

  @ApiProperty({ example: 'anong.p@gmail.com' })
  recipientEmail!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Anong Pattana' })
  recipientName!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  eventId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when the event has since been deleted.',
  })
  eventName!: string | null;

  @ApiProperty({
    enum: deliveryStatusEnum.enumValues,
    description:
      'What the transport said, and nothing more. There is no `delivered` and no `opened` — those need a provider webhook and a tracking pixel, and this product has neither.',
  })
  status!: DeliveryStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'smtp 550 mailbox unavailable',
    description: 'Why it failed. Null on a successful send.',
  })
  error!: string | null;

  @ApiProperty({ format: 'date-time', description: 'When it was sent, UTC.' })
  sentAt!: string;
}
