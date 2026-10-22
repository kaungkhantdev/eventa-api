/**
 * Whether selling `quantity` more would take a tier past its allocation
 * (US-DISC-06). An allocation of 0 is no exception at the till, whatever the
 * console calls it: `ck_ticket_types_sold` holds `sold` within `total`, so 0
 * sells nothing, and on a reserved event whose seats have ticket types it is
 * a type with no seats (US-EVT-05). Reading 0 as unlimited here let a paid
 * order through that the database then refused, so the money was taken and
 * nothing settled.
 */
export function exceedsAllocation(
  tier: { sold: number; total: number },
  quantity: number,
): boolean {
  return tier.sold + quantity > tier.total;
}
