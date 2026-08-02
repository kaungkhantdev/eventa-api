import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type {
  DiscountSnapshot,
  DiscountStatus,
  DiscountType,
  UpdateDiscountInput,
} from './discounts.types';

/** Readable off a poster and typed without ambiguity. */
const CODE_PATTERN = /^[A-Z0-9-]+$/;
const CODE_MIN = 3;
const CODE_MAX = 24;
const PERCENT_MIN = 1;
const PERCENT_MAX = 100;
const MIN_FIXED_SATANG = 1;
/** A 0 limit means unlimited — for the total, per person, and the minimum order. */
const UNLIMITED = 0;

/**
 * The rules a discount code must satisfy (US-TKT-07/08/10). Pure and stateless.
 *
 * The through-line: a code that has been redeemed is a promise already made. Its
 * identity (the text) and its value are frozen from that moment, and its limit can
 * never fall below what has already been given away.
 */
@Injectable()
export class DiscountsPolicy {
  /** Uppercase storage makes matching case-insensitive without a functional index. */
  normaliseCode(raw: string): string {
    const code = raw.trim().toUpperCase();
    if (code.length < CODE_MIN || code.length > CODE_MAX) {
      throw DomainException.validation(
        `A code must be ${CODE_MIN}–${CODE_MAX} characters.`,
      );
    }
    if (!CODE_PATTERN.test(code)) {
      throw DomainException.validation(
        'A code can use letters, numbers and hyphens only.',
      );
    }
    return code;
  }

  assertValue(type: DiscountType, value: number): void {
    if (type === 'percent') {
      if (value >= PERCENT_MIN && value <= PERCENT_MAX) return;
      throw DomainException.validation(
        `A percentage discount must be between ${PERCENT_MIN} and ${PERCENT_MAX}.`,
      );
    }
    if (value >= MIN_FIXED_SATANG) return;
    throw DomainException.validation(
      'A fixed discount must be at least one satang.',
    );
  }

  /** Handing one person more redemptions than the promotion has is nonsense. */
  assertLimits(redemptionLimit: number, perPersonLimit: number): void {
    if (redemptionLimit === UNLIMITED || perPersonLimit === UNLIMITED) return;
    if (perPersonLimit <= redemptionLimit) return;
    throw DomainException.validation(
      `The per-person limit (${perPersonLimit}) can't exceed the total usage limit (${redemptionLimit}).`,
    );
  }

  assertWindow(
    validFrom: Date | null,
    validUntil: Date | null,
    now: Date,
  ): void {
    if (
      validFrom &&
      validUntil &&
      validUntil.getTime() <= validFrom.getTime()
    ) {
      throw DomainException.validation(
        'The end date must come after the start date.',
      );
    }
    if (validUntil && validUntil.getTime() < now.getTime()) {
      throw DomainException.validation(
        'That validity window has already expired — pick an end date in the future.',
      );
    }
  }

  /**
   * Once redeemed, the code text and its value are locked: everyone who used it
   * keeps exactly the deal they were given. Limits, scope, dates and the minimum
   * order stay tunable — narrowing them never reaches backwards.
   */
  assertChangeAllowedAfterUse(
    current: DiscountSnapshot,
    input: UpdateDiscountInput,
  ): void {
    if (
      input.redemptionLimit !== undefined &&
      input.redemptionLimit !== UNLIMITED &&
      input.redemptionLimit < current.used
    ) {
      throw DomainException.validation(
        `The usage limit can't drop below the ${current.used} redemptions already made.`,
      );
    }
    if (current.used === 0) return;
    const changesCode =
      input.code !== undefined &&
      input.code.trim().toUpperCase() !== current.code;
    const changesValue =
      (input.value !== undefined && input.value !== current.value) ||
      (input.type !== undefined && input.type !== current.type);
    if (!changesCode && !changesValue) return;
    throw DomainException.conflict(
      "The code and its value can't change after it has been used — create a new code instead.",
    );
  }

  /**
   * Status derived from the window and the usage count (US-TKT-10), so codes
   * turn on and off unattended. `disabled` is the organizer's own switch and is
   * never derived away.
   */
  resolveStatus(code: DiscountSnapshot, now: Date): DiscountStatus {
    if (code.status === 'disabled') return 'disabled';
    if (this.isExhausted(code) || this.isPastWindow(code, now)) {
      return 'expired';
    }
    if (code.validFrom && now.getTime() < code.validFrom.getTime()) {
      return 'scheduled';
    }
    return 'active';
  }

  /** Switching a code back on only works if it has room and time left to run. */
  assertRevivable(code: DiscountSnapshot, now: Date): void {
    if (!this.isExhausted(code) && !this.isPastWindow(code, now)) return;
    throw DomainException.conflict(
      'This code has expired — update its dates or usage limit to revive it.',
    );
  }

  isExhausted(code: { used: number; redemptionLimit: number }): boolean {
    return (
      code.redemptionLimit !== UNLIMITED && code.used >= code.redemptionLimit
    );
  }

  isPastWindow(code: { validUntil: Date | null }, now: Date): boolean {
    return (
      code.validUntil !== null && code.validUntil.getTime() < now.getTime()
    );
  }
}
