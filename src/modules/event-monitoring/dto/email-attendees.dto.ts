import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Body for "Email all attendees" (US-EVT-14). `confirm` makes the send explicit. */
export class EmailAttendeesDto {
  @ApiProperty({ minLength: 1, maxLength: 150, example: 'Doors open at 6pm' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  subject!: string;

  @ApiProperty({ minLength: 1, maxLength: 5000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;

  @ApiProperty({
    description:
      'Must be true — the organizer’s explicit confirmation to send.',
    example: true,
  })
  @Equals(true)
  confirm!: boolean;
}
