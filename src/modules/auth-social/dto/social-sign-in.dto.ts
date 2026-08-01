import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { socialProviderEnum } from '../../../db/schema';

const PROVIDERS = socialProviderEnum.enumValues;

/** The provider's id token, posted by the browser after its consent screen. */
export class SocialSignInDto {
  @ApiProperty({ enum: PROVIDERS })
  @IsIn([...PROVIDERS])
  provider!: (typeof PROVIDERS)[number];

  @ApiPropertyOptional({ description: 'Omitted when the person cancelled' })
  @IsOptional()
  @IsString()
  @MaxLength(8192)
  idToken?: string;

  @ApiPropertyOptional({
    description: "Set to 'access_denied' when the consent screen was cancelled",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  error?: string;

  @ApiPropertyOptional({ description: 'Required for the attendee portal' })
  @IsOptional()
  @IsString()
  orgSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
