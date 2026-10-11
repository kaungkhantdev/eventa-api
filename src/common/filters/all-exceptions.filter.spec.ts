import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextService } from '../context/request-context';
import { DomainException } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';
import { Clock } from '../time/clock';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface FailureBody {
  success: boolean;
  statusCode: number;
  code?: string;
  message: string;
  errors?: { field: string; message: string }[];
  timestamp: string;
}

function mockHost(): {
  host: ArgumentsHost;
  sent: () => { status: number; body: FailureBody; contentType: string };
} {
  let status = 0;
  let contentType = '';
  let body: FailureBody | undefined;
  const res = {
    status: (s: number) => {
      status = s;
      return res;
    },
    // A download route sets its own Content-Type before the handler runs, so
    // the filter must restate it — the double records what it restated.
    type: (t: string) => {
      contentType = t;
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
  return { host, sent: () => ({ status, body: body!, contentType }) };
}

describe('AllExceptionsFilter', () => {
  const context = new RequestContextService();
  const clock: Clock = { now: () => new Date('2026-07-28T10:00:00.000Z') };
  const filter = new AllExceptionsFilter(context, clock);

  /**
   * A domain rule that names its field has to reach the client intact, or the
   * form can only drop the sentence at its foot and hope the reader works out
   * which input is meant.
   */
  it('forwards the field a domain rule blamed', () => {
    const { host, sent } = mockHost();

    filter.catch(
      DomainException.invalidField(
        'taxId',
        'Tax ID must be the 13-digit Thai VAT registration number.',
      ),
      host,
    );

    expect(sent().status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(sent().body.errors).toEqual([
      {
        field: 'taxId',
        message: 'Tax ID must be the 13-digit Thai VAT registration number.',
      },
    ]);
  });

  it('renders a DomainException as the failure envelope', () => {
    const { host, sent } = mockHost();
    filter.catch(DomainException.notFound('Event not found'), host);
    const { status, body } = sent();
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body).toEqual({
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Event not found',
      timestamp: '2026-07-28T10:00:00.000Z',
    });
  });

  it('always declares JSON, even on a route that sets its own file type', () => {
    // A `@Header('Content-Type', 'text/csv')` download route would otherwise
    // send this envelope labelled as a CSV, which no client will parse.
    const { host, sent } = mockHost();
    filter.catch(DomainException.conflict('Nothing to export.'), host);
    expect(sent().contentType).toBe('application/json');
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

  /**
   * `DomainException` has always carried a stable `ErrorCode`, and its docstring
   * has always said "the global filter renders it into the error envelope". The
   * filter dropped it, so every refusal reached the browser as its bare status —
   * and eventa-web's `ApiError`, which reads `body.code`, silently fell back to
   * a code derived from that status. The two codes below are precisely the ones
   * that fallback cannot reconstruct: both share a status with the ordinary case
   * they exist to be distinguished from.
   */
  describe('the code a client branches on', () => {
    it('forwards a domain code that a status cannot reconstruct', () => {
      const { host, sent } = mockHost();

      filter.catch(
        new DomainException(
          ErrorCode.PHONE_CODE_EXPIRED,
          'That code is no longer valid. Ask for a new one.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
        host,
      );

      // 422 is also what a mistyped code answers, so the status alone leaves the
      // settings page unable to choose between "Send a new code" and an error
      // under the input — which is the whole reason this code exists.
      expect(sent().body.code).toBe('PHONE_CODE_EXPIRED');
      expect(sent().status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('forwards a conflict code whose remedy differs from a plain conflict', () => {
      const { host, sent } = mockHost();

      filter.catch(
        new DomainException(
          ErrorCode.ATTENDEE_EMAIL_IN_USE,
          'Another attendee already uses that address.',
          HttpStatus.CONFLICT,
        ),
        host,
      );

      expect(sent().body.code).toBe('ATTENDEE_EMAIL_IN_USE');
    });

    /**
     * The validation pipe names `VALIDATION_ERROR` on its own payload (see
     * `http/validation.spec.ts`); the filter's share of that is carrying it
     * out alongside the field errors rather than one or the other.
     */
    it('forwards a code and the field errors together', () => {
      const { host, sent } = mockHost();

      filter.catch(
        new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed.',
          errors: [{ field: 'email', message: 'Email is invalid.' }],
        }),
        host,
      );

      expect(sent().body.code).toBe('VALIDATION_ERROR');
      expect(sent().body.errors).toEqual([
        { field: 'email', message: 'Email is invalid.' },
      ]);
    });

    /**
     * The code is read off an untrusted body, so it is checked against the enum
     * rather than forwarded. Without that, any third-party `HttpException` whose
     * payload happens to carry a `code` would publish it to the client.
     */
    it('refuses a code the enum does not define', () => {
      const { host, sent } = mockHost();

      filter.catch(
        new BadRequestException({
          code: 'PG_28P01 password authentication failed for user "eventa_app"',
          message: 'Validation failed.',
        }),
        host,
      );

      expect(sent().body.code).toBeUndefined();
      expect(JSON.stringify(sent().body)).not.toContain('eventa_app');
    });

    /**
     * An unexpected throw is the one case where the envelope must say nothing
     * about what happened — but it still gets a code, so a client is never left
     * inferring one from a 500.
     */
    it('labels an unexpected error without describing it', () => {
      const { host, sent } = mockHost();

      filter.catch(new Error('DB password is hunter2'), host);

      expect(sent().body.code).toBe('INTERNAL_ERROR');
    });
  });

  /**
   * What a 5xx writes to the server log.
   *
   * `exception.stack` begins with the error's MESSAGE, and Drizzle wraps every
   * query rejection as (drizzle-orm/errors.cjs:36)
   *
   *     super(`Failed query: ${query}\nparams: ${params}`)
   *
   * so the stack of any failed query carries the statement and every bound
   * value. For the checkout insert those values are the buyer's name, email
   * and phone. `unique-violation.ts` has described this leak in its own
   * docstring since the day that guard was fixed — the fix there stopped three
   * callers from reaching 500 at all, which left every OTHER query error still
   * printing its parameters here.
   *
   * The frames are what a 5xx log is for; the statement is not, and a repro
   * belongs in a developer's own environment.
   */
  describe('the 5xx server log', () => {
    const BUYER = 'Somchai Jaidee';
    const EMAIL = 'somchai@example.test';

    function failedQuery(): Error {
      const err = new Error(
        'Failed query: insert into "orders" ' +
          '("buyer_name","buyer_email","buyer_phone") values ($1,$2,$3)\n' +
          `params: ${BUYER},${EMAIL},+66812345678`,
      );
      err.stack = `${err.message}\n    at OrdersRepository.create (orders.repository.ts:40:7)`;
      err.cause = Object.assign(new Error('deadlock detected'), {
        code: '40P01',
        constraint: 'orders_pkey',
      });
      return err;
    }

    function captureErrors(): { text: () => string; restore: () => void } {
      const seen: unknown[] = [];
      const spy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation((...args: unknown[]) => {
          seen.push(...args);
        });
      return {
        text: () => JSON.stringify(seen),
        restore: () => spy.mockRestore(),
      };
    }

    it('does not print the buyer into the log', () => {
      const { host } = mockHost();
      const captured = captureErrors();
      try {
        filter.catch(failedQuery(), host);

        expect(captured.text()).not.toContain(BUYER);
        expect(captured.text()).not.toContain(EMAIL);
        expect(captured.text()).not.toContain('+66812345678');
      } finally {
        captured.restore();
      }
    });

    it('does not print the statement either', () => {
      const { host } = mockHost();
      const captured = captureErrors();
      try {
        filter.catch(failedQuery(), host);

        expect(captured.text()).not.toContain('insert into');
        expect(captured.text()).not.toContain('params:');
      } finally {
        captured.restore();
      }
    });

    /** Still diagnosable: where it happened, and what the database refused. */
    it('keeps the frames and the SQLSTATE', () => {
      const { host } = mockHost();
      const captured = captureErrors();
      try {
        filter.catch(failedQuery(), host);

        expect(captured.text()).toContain('OrdersRepository.create');
        expect(captured.text()).toContain('40P01');
        expect(captured.text()).toContain('orders_pkey');
      } finally {
        captured.restore();
      }
    });

    /** An ordinary failure is not redacted — over-redacting hides outages. */
    it('leaves an unrelated error’s message alone', () => {
      const { host } = mockHost();
      const captured = captureErrors();
      try {
        filter.catch(new Error('connect ECONNREFUSED 127.0.0.1:6379'), host);

        expect(captured.text()).toContain('ECONNREFUSED');
      } finally {
        captured.restore();
      }
    });
  });
});
