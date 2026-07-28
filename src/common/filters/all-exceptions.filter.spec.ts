import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextService } from '../context/request-context';
import { DomainException } from '../errors/domain.exception';
import type { ErrorEnvelope } from '../errors/error-envelope';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost(): {
  host: ArgumentsHost;
  sent: () => { status: number; body: ErrorEnvelope };
} {
  let status = 0;
  let body: ErrorEnvelope | undefined;
  const res = {
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (b: ErrorEnvelope) => {
      body = b;
      return res;
    },
  } as unknown as Response;

  const host = {
    switchToHttp: () => ({ getResponse: <T>() => res as T }),
  } as unknown as ArgumentsHost;

  return { host, sent: () => ({ status, body: body! }) };
}

describe('AllExceptionsFilter', () => {
  const context = new RequestContextService();
  const filter = new AllExceptionsFilter(context);

  it('renders a DomainException as the envelope with its code', () => {
    const { host, sent } = mockHost();
    context.run({ correlationId: 'cid-1' }, () => {
      filter.catch(DomainException.notFound('Event not found'), host);
    });
    const { status, body } = sent();
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Event not found',
      details: undefined,
      correlationId: 'cid-1',
    });
  });

  it('maps a ValidationPipe BadRequest to VALIDATION_ERROR with details', () => {
    const { host, sent } = mockHost();
    const ex = new BadRequestException(['name must be a string']);
    filter.catch(ex, host);
    const { status, body } = sent();
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
    expect(body.error.details).toEqual(['name must be a string']);
  });

  it('never leaks internals for an unexpected error', () => {
    const { host, sent } = mockHost();
    filter.catch(new Error('DB password is hunter2'), host);
    const { status, body } = sent();
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
