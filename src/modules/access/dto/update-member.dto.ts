import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive } from 'class-validator';

/** Re-assign a member to another role (role id from GET /roles). */
export class UpdateMemberDto {
  @ApiProperty({
    example: 79,
    description: 'The role id to assign (see GET /roles)',
  })
  @IsInt()
  @IsPositive()
  roleId!: number;
}
