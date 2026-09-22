import { ApiProperty } from '@nestjs/swagger';
import { messageChannelEnum } from '../../../db/schema';
import {
  TEMPLATE_DELIVERY,
  type MessageChannel,
  type TemplateDelivery,
} from '../message-template-catalog';

/** What an organizer has written, per language. Null means "use Eventa's". */
export class TemplateWordingDto {
  @ApiProperty({ type: String, nullable: true })
  subjectEn!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bodyEn!: string | null;

  @ApiProperty({ type: String, nullable: true })
  subjectTh!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bodyTh!: string | null;
}

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
      'The channels this message actually goes out on. A channel is listed only once eventa-worker sends on it: today the registration confirmation is email and SMS, and every other message is email only. The organizer’s own wording applies to the email — a text is always in Eventa’s words.',
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
      'Whether this workspace has it switched on. Until a workspace chooses, each message is at its default — on, except the event reminder, which stays off until switched on.',
  })
  active!: boolean;

  @ApiProperty({
    type: [String],
    example: ['{{first_name}}', '{{event_name}}'],
    description:
      'Merge fields this message can fill. Empty for one nothing sends yet.',
  })
  tags!: string[];

  @ApiProperty({
    type: TemplateWordingDto,
    description:
      'The organizer’s own wording. A null means Eventa’s built-in copy is used — NOT that the message has no subject.',
  })
  wording!: TemplateWordingDto;
}
