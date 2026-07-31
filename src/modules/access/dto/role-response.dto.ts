import { ApiProperty } from '@nestjs/swagger';
import { memberRoleEnum, permissionKeyEnum } from '../../../db/schema';

/** A role with the permission keys it currently grants. */
export class RoleResponseDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({ enum: memberRoleEnum.enumValues, example: 'Admin' })
  name!: string;

  @ApiProperty({ example: 'Full access' })
  description!: string;

  @ApiProperty({
    isArray: true,
    enum: permissionKeyEnum.enumValues,
    example: ['evCreate', 'setUsers'],
  })
  permissions!: string[];
}
