import { ApiProperty } from '@nestjs/swagger';

/** A neutral, human-readable acknowledgement (no account details leaked). */
export class MessageResponseDto {
  @ApiProperty({ example: 'If an account matches, a link is on its way.' })
  message!: string;
}
