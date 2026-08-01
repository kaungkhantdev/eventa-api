import { ApiProperty } from '@nestjs/swagger';

/** Live-event counts per bucket — powers the Active/Completed tab badges (US-EVT-01). */
export class EventsSummaryDto {
  @ApiProperty({ example: 12, description: 'Live events in the Active bucket' })
  active!: number;

  @ApiProperty({
    example: 4,
    description: 'Live events in the Completed bucket',
  })
  completed!: number;
}
