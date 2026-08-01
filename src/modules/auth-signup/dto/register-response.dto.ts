import { ApiProperty } from '@nestjs/swagger';

/** Neutral sign-up acknowledgement — identical whether or not the email existed. */
export class RegisterResponseDto {
  @ApiProperty({
    example: 'Check your inbox to confirm your email and finish signing up.',
  })
  message!: string;
}
