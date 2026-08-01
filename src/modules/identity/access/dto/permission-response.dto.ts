import { ApiProperty } from '@nestjs/swagger';
import { permissionGroupEnum, permissionKeyEnum } from '../../../../db/schema';

/** One entry of the fixed permission catalog. */
export class PermissionResponseDto {
  @ApiProperty({ enum: permissionKeyEnum.enumValues, example: 'evCreate' })
  key!: string;

  @ApiProperty({ enum: permissionGroupEnum.enumValues, example: 'Events' })
  group!: string;

  @ApiProperty({ example: 'Create & edit events' })
  label!: string;
}
