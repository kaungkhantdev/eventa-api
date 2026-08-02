import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** An attendee trying a code during registration (US-TKT-11). */
export class QuoteDiscountDto {
  @ApiProperty({ example: 'PROMO42' })
  @IsString()
  @MaxLength(24)
  code!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  eventId!: string;

  @ApiProperty({
    example: 100000,
    description: 'VAT-inclusive order subtotal, in satang',
  })
  @IsInt()
  @Min(0)
  subtotalSatang!: number;

  @ApiPropertyOptional({
    example: 'anan@example.com',
    description: "Needed to enforce a code's per-person limit",
  })
  @IsOptional()
  @IsEmail()
  buyerEmail?: string;
}
