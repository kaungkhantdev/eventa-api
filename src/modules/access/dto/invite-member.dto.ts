import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Invite a teammate into the workspace with a role. */
export class InviteMemberDto {
  @ApiProperty({ example: 'Sam Editor', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'sam@acme.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 79,
    description: 'Role id to assign (see GET /roles)',
  })
  @IsInt()
  @IsPositive()
  roleId!: number;
}
