import { ApiProperty } from '@nestjs/swagger';
import { messageChannelEnum } from '../../../db/schema';
import {
  TEMPLATE_DELIVERY,
  type MessageChannel,
  type TemplateDelivery,
} from '../message-template-catalog';

/** One automated message, with this workspace's decision folded in. */
export class MessageTemplateDto {
  @ApiProperty({
    example: 'registration-confirmation',
    description: 'Stable identifier for the message and its trigger.',
  })
  slug!: string;

  @ApiProperty({ example: 'Registration confirmation' })
  title!: string;

  @ApiProperty({ description: 'What fires it, in the organizer’s words.' })
  description!: string;

  @ApiProperty({
    enum: messageChannelEnum.enumValues,
    isArray: true,
    description:
      'Email only for now — there is no SMS provider, and a badge for one would promise a channel nothing can deliver on.',
  })
  channels!: MessageChannel[];

  @ApiProperty({
    enum: TEMPLATE_DELIVERY,
    description:
      '`controlled` — sent, and the switch is honoured. `always` — sent regardless. `planned` — nothing sends it yet. Only `controlled` may be switched.',
  })
  delivery!: TemplateDelivery;

  @ApiProperty({
    description:
      'A message attendees are entitled to. US-MSG-02 asks for a confirmation before one of these is switched off.',
  })
  expected!: boolean;

  @ApiProperty({
    description:
      'Whether this workspace has it switched on. True unless switched off — a workspace that never opened these settings still sends its confirmations.',
  })
  active!: boolean;
}
