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
    description: 'Keys this role grants',
  })
  permissions!: string[];

  /**
   * The third state, and the reason it is in the contract: a key absent from
   * `permissions` is either one somebody here turned off or one nobody here has
   * ever been asked about, and the roles editor has to tell them apart. Nothing
   * grants a permission automatically — an automatic backfill was withdrawn
   * because every version of it reversed decisions organizers had made — so
   * these are the gaps a person is shown and asked to decide. A key in neither
   * list was turned off deliberately.
   */
  @ApiProperty({
    isArray: true,
    enum: permissionKeyEnum.enumValues,
    example: ['finManage'],
    description:
      'Keys with no decision recorded for this role — never granted and never turned off. A key in neither list was turned off.',
  })
  neverOfferedPermissions!: string[];

  @ApiProperty({ example: 3, description: 'Live members holding this role' })
  memberCount!: number;

  @ApiProperty({ description: 'Built-in roles every workspace starts with' })
  isSystem!: boolean;
}
