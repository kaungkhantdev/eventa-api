import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import {
  MAX_ROWS,
  MAX_SEATS_PER_ROW,
} from '../../../common/constants/event-seating.constants';

/** A ticket type id, or null for none. */
const isTypeOrNone = (v: unknown): boolean =>
  v === null || typeof v === 'string';

/**
 * Every entry is a string or null — a row with no type yet. Whether a string
 * is one of this event's ticket types is the seating rule's to say, naming the
 * row (US-EVT-05).
 */
function IsStringOrNullEach(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isStringOrNullEach',
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) && value.every(isTypeOrNone),
        defaultMessage: () =>
          'rowTicketTypes must hold a ticket type id or null for each row',
      },
    },
    options,
  );
}

/**
 * Every entry is a list of at most `MAX_SEATS_PER_ROW` strings or nulls — a
 * row's seats, each with its type or none. Whether a list matches the map's
 * seats per row, and a string is one of this event's ticket types, is the
 * seating rule's to say, naming the row and seat (US-EVT-05).
 */
function IsSeatTypeRows(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isSeatTypeRows',
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) &&
          value.every(
            (row) =>
              Array.isArray(row) &&
              row.length <= MAX_SEATS_PER_ROW &&
              row.every(isTypeOrNone),
          ),
        defaultMessage: () =>
          `seatTicketTypes must hold, for each row, a list of at most ${MAX_SEATS_PER_ROW} ticket type ids or nulls, one per seat`,
      },
    },
    options,
  );
}

export class ConfigureReservedDto {
  @ApiProperty({ example: 'Grand Hall', minLength: 1, maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 10, minimum: 1, maximum: MAX_ROWS })
  @IsInt()
  @Min(1)
  @Max(MAX_ROWS)
  rows!: number;

  @ApiProperty({ example: 12, minimum: 1, maximum: MAX_SEATS_PER_ROW })
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_ROW)
  seatsPerRow!: number;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: MAX_ROWS,
    example: [
      '3f1c2b4a-0000-4000-8000-000000000001',
      '3f1c2b4a-0000-4000-8000-000000000002',
      null,
    ],
    description:
      "Shorthand: each row's ticket type, one entry per row (index 0 = row 1), given to every seat of that row; null for a row with none. Send this or `seatTicketTypes`, not both (422). Send neither to keep every surviving seat's type (new seats get none). On an event whose seats have types, each ticket type's quantity becomes the seats it holds (US-EVT-05).",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROWS)
  @IsStringOrNullEach()
  rowTicketTypes?: (string | null)[];

  @ApiPropertyOptional({
    type: 'array',
    maxItems: MAX_ROWS,
    items: {
      type: 'array',
      maxItems: MAX_SEATS_PER_ROW,
      items: { type: 'string', format: 'uuid', nullable: true },
    },
    example: [
      [
        '3f1c2b4a-0000-4000-8000-000000000003',
        '3f1c2b4a-0000-4000-8000-000000000003',
        '3f1c2b4a-0000-4000-8000-000000000002',
      ],
      ['3f1c2b4a-0000-4000-8000-000000000001', null, null],
    ],
    description:
      "Each seat's ticket type: one list per row (index 0 = row 1), each holding one entry per seat (index 0 = seat 1); null for a seat with none. Every row must list exactly `seatsPerRow` seats (422 names the row), and every id must be one of this event's ticket types (422 names the row and seat). A seat booked or held in a checkout keeps its type (409). Send this or `rowTicketTypes`, not both (422). On an event whose seats have types, each ticket type's quantity becomes the seats it holds (US-EVT-05).",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROWS)
  @IsSeatTypeRows()
  seatTicketTypes?: (string | null)[][];
}
