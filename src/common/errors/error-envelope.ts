import { ApiProperty } from '@nestjs/swagger';

/** The single response shape for every error (development-guide §6, §7). */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}

/** Swagger/OpenAPI documentation of {@link ErrorEnvelope}. */
export class ErrorBodyDto {
  @ApiProperty({ example: 'NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: 'Resource not found' })
  message!: string;

  @ApiProperty({ required: false, nullable: true })
  details?: unknown;

  @ApiProperty({ required: false, example: 'a1b2c3d4-...' })
  correlationId?: string;
}

export class ErrorResponseDto implements ErrorEnvelope {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
