import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RequestContextService } from './context/request-context';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

/**
 * Global cross-cutting providers: the request-context service and the app-wide
 * exception filter (registered via APP_FILTER so it gets dependency injection).
 */
@Global()
@Module({
  providers: [
    RequestContextService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [RequestContextService],
})
export class CommonModule {}
