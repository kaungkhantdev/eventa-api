import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { calendarConnections } from '../../db/schema';
import { type Tx, withTenant } from '../../db/tenant';
import type {
  CalendarConnectionRow,
  PendingState,
} from './calendar-connection.types';
import {
  NOW,
  NO_PENDING_STATE,
  STATE_TTL,
} from '../../common/constants/calendar-connection.constants';

export interface BeginConnectInput {
  /** sha256 hex of the nonce — the nonce itself is never stored. */
  stateHash: string;
  userId: string;
  verifierCipher: Buffer;
}

export interface SaveConnectedInput {
  accountEmail: string | null;
  refreshTokenCipher: Buffer;
  connectedBy: string;
}

/**
 * Data access for the workspace Google Calendar connection (US-MTG-08), one
 * row per workspace.
 *
 * Every method runs through `withTenant` AND names `organization_id`
 * explicitly, so RLS is the second line rather than the only one — which
 * matters here because the row holds an encrypted Google grant. Expiry is
 * judged on the database clock, so it cannot drift with an app server's.
 */
@Injectable()
export class CalendarConnectionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async find(organizationId: number): Promise<CalendarConnectionRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.organizationId, organizationId))
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Record a pending connect. A second start overwrites the first — the last
   * one wins, so an Admin who closed Google's tab and clicked again is not
   * stuck behind their own abandoned attempt. A new row keeps its default
   * status: starting a connect is not being connected.
   */
  async beginConnect(
    organizationId: number,
    input: BeginConnectInput,
  ): Promise<void> {
    const pending = {
      oauthStateHash: input.stateHash,
      oauthStateUserId: input.userId,
      oauthVerifierCipher: input.verifierCipher,
      oauthStateExpiresAt: STATE_TTL,
    };
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(calendarConnections)
        .values({ organizationId, ...pending })
        .onConflictDoUpdate({
          target: calendarConnections.organizationId,
          set: { ...pending, updatedAt: NOW },
        });
    });
  }

  /**
   * Take the pending connect for this state hash, consuming it on a match.
   *
   * Locked and cleared in ONE transaction, so two callbacks racing on one
   * state cannot both succeed. A NON-matching hash writes nothing: otherwise
   * anyone who guessed a small workspace id could cancel an Admin's connect in
   * progress just by calling the callback with a made-up nonce.
   */
  async takePendingState(
    organizationId: number,
    stateHash: string,
  ): Promise<PendingState> {
    return withTenant(this.db, organizationId, async (tx) => {
      const pending = await this.lockPending(tx, organizationId);
      if (!pending?.stateHash || !pending.userId || !pending.verifierCipher) {
        return { kind: 'none' };
      }
      if (!SecretCipher.equals(pending.stateHash, stateHash)) {
        return { kind: 'mismatch' };
      }
      await tx
        .update(calendarConnections)
        .set({ ...NO_PENDING_STATE, updatedAt: NOW })
        .where(eq(calendarConnections.organizationId, organizationId));
      return {
        kind: 'match',
        userId: pending.userId,
        verifierCipher: pending.verifierCipher,
        live: pending.live,
      };
    });
  }

  /** The grant Google gave, replacing any earlier one. */
  async saveConnected(
    organizationId: number,
    input: SaveConnectedInput,
  ): Promise<void> {
    const connected = {
      status: 'connected' as const,
      accountEmail: input.accountEmail,
      refreshTokenCipher: input.refreshTokenCipher,
      connectedBy: input.connectedBy,
      connectedAt: NOW,
      disconnectedAt: null,
    };
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(calendarConnections)
        .values({ organizationId, ...connected })
        .onConflictDoUpdate({
          target: calendarConnections.organizationId,
          set: { ...connected, updatedAt: NOW },
        });
    });
  }

  /**
   * Forget the grant, the account and any pending connect, returning the
   * token cipher that was held (for a best-effort revoke) or null. Creates no
   * row for a workspace that never connected.
   */
  async disconnect(organizationId: number): Promise<Buffer | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [held] = await tx
        .select({ cipher: calendarConnections.refreshTokenCipher })
        .from(calendarConnections)
        .where(eq(calendarConnections.organizationId, organizationId))
        .for('update');
      if (!held) return null;
      await tx
        .update(calendarConnections)
        .set({
          status: 'disconnected',
          refreshTokenCipher: null,
          accountEmail: null,
          ...NO_PENDING_STATE,
          disconnectedAt: NOW,
          updatedAt: NOW,
        })
        .where(eq(calendarConnections.organizationId, organizationId));
      return held.cipher;
    });
  }

  private async lockPending(tx: Tx, organizationId: number) {
    const [row] = await tx
      .select({
        stateHash: calendarConnections.oauthStateHash,
        userId: calendarConnections.oauthStateUserId,
        verifierCipher: calendarConnections.oauthVerifierCipher,
        live: sql<boolean>`coalesce(${calendarConnections.oauthStateExpiresAt} > now(), false)`,
      })
      .from(calendarConnections)
      .where(eq(calendarConnections.organizationId, organizationId))
      .for('update');
    return row;
  }
}
