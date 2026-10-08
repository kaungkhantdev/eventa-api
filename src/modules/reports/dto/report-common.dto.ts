import { ApiProperty } from '@nestjs/swagger';

/**
 * The two shapes every report shares (US-RPT-01/02).
 *
 * In their own module deliberately. They lived in the report DTOs that happened
 * to need them first, and once each report gained a change chip the files
 * imported each other — a cycle `tsc` is perfectly happy with and Swagger is
 * not: building the document throws "a circular dependency has been detected"
 * and the API refuses to boot. Nothing here imports a sibling, so that cannot
 * happen again.
 */

/** The window a report covered, echoed back so the reader knows what they got. */
export class ReportPeriodDto {
  @ApiProperty({
    example: '2026-01-01',
    description: 'Bangkok day, inclusive.',
  })
  from!: string;

  @ApiProperty({
    example: '2026-07-19',
    description: 'Bangkok day, inclusive.',
  })
  to!: string;

  @ApiProperty({ example: 200 })
  days!: number;

  @ApiProperty({
    example: false,
    description:
      'The span asked for exceeded the 24-month limit and was cut back to it.',
  })
  trimmed!: boolean;
}

/** How a figure moved against the previous equal period. */
export class PeriodChangeDto {
  @ApiProperty({ enum: ['up', 'down', 'flat'] })
  direction!: 'up' | 'down' | 'flat';

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Null where no honest percentage exists — a baseline of zero is “new”, not “+∞%”. Render “—”.',
  })
  percent!: number | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Whether the movement is GOOD for this metric — a falling refund rate is an improvement. Null when flat, or when nothing could be compared.',
  })
  improved!: boolean | null;
}
