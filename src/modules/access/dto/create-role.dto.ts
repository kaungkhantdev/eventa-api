import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { permissionKeyEnum } from '../../../db/schema';
import type { PermissionKey } from '../../../common/decorators/require-permissions.decorator';

const KEYS = permissionKeyEnum.enumValues;
const MAX_NAME = 40;
const MAX_DESCRIPTION = 200;

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
