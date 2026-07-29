import { ApiProperty } from '@nestjs/swagger';
import { categoryColorEnum } from '../../../../db/schema';

/** Response shape for a category (mapped from the row + its live event count). */
export class CategoryResponseDto {
  @ApiProperty({ example: 10 })
  id!: number;

  @ApiProperty({ example: 'Conference' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ example: 'presentation-01', description: 'Icon slug' })
  icon!: string;

  @ApiProperty({ enum: categoryColorEnum.enumValues, example: 'blue' })
  color!: string;

  @ApiProperty({ example: 12, description: 'Live count of events using it' })
  eventCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: 1, description: 'Optimistic-concurrency token' })
  version!: number;
}
