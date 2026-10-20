import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { PermissionKey } from '../../../common/decorators/require-permissions.decorator';
import {
  KEYS,
  MAX_DESCRIPTION,
  MAX_NAME,
} from '../../../common/constants/access.constants';

/** Create a custom role, e.g. "Volunteer" (US-SET-13). */
export class CreateRoleDto {
  @ApiProperty({ example: 'Volunteer', maxLength: MAX_NAME })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME)
  name!: string;

  @ApiProperty({ example: 'Helps on the day', maxLength: MAX_DESCRIPTION })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_DESCRIPTION)
  description!: string;

  @ApiProperty({ enum: KEYS, isArray: true, example: ['regCheckin'] })
  @ArrayUnique()
  @IsIn([...KEYS], { each: true })
  permissions!: PermissionKey[];
}
