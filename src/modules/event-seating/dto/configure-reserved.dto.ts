import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_ROWS = 100;
const MAX_SEATS_PER_ROW = 100;

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
}
