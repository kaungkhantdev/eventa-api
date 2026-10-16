import type { TabularDocument } from '../../common/export/tabular';
import { exportAuditEntry } from './report-export-audit';

/**
 * What the audit trail says about a report export (US-RPT-12 AC3).
 *
 * The actor and the moment are the audit row's own columns; what this owns is
 * the "what" and the "for which scope", worded for whoever reads the trail.
 */

function doc(over: Partial<TabularDocument> = {}): TabularDocument {
  return {
    title: 'Registrations',
    sheetName: 'Registrations',
    generatedAt: new Date('2026-09-22T07:05:00.000Z'),
    filters: [
      { label: 'Period', value: '1 Jul 2026 – 31 Jul 2026' },
      { label: 'Event', value: 'Charity Gala' },
      { label: 'Search', value: 'gala' },
    ],
    summary: [],
    table: { columns: [], rows: [['a'], ['b']] },
    matched: 2,
    ...over,
  };
}

describe('exportAuditEntry', () => {
  it('names the report, the file format and how many rows left', () => {
    expect(exportAuditEntry('csv', doc()).title).toBe(
      'Exported the Registrations report (CSV, 2 rows)',
    );
  });

  it('says "row" for one', () => {
    const one = doc({ table: { columns: [], rows: [['a']] }, matched: 1 });
    expect(exportAuditEntry('xlsx', one).title).toBe(
      'Exported the Registrations report (XLSX, 1 row)',
    );
  });

  it('records the scope as the filters the file itself states', () => {
    expect(exportAuditEntry('pdf', doc()).scope).toBe(
      'Period: 1 Jul 2026 – 31 Jul 2026 · Event: Charity Gala · Search: gala',
    );
  });
});
