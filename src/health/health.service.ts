import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/drizzle.constants';

export type CheckStatus = 'up' | 'down';

export interface ReadinessResult {
  status: 'ok' | 'error';
  checks: Record<string, CheckStatus>;
}

@Injectable()
export class HealthService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Readiness = dependencies reachable. Pings the DB with `select 1`. */
  async readiness(): Promise<ReadinessResult> {
    const checks: Record<string, CheckStatus> = {};

    try {
      await this.db.execute(sql`select 1`);
      checks.database = 'up';
    } catch {
      checks.database = 'down';
    }

    const ok = Object.values(checks).every((c) => c === 'up');
    return { status: ok ? 'ok' : 'error', checks };
  }
}
