import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** A guest can only hold so many hearts in one session before it is abuse. */
const MAX_GUEST_SAVES = 100;

/** The in-session saves a guest brings with them at sign-in (US-DISC-03). */
export class MergeSavedEventsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: MAX_GUEST_SAVES,
    description: 'Ids that no longer resolve are dropped, not rejected',
  })
  @IsArray()
  @ArrayMaxSize(MAX_GUEST_SAVES)
  @IsUUID('4', { each: true })
  eventIds!: string[];
}

/** How many of the guest's saves were genuinely new to the account. */
export class MergeResultDto {
  @ApiProperty({ example: 3 })
  merged!: number;
}
