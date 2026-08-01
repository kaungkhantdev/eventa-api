import { ApiProperty } from '@nestjs/swagger';

/** The workspace identity shown on the Settings → Organization page. */
export class OrganizationResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true }) logoUrl!: string | null;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty({ nullable: true }) website!: string | null;
  @ApiProperty({ nullable: true, description: '13-digit Thai VAT number' })
  taxId!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty() country!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() locale!: string;
  @ApiProperty({ description: 'VAT itemized on receipts, as a percent (7)' })
  vatRatePercent!: number;
  @ApiProperty({ nullable: true }) statementDescriptor!: string | null;
  @ApiProperty() version!: number;
}
