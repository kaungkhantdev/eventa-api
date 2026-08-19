/** What the home screen found outstanding across the modules it summarizes. */
export interface OutstandingCounts {
  pendingApprovals: number;
  declinedPayments: number;
  sellingOut: number;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertKind =
  'declined_payments' | 'pending_approvals' | 'selling_out';

export interface Bilingual {
  en: string;
  th: string;
}

export interface OperationalAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  count: number;
  message: Bilingual;
  /** Where to go and fix it — the owning module, which enforces its own rules. */
  href: string;
}

export interface AlertsView {
  alerts: OperationalAlert[];
  /** Set only when the list is empty, so the panel has something to say. */
  emptyMessage: string | null;
}

export const ALL_CAUGHT_UP = "You're all caught up.";

/** Most urgent first — the order US-DASH-06 asks the panel to render in. */
const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

interface AlertRule {
  kind: AlertKind;
  severity: AlertSeverity;
  /** True when only someone with finance access may see this at all. */
  finance: boolean;
  href: string;
  message: (count: number) => Bilingual;
}

const RULES: AlertRule[] = [
  {
    kind: 'declined_payments',
    severity: 'critical',
    finance: true,
    href: '/finance/payments?status=failed',
    message: (n) => ({
      en: `${n} payment${n === 1 ? '' : 's'} declined — the seats are still held.`,
      th: `การชำระเงิน ${n} รายการถูกปฏิเสธ — ที่นั่งยังถูกจองไว้`,
    }),
  },
  {
    kind: 'pending_approvals',
    severity: 'warning',
    finance: false,
    href: '/registrations?status=pending',
    message: (n) => ({
      en: `${n} registration${n === 1 ? '' : 's'} waiting for your decision.`,
      th: `มีการลงทะเบียน ${n} รายการรอการอนุมัติ`,
    }),
  },
  {
    kind: 'selling_out',
    severity: 'warning',
    finance: false,
    href: '/tickets?filter=low-stock',
    message: (n) => ({
      en: `${n} ticket type${n === 1 ? '' : 's'} nearly sold out.`,
      th: `บัตร ${n} ประเภทใกล้จะขายหมด`,
    }),
  },
];

/**
 * The home screen's action list (US-DASH-06).
 *
 * Two rules do the work. An alert appears only when its count is non-zero, so
 * the list is always things to actually do; and an alert the caller may not see
 * is OMITTED, not zeroed — US-DASH-13 is explicit that a figure you are not
 * permitted to see is hidden rather than shown as a placeholder, and a
 * "0 declined payments" line would disclose that the panel exists at all.
 *
 * A caller with nothing left they are allowed to see is genuinely caught up,
 * which is why the empty message is decided AFTER the permission filter.
 *
 * Nothing here resolves anything: every alert is a link into the module that
 * owns the problem and enforces its own permissions.
 *
 * US-DASH-06 also lists unconfirmed speakers and pending replies as examples.
 * Neither is sourced yet — `speakers` carries no confirmation state, and replies
 * belong to messaging (E7) — and an alert with no data behind it would be worse
 * than its absence. Add a rule here when the field exists; nothing else changes.
 */
export function buildAlerts(
  counts: OutstandingCounts,
  access: { finance: boolean },
): AlertsView {
  const alerts = RULES.filter(
    (rule) => rule.finance === false || access.finance,
  )
    .map((rule) => ({ rule, count: countFor(counts, rule.kind) }))
    .filter(({ count }) => count > 0)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.rule.severity] - SEVERITY_ORDER[b.rule.severity],
    )
    .map(({ rule, count }) => ({
      kind: rule.kind,
      severity: rule.severity,
      count,
      message: rule.message(count),
      href: rule.href,
    }));
  return { alerts, emptyMessage: alerts.length === 0 ? ALL_CAUGHT_UP : null };
}

const COUNT_OF: Record<AlertKind, keyof OutstandingCounts> = {
  declined_payments: 'declinedPayments',
  pending_approvals: 'pendingApprovals',
  selling_out: 'sellingOut',
};

function countFor(counts: OutstandingCounts, kind: AlertKind): number {
  return counts[COUNT_OF[kind]];
}
