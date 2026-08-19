import { ALL_CAUGHT_UP, buildAlerts } from './alerts';

const counts = (o: Record<string, number> = {}) => ({
  pendingApprovals: 0,
  declinedPayments: 0,
  sellingOut: 0,
  ...o,
});

describe('Operational alerts (US-DASH-06)', () => {
  it('says you are all caught up when nothing is outstanding', () => {
    const result = buildAlerts(counts(), { finance: true });
    expect(result.alerts).toHaveLength(0);
    expect(result.emptyMessage).toBe(ALL_CAUGHT_UP);
  });

  it('raises a declined payment as the most urgent thing on the list', () => {
    const result = buildAlerts(
      counts({ pendingApprovals: 3, declinedPayments: 1, sellingOut: 2 }),
      { finance: true },
    );
    expect(result.alerts[0].kind).toBe('declined_payments');
    expect(result.alerts[0].severity).toBe('critical');
  });

  it('orders by severity, most urgent first', () => {
    const result = buildAlerts(
      counts({
        pendingApprovals: 3,
        declinedPayments: 1,
        sellingOut: 1,
      }),
      { finance: true },
    );
    const severities = result.alerts.map((a) => a.severity);
    expect(severities).toEqual([...severities].sort(bySeverity));
  });

  it('raises only what is actually outstanding', () => {
    const result = buildAlerts(counts({ pendingApprovals: 2 }), {
      finance: true,
    });
    expect(result.alerts.map((a) => a.kind)).toEqual(['pending_approvals']);
    expect(result.alerts[0].count).toBe(2);
  });

  it('links every alert to the module that can resolve it', () => {
    const result = buildAlerts(
      counts({ pendingApprovals: 1, declinedPayments: 1, sellingOut: 1 }),
      { finance: true },
    );
    for (const alert of result.alerts) {
      expect(alert.href).toMatch(/^\//);
    }
    expect(result.alerts.map((a) => a.href)).toEqual([
      ...new Set(result.alerts.map((a) => a.href)),
    ]);
  });

  describe('permissions (US-DASH-06/13)', () => {
    it('hides a finance alert entirely from someone without finance access', () => {
      const result = buildAlerts(
        counts({ declinedPayments: 4, pendingApprovals: 1 }),
        { finance: false },
      );
      expect(result.alerts.map((a) => a.kind)).toEqual(['pending_approvals']);
    });

    it('does not leak the finance count as a zero', () => {
      // "Hidden — never shown as zero or a placeholder" (US-DASH-13).
      const result = buildAlerts(counts({ declinedPayments: 4 }), {
        finance: false,
      });
      expect(result.alerts).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain('declined');
    });

    it('still says caught-up when the only issue is one you may not see', () => {
      const result = buildAlerts(counts({ declinedPayments: 9 }), {
        finance: false,
      });
      expect(result.emptyMessage).toBe(ALL_CAUGHT_UP);
    });
  });

  it('carries a bilingual message for every alert it raises', () => {
    const result = buildAlerts(
      counts({ pendingApprovals: 1, declinedPayments: 1 }),
      { finance: true },
    );
    for (const alert of result.alerts) {
      expect(alert.message.en.length).toBeGreaterThan(0);
      expect(alert.message.th.length).toBeGreaterThan(0);
    }
  });
});

const ORDER = { critical: 0, warning: 1, info: 2 } as const;
const bySeverity = (a: keyof typeof ORDER, b: keyof typeof ORDER) =>
  ORDER[a] - ORDER[b];
