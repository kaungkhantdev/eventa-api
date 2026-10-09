import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** The six digits texted to the requested number (US-DISC-11 AC3). */
export class ConfirmPhoneDto {
  @ApiProperty({ example: '402913', description: 'Six digits' })
  // Shaped at the edge so a 40-character guess never reaches the comparison,
  // and so a wrong length is a 400 rather than one of the member's five
  // attempts. A `string` typed as `number` would be worse than useless here:
  // the pipe's implicit conversion would turn `"040291"` into 40291 and the
  // leading zero of one code in ten would be lost before anything compared it.
  @Matches(/^\d{6}$/, { message: 'Enter the six digits from the text.' })
  code!: string;
}
