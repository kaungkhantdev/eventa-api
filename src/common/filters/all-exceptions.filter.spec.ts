import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextService } from '../context/request-context';
import { DomainException } from '../errors/domain.exception';
import { Clock } from '../time/clock';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface FailureBody {
  success: boolean;
  statusCode: number;
  message: string;
  errors?: { field: string; message: string }[];
  timestamp: string;
}

function mockHost(): {
  host: ArgumentsHost;
  sent: () => { status: number; body: FailureBody };
} {
  let status = 0;
  let body: FailureBody | undefined;
  const res = {
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (b: FailureBody) => {
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
  const clock: Clock = { now: () => new Date('2026-07-28T10:00:00.000Z') };
  const filter = new AllExceptionsFilter(context, clock);

  it('renders a DomainException as the failure envelope', () => {
    const { host, sent } = mockHost();
    filter.catch(DomainException.notFound('Event not found'), host);
    const { status, body } = sent();
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body).toEqual({
      success: false,
      statusCode: 404,
      message: 'Event not found',
      timestamp: '2026-07-28T10:00:00.000Z',
    });
  });

  it('maps a validation BadRequest to 400 with a structured errors[]', () => {
    const { host, sent } = mockHost();
    filter.catch(
      new BadRequestException({
        message: 'Validation failed.',
        errors: [{ field: 'email', message: 'Email is invalid.' }],
      }),
      host,
    );
    const { status, body } = sent();
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Validation failed.');
    expect(body.errors).toEqual([
      { field: 'email', message: 'Email is invalid.' },
    ]);
  });

  it('never leaks internals for an unexpected error', () => {
    const { host, sent } = mockHost();
    filter.catch(new Error('DB password is hunter2'), host);
    const { status, body } = sent();
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.success).toBe(false);
    expect(body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
