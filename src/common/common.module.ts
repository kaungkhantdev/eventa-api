import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextService } from './context/request-context';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { Clock, SystemClock } from './time/clock';

/**
 * Global cross-cutting providers: the request-context service, the injectable
 * clock, the app-wide exception filter (`{ error }`), and the response envelope
 * interceptor (`{ data }`) — all registered so they get dependency injection.
 */
@Global()
@Module({
  providers: [
    RequestContextService,
    { provide: Clock, useClass: SystemClock },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [RequestContextService, Clock],
})
export class CommonModule {}
