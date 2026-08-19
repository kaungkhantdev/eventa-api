import { RequestContextService } from './request-context';

describe('RequestContextService', () => {
  let ctx: RequestContextService;

  beforeEach(() => {
    ctx = new RequestContextService();
  });

  it('exposes no store outside of run()', () => {
    expect(ctx.store).toBeUndefined();
    expect(ctx.correlationId).toBeUndefined();
  });

  it('exposes the store within run()', () => {
    ctx.run({ correlationId: 'abc' }, () => {
      expect(ctx.correlationId).toBe('abc');
      expect(ctx.organizationId).toBeUndefined();
    });
  });

  it('merges fields via set()', () => {
    ctx.run({ correlationId: 'abc' }, () => {
      ctx.set({ organizationId: 1, userId: 'user_1' });
      expect(ctx.organizationId).toBe(1);
      expect(ctx.userId).toBe('user_1');
      expect(ctx.correlationId).toBe('abc');
    });
  });

  it('isolates stores across concurrent runs', async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all([
      Promise.resolve().then(() =>
        ctx.run({ correlationId: 'one' }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push(ctx.correlationId);
        }),
      ),
      Promise.resolve().then(() =>
        ctx.run({ correlationId: 'two' }, () => {
          seen.push(ctx.correlationId);
        }),
      ),
    ]);
    expect(seen.sort()).toEqual(['one', 'two']);
  });
});
