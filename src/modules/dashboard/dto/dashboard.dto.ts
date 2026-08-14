import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const RANGES = ['week', 'month', 'year'] as const;
export const LANGUAGES = ['en', 'th'] as const;
const MAX_NAME = 120;

export class HomeQueryDto {
  @ApiPropertyOptional({ enum: LANGUAGES, default: 'en' })
  @IsOptional()
  @IsIn([...LANGUAGES])
  language?: (typeof LANGUAGES)[number];

  @ApiPropertyOptional({
    description:
      'Who to greet. Falls back to the signed-in user’s own name when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NAME)
  name?: string;
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: RANGES,
    default: 'year',
    description: 'The revenue toggle (US-DASH-09). Defaults to the year view.',
  })
  @IsOptional()
  @IsIn([...RANGES])
  range?: (typeof RANGES)[number];
}

class ChangeDto {
  @ApiProperty({ enum: ['up', 'down', 'flat'] })
  direction!: 'up' | 'down' | 'flat';

  @ApiProperty({
    nullable: true,
    description: 'Null when there is no baseline to compute a change from.',
  })
  percent!: number | null;

  @ApiProperty({ nullable: true, description: 'Null when flat.' })
  improved!: boolean | null;
}

class KpiDto {
  @ApiProperty({
    nullable: true,
    description: 'Null is the empty state — never a misleading zero.',
  })
  value!: number | null;

  @ApiProperty({ type: ChangeDto })
  change!: ChangeDto;
}

class FeedItemDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  attendeeName!: string;

  @ApiProperty()
  eventName!: string;

  @ApiProperty({ nullable: true })
  ticketTypeName!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Integer satang. Null when the caller may not see money.',
  })
  totalSatang!: number | null;

  @ApiProperty()
  paymentStatus!: string;

  @ApiProperty({ format: 'date-time' })
  registeredAt!: Date;
}

class AlertDto {
  @ApiProperty({
    enum: ['declined_payments', 'pending_approvals', 'selling_out'],
  })
  kind!: string;

  @ApiProperty({ enum: ['critical', 'warning', 'info'] })
  severity!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty({ description: 'Bilingual EN/TH.' })
  message!: { en: string; th: string };

  @ApiProperty({ description: 'Where to resolve it — never resolved here.' })
  href!: string;
}

class AlertsDto {
  @ApiProperty({ type: [AlertDto], description: 'Most urgent first.' })
  alerts!: AlertDto[];

  @ApiProperty({ nullable: true })
  emptyMessage!: string | null;
}

class TodayDto {
  @ApiProperty()
  count!: number;

  @ApiProperty({ type: [FeedItemDto] })
  recent!: FeedItemDto[];

  @ApiProperty({ nullable: true })
  emptyMessage!: string | null;
}

export class HomeDto {
  @ApiProperty({ example: 'Good afternoon, Anan' })
  greeting!: string;

  @ApiProperty({
    type: TodayDto,
    nullable: true,
    description: 'Null when the caller may not see attendee personal data.',
  })
  today!: TodayDto | null;

  @ApiProperty({ type: AlertsDto })
  alerts!: AlertsDto;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: Date;
}

class RevenuePointDto {
  @ApiProperty({ format: 'date-time' })
  at!: Date;

  @ApiProperty({ description: 'Integer satang, net of VAT and refunds.' })
  netSatang!: number;
}

class RevenueTrendDto {
  @ApiProperty({ enum: RANGES })
  range!: string;

  @ApiProperty()
  totalSatang!: number;

  @ApiProperty({ type: ChangeDto })
  change!: ChangeDto;

  @ApiProperty({ type: [RevenuePointDto], description: 'Oldest first.' })
  points!: RevenuePointDto[];
}

class TierSliceDto {
  @ApiProperty()
  ticketTypeName!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty()
  percent!: number;
}

class SellingFastDto {
  @ApiProperty()
  ticketTypeId!: string;

  @ApiProperty()
  ticketTypeName!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  eventName!: string;

  @ApiProperty({ description: 'Allocation minus sold; never negative.' })
  remaining!: number;

  @ApiProperty({ description: 'The allocation it is running out of.' })
  total!: number;
}

class KpisDto {
  @ApiProperty({ type: KpiDto })
  registrations!: KpiDto;

  @ApiProperty({
    type: KpiDto,
    nullable: true,
    description: 'Null without finance access — withheld, not zeroed.',
  })
  revenueSatang!: KpiDto | null;

  @ApiProperty({ type: KpiDto })
  upcomingEvents!: KpiDto;

  @ApiProperty({ type: KpiDto, description: 'A percentage, or null.' })
  checkInRate!: KpiDto;

  @ApiProperty({ type: KpiDto, description: 'A percentage, or null.' })
  capacityFilled!: KpiDto;
}

export class AnalyticsDto {
  @ApiProperty({ type: KpisDto })
  kpis!: KpisDto;

  @ApiProperty({
    type: RevenueTrendDto,
    nullable: true,
    description: 'Absent entirely without finance access.',
  })
  revenue!: RevenueTrendDto | null;

  @ApiProperty({ type: [FeedItemDto], description: 'Newest first.' })
  recent!: FeedItemDto[];

  @ApiProperty({ type: [TierSliceDto], description: 'Largest share first.' })
  tierMix!: TierSliceDto[];

  @ApiProperty({
    type: [SellingFastDto],
    description: 'Tiers nearly sold out, scarcest first.',
  })
  sellingFast!: SellingFastDto[];

  @ApiProperty({ format: 'date-time' })
  generatedAt!: Date;
}
