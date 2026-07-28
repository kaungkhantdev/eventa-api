import type { Database } from '../db/drizzle.constants';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports ok when the DB responds', async () => {
    const db = { execute: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const service = new HealthService(db as unknown as Database);

    await expect(service.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('reports error when the DB query fails', async () => {
    const db = {
      execute: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const service = new HealthService(db as unknown as Database);

    await expect(service.readiness()).resolves.toEqual({
      status: 'error',
      checks: { database: 'down' },
    });
  });
});
