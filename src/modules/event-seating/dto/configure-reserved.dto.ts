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
  isUUID,
  type ValidationOptions,
} from 'class-validator';

const MAX_ROWS = 100;
const MAX_SEATS_PER_ROW = 100;

/** Every entry is a ticket type id or null — a row with no type yet. */
function IsTicketTypeIdOrNullEach(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isTicketTypeIdOrNullEach',
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) &&
          value.every(
            (v) => v === null || (typeof v === 'string' && isUUID(v)),
          ),
        defaultMessage: () =>
          'rowTicketTypes must hold a ticket type id or null for each row',
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
      "Each row's ticket type, one entry per row (index 0 = row 1); null for a row with none. Omit it to keep every surviving row's type (new rows get none). On an event whose rows have types, each ticket type's quantity becomes the seats its rows hold (US-EVT-05).",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROWS)
  @IsTicketTypeIdOrNullEach()
  rowTicketTypes?: (string | null)[];
}
