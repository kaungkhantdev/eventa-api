import { ApiProperty } from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty({ example: 'email' }) field!: string;
  @ApiProperty({ example: 'Email is invalid.' }) message!: string;
}

/** Failure envelope produced by the global exception filter. */
export class ApiErrorDto {
  @ApiProperty({ example: false }) success!: boolean;
  @ApiProperty({ example: 400 }) statusCode!: number;
  @ApiProperty({ example: 'Validation failed.' }) message!: string;
  @ApiProperty({
    required: false,
    type: [FieldErrorDto],
    description: 'Present on validation (400) errors only',
  })
  errors?: FieldErrorDto[];
  @ApiProperty({ example: '2026-07-28T10:00:00Z' }) timestamp!: string;
}
