import * as XLSX from 'xlsx';

/**
 * Export rows to an .xlsx download. Column headers come from the object keys,
 * in key order; column widths auto-fit to the longest value. Rows are exported
 * exactly as passed — callers hand in their current filtered/sorted view.
 */
export function exportToExcel(
  rows: Record<string, string | number | null | undefined>[],
  sheetName: string,
  fileBase: string,
) {
  if (rows.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns to content (capped so long descriptions don't explode)
  const keys = Object.keys(rows[0]);
  ws['!cols'] = keys.map(k => ({
    wch: Math.min(
      60,
      Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)) + 2,
    ),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileBase}_${stamp}.xlsx`);
}
