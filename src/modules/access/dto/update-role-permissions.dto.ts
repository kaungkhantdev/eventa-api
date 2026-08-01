import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { permissionKeyEnum } from '../../../db/schema';
import type { PermissionKey } from '../../../common/decorators/require-permissions.decorator';

/** Replace the full set of permission keys a role grants (grant/revoke). */
export class UpdateRolePermissionsDto {
  @ApiProperty({
    isArray: true,
    enum: permissionKeyEnum.enumValues,
    example: ['regView', 'regCheckin'],
    description:
      'The complete set of keys the role should grant after the update',
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(permissionKeyEnum.enumValues, { each: true })
  permissions!: PermissionKey[];
}
