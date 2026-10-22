import type {
  ExportFormat,
  TabularDocument,
} from '../../common/export/tabular';
import type { ExportRecord } from '../audit/audit.service';
import { SCOPE_SEPARATOR } from '../../common/constants/reports.constants';

/**
 * What the audit trail records about a report export (US-RPT-12 AC3: who
 * exported what, when, and for which scope).
 *
 * Who and when are the audit row's own columns. What and for which scope are
 * read off the document that was rendered — its title, the format, the rows it
 * carried, and the filters it states — so the trail describes the file that
 * actually left, not the request that asked for it.
 */

export function exportAuditEntry(
  format: ExportFormat,
  doc: TabularDocument,
): ExportRecord {
  const rows = doc.table.rows.length;
  const noun = rows === 1 ? 'row' : 'rows';
  return {
    title: `Exported the ${doc.title} report (${format.toUpperCase()}, ${rows} ${noun})`,
    scope: doc.filters
      .map((line) => `${line.label}: ${line.value}`)
      .join(SCOPE_SEPARATOR),
  };
}
