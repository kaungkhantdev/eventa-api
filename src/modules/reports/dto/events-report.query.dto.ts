import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  EVENT_LIFECYCLES,
  type EventLifecycle,
} from '../ports/event-performance.port';
import { ReportFilterQueryDto } from './report-filter.query.dto';

/**
 * The shared report filter, plus the one control only this report has
 * (US-RPT-04).
 *
 * Extended rather than added to `ReportFilterQueryDto`, because a status that
 * every other report would ignore does not belong in the filter they all share.
 */
export class EventsReportQueryDto extends ReportFilterQueryDto {
  @ApiPropertyOptional({
    enum: EVENT_LIFECYCLES,
    description:
      'One stage of the lifecycle, or every stage when omitted. Worked out from the clock, not read off `events.status`.',
  })
  @IsOptional()
  @IsIn(EVENT_LIFECYCLES)
  status?: EventLifecycle;
}
