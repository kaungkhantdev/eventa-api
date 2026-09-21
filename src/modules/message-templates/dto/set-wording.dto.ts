import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsString, MaxLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Shape only. Whether a language is half-written, and whether it uses a merge
 * field the message can fill, are domain rules — they get to say why.
 */
export class LocaleWordingDto {
  @ApiProperty({ maxLength: 200, description: 'Empty to use Eventa’s own.' })
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  subject = '';

  @ApiProperty({ maxLength: 4000, description: 'Empty to use Eventa’s own.' })
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  body = '';
}

export class SetWordingDto {
  @ApiProperty({ type: LocaleWordingDto })
  @ValidateNested()
  @Type(() => LocaleWordingDto)
  en!: LocaleWordingDto;

  @ApiProperty({ type: LocaleWordingDto })
  @ValidateNested()
  @Type(() => LocaleWordingDto)
  th!: LocaleWordingDto;
}
