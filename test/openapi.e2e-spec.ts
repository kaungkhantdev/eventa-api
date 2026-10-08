process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/openapi';

/**
 * The OpenAPI document builds, and describes what the web calls.
 *
 * Added after two report DTO modules imported each other and the API stopped
 * booting — `tsc` reported zero errors, every suite stayed green, and
 * `pnpm start:dev` threw "a circular dependency has been detected".
 *
 * Be clear about what this file does NOT do: it will not catch that class of
 * bug. An import cycle resolves to `undefined` or not depending on which module
 * loads first, and jest's resolver orders them differently from the compiled
 * CommonJS that actually ships — this suite passes with that bug present, which
 * was checked rather than assumed. **`pnpm check:openapi` is the real guard**;
 * it builds `dist/` and does this against the shipped output.
 *
 * What this suite is worth: the contract itself. `openapi.json` is what
 * eventa-web is written against, so a route or a schema silently missing from
 * it is a promise broken, and that is something jest can see.
 */
describe('OpenAPI (e2e)', () => {
  let app: INestApplication;
  let document: ReturnType<typeof buildOpenApiDocument>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    document = buildOpenApiDocument(app);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('builds without a circular schema reference', () => {
    // The assertion is that `beforeAll` got here at all: Swagger throws while
    // walking the DTOs, long before anything below runs.
    expect(document.openapi).toMatch(/^3\./);
  });

  it('describes every route the app exposes', () => {
    expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
  });

  describe('the reports and notifications surfaces', () => {
    const schemas = () => document.components?.schemas ?? {};

    it('carries the shared report shapes exactly once each', () => {
      // Two copies would mean a DTO was duplicated to dodge an import cycle
      // rather than the cycle being broken.
      expect(schemas()).toHaveProperty('ReportPeriodDto');
      expect(schemas()).toHaveProperty('PeriodChangeDto');
    });

    it('describes each report’s response', () => {
      for (const name of [
        'OverviewReportDto',
        'RegistrationsReportDto',
        'IncomeReportDto',
        'AttendanceReportDto',
        'NotificationFeedDto',
      ]) {
        expect(schemas()).toHaveProperty(name);
      }
    });

    it('keeps the change chips on the reports that show them', () => {
      for (const name of [
        'RegistrationChangesDto',
        'IncomeChangesDto',
        'AttendanceChangesDto',
      ]) {
        expect(schemas()).toHaveProperty(name);
      }
    });

    it('documents the endpoints the web calls', () => {
      for (const path of [
        '/reports/overview',
        '/reports/registrations',
        '/reports/income',
        '/reports/attendance',
        '/notifications',
        '/notifications/read',
      ]) {
        expect(document.paths).toHaveProperty(path);
      }
    });
  });

  describe('the ticket edit (US-REG-04)', () => {
    it('says how many in the waitlist a raised allocation gave a place', () => {
      const schema = document.components?.schemas?.UpdatedTicketResponseDto as
        | {
            properties?: Record<string, { type?: string }>;
            required?: string[];
          }
        | undefined;
      expect(schema?.properties?.waitlistOffered?.type).toBe('number');
      expect(schema?.required).toContain('waitlistOffered');
      // A failure part-way is told apart from "the front did not fit", so the
      // organizer knows to offer the rest by hand.
      expect(schema?.properties?.waitlistOfferInterrupted?.type).toBe(
        'boolean',
      );
      expect(schema?.required).toContain('waitlistOfferInterrupted');
      // Still the whole ticket, so the edit form can re-render from it.
      expect(schema?.properties).toHaveProperty('sold');
    });
  });
});
