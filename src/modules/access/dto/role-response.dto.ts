import { ApiProperty } from '@nestjs/swagger';
import { permissionKeyEnum } from '../../../db/schema';

/** A role with the permission keys it currently grants (US-SET-12/13). */
export class RoleResponseDto {
  @ApiProperty({ example: 5 })
  id!: number;

  @ApiProperty({
    example: 'Volunteer',
    description: 'Free text — built-ins are Admin/Organizer/Staff/Attendee',
  })
  name!: string;

  @ApiProperty({ example: 'Full access' })
  description!: string;

  @ApiProperty({
    isArray: true,
    enum: permissionKeyEnum.enumValues,
    example: ['evCreate', 'setUsers'],
  })
  permissions!: string[];

  @ApiProperty({ example: 3, description: 'Live members holding this role' })
  memberCount!: number;

  @ApiProperty({ description: 'Built-in roles every workspace starts with' })
  isSystem!: boolean;
}
