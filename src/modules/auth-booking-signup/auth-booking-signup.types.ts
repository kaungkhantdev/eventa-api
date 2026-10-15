import type { localeEnum, orderStatusEnum } from '../../db/schema';

/** The two languages Eventa writes to people in — the `locale` enum's values. */
export type Locale = (typeof localeEnum.enumValues)[number];

/** Where a booking stands — the `order_status` enum's values, Checkout's to set. */
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
