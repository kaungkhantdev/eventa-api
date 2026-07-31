import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ConfigureGeneralDto {
  @ApiProperty({
    example: 250,
    minimum: 0,
    description: 'General-admission headcount',
  })
  @IsInt()
  @Min(0)
  headcount!: number;
}
