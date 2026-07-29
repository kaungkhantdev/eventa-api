import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Accept a workspace invite by setting a password. */
export class AcceptInviteDto {
  @ApiProperty({ description: 'The invite token from POST /members' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 200,
    example: 'a strong new password',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

/** Result of accepting an invite — the member can now sign in. */
export class AcceptInviteResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'sam@acme.test' })
  email!: string;

  @ApiProperty({ example: 'Active' })
  status!: string;
}
