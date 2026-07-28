import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/** Per-request ambient state, propagated via AsyncLocalStorage. */
export interface RequestStore {
  /** Trace id shared across logs, the response header, and outbound messages. */
  correlationId: string;
  /** Tenant scope — set once auth resolves; drives `organization_id` scoping + RLS. */
  organizationId?: number;
  /** Authenticated principal, when present. */
  userId?: string;
}

/**
 * Request-scoped context without request-scoped providers. A middleware opens a
 * store per request; services, the logger, and the exception filter read it.
 */
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestStore>();

  run<T>(store: RequestStore, callback: () => T): T {
    return this.als.run(store, callback);
  }

  get store(): RequestStore | undefined {
    return this.als.getStore();
  }

  get correlationId(): string | undefined {
    return this.als.getStore()?.correlationId;
  }

  get organizationId(): number | undefined {
    return this.als.getStore()?.organizationId;
  }

  get userId(): string | undefined {
    return this.als.getStore()?.userId;
  }

  /** Merge fields into the active store (e.g. tenant/user once auth resolves). */
  set(patch: Partial<RequestStore>): void {
    const store = this.als.getStore();
    if (store) Object.assign(store, patch);
  }
}
