import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { pickDefined } from '../../common/util/pick-defined';
import { DiscountResponseDto } from './dto/discount-response.dto';
import { DiscountCodeGenerator } from './discount-code.generator';
import { toDiscountResponse, toSnapshot } from './discounts.mapper';
import { DiscountsPolicy } from './discounts.policy';
import { DiscountsRepository } from './discounts.repository';
import type {
  CreateDiscountInput,
  DeleteDiscountResult,
  DiscountActor,
  DiscountRow,
  NewDiscountValues,
  UpdateDiscountInput,
} from './discounts.types';

const UPDATABLE_KEYS: (keyof NewDiscountValues & keyof UpdateDiscountInput)[] =
  [
    'type',
    'value',
    'eventId',
    'redemptionLimit',
    'perPersonLimit',
    'minOrderSatang',
    'validFrom',
    'validUntil',
  ];

/**
 * Creating and running promotions (US-TKT-07/08/09/10).
 *
 * The rule that shapes everything here: a redeemed code is a promise already
 * made. Its text and value freeze on first use, its limit can never fall below
 * what has been given away, and deleting it retires rather than erases — so an
 * attendee's past order keeps the deal it was sold at.
 */
@Injectable()
export class DiscountsService {
  constructor(
    private readonly repo: DiscountsRepository,
    private readonly policy: DiscountsPolicy,
    private readonly generator: DiscountCodeGenerator,
    private readonly clock: Clock,
  ) {}

  /** A memorable code that is free right now — Generate never repeats itself. */
  async suggestCode(actor: DiscountActor): Promise<{ code: string }> {
    const taken = await this.repo.allCodes(actor.organizationId);
    return { code: this.generator.generate(taken) };
  }

  async createDiscount(
    actor: DiscountActor,
    input: CreateDiscountInput,
  ): Promise<DiscountResponseDto> {
    const now = this.clock.now();
    const code = this.policy.normaliseCode(input.code);
    const eventId = input.eventId ?? null;
    const redemptionLimit = input.redemptionLimit ?? 0;
    const perPersonLimit = input.perPersonLimit ?? 0;
    const validFrom = input.validFrom ?? null;
    const validUntil = input.validUntil ?? null;

    this.policy.assertValue(input.type, input.value);
    this.policy.assertLimits(redemptionLimit, perPersonLimit);
    this.policy.assertWindow(validFrom, validUntil, now);
    await this.assertCodeFree(actor.organizationId, code, eventId);

    const values: NewDiscountValues = {
      organizationId: actor.organizationId,
      eventId,
      code,
      type: input.type,
      value: input.value,
      redemptionLimit,
      perPersonLimit,
      minOrderSatang: input.minOrderSatang ?? 0,
      validFrom,
      validUntil,
      status: this.policy.resolveStatus(
        toSnapshot({
          id: '',
          code,
          type: input.type,
          value: input.value,
          status: 'active',
          eventId,
          used: 0,
          redemptionLimit,
          perPersonLimit,
          minOrderSatang: 0,
          validFrom,
          validUntil,
        }),
        now,
      ),
    };
    return toDiscountResponse(await this.repo.insert(values));
  }

  /**
   * Tune a live promotion. Limits, scope, dates and the minimum order stay open;
   * the code text and its value lock on first redemption.
   */
  async updateDiscount(
    actor: DiscountActor,
    id: string,
    input: UpdateDiscountInput,
  ): Promise<DiscountResponseDto> {
    const row = await this.load(actor.organizationId, id);
    if (input.version !== undefined && input.version !== row.version) {
      throw this.stale();
    }
    const current = toSnapshot(row);
    this.policy.assertChangeAllowedAfterUse(current, input);

    const now = this.clock.now();
    const merged = { ...current, ...pickDefined(input, UPDATABLE_KEYS) };
    this.policy.assertValue(merged.type, merged.value);
    this.policy.assertLimits(merged.redemptionLimit, merged.perPersonLimit);
    this.policy.assertWindow(merged.validFrom, merged.validUntil, now);

    const values: Partial<NewDiscountValues> = pickDefined(
      input,
      UPDATABLE_KEYS,
    );
    if (input.code !== undefined) {
      const code = this.policy.normaliseCode(input.code);
      await this.assertCodeFree(actor.organizationId, code, merged.eventId, id);
      values.code = code;
      merged.code = code;
    }
    values.status = this.policy.resolveStatus(merged, now);

    const updated = await this.repo.update(
      actor.organizationId,
      id,
      values,
      row.version,
    );
    if (!updated) throw this.stale();
    return toDiscountResponse(updated);
  }

  /** Switch a code off — refused at checkout at once, history untouched. */
  async disableDiscount(
    actor: DiscountActor,
    id: string,
  ): Promise<DiscountResponseDto> {
    const row = await this.load(actor.organizationId, id);
    return this.setStatus(actor.organizationId, row, 'disabled');
  }

  /** Switch it back on — only if it still has room and time to run. */
  async enableDiscount(
    actor: DiscountActor,
    id: string,
  ): Promise<DiscountResponseDto> {
    const row = await this.load(actor.organizationId, id);
    const now = this.clock.now();
    const snapshot = toSnapshot(row);
    this.policy.assertRevivable(snapshot, now);
    return this.setStatus(
      actor.organizationId,
      row,
      this.policy.resolveStatus({ ...snapshot, status: 'active' }, now),
    );
  }

  /**
   * A code nobody used is erased; one that has been redeemed is retired, so
   * prior orders keep their discount and it simply stops working at checkout.
   */
  async deleteDiscount(
    actor: DiscountActor,
    id: string,
  ): Promise<DeleteDiscountResult> {
    const row = await this.load(actor.organizationId, id);
    if (row.used === 0) {
      await this.repo.hardDelete(actor.organizationId, id);
      return { outcome: 'removed' };
    }
    await this.repo.softDelete(actor.organizationId, id);
    return { outcome: 'retired' };
  }

  private async setStatus(
    organizationId: number,
    row: DiscountRow,
    status: DiscountRow['status'],
  ): Promise<DiscountResponseDto> {
    const updated = await this.repo.update(
      organizationId,
      row.id,
      { status },
      row.version,
    );
    if (!updated) throw this.stale();
    return toDiscountResponse(updated);
  }

  private async assertCodeFree(
    organizationId: number,
    code: string,
    eventId: string | null,
    excludeId?: string,
  ): Promise<void> {
    if (await this.repo.codeExists(organizationId, code, eventId, excludeId)) {
      throw DomainException.conflict(`The code "${code}" is already in use.`);
    }
  }

  private async load(organizationId: number, id: string): Promise<DiscountRow> {
    const row = await this.repo.findById(organizationId, id);
    if (!row) throw DomainException.notFound('Discount code not found.');
    return row;
  }

  private stale(): DomainException {
    return DomainException.conflict(
      'This code changed elsewhere. Reload and try again.',
    );
  }
}
