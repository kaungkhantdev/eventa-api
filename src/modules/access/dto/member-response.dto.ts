import { ApiProperty } from '@nestjs/swagger';
import { memberRoleEnum, memberStatusEnum } from '../../../db/schema';

/** A team member: the membership joined with its user and role. */
export class MemberResponseDto {
  @ApiProperty({ example: 10, description: 'Membership id' })
  id!: number;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'Sam Staff' })
  name!: string;

  @ApiProperty({ example: 'sam@acme.test' })
  email!: string;

  @ApiProperty({ enum: memberRoleEnum.enumValues, example: 'Organizer' })
  role!: string;

  @ApiProperty({ example: 79, description: 'The assigned role id' })
  roleId!: number;

  @ApiProperty({ enum: memberStatusEnum.enumValues, example: 'Active' })
  status!: string;
}
