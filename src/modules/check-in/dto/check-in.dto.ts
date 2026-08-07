import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { checkInMethodEnum, scanOutcomeEnum } from '../../../db/schema';
import type { CheckInMethod, ScanOutcome } from '../check-in.types';

const MAX_TOKEN = 256;
const MAX_STATION = 64;

/** Read a QR at the station (US-REG-12). */
export class ScanTicketDto {
  @ApiProperty({ description: 'The token decoded from the ticket QR.' })
  @IsString()
  @MaxLength(MAX_TOKEN)
  qrToken!: string;

  @ApiPropertyOptional({ description: 'Which door read it, for reconciling.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STATION)
  stationId?: string;
}

/** Admit someone found by hand when the QR will not scan (US-REG-13). */
export class ManualCheckInDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ticketId!: string;

  @ApiPropertyOptional({
    enum: checkInMethodEnum.enumValues,
    description: '`upload` when decoded from a photo; defaults to `manual`.',
  })
  @IsOptional()
  @IsIn(checkInMethodEnum.enumValues)
  method?: CheckInMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STATION)
  stationId?: string;
}

/** What the door shows after reading a code. */
export class ScanResultDto {
  @ApiProperty({
    enum: scanOutcomeEnum.enumValues,
    description:
      'A refusal is a RESULT, not an error — the door must tell an unknown code from a wrong-event ticket from a cancelled one.',
  })
  outcome!: ScanOutcome;

  @ApiProperty({ nullable: true, format: 'uuid' })
  ticketId!: string | null;

  @ApiProperty({ nullable: true, example: 'Anan Suksawat' })
  holderName!: string | null;

  @ApiProperty({ nullable: true, example: 'General' })
  ticketLabel!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'On a repeat scan this is the ORIGINAL arrival time.',
  })
  checkedInAt!: string | null;
}
