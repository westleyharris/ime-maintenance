import * as XLSX from 'xlsx';
import type { AssetNode } from '../data/mockData';

const SKIP_SHEETS = new Set(['COVER', 'Template', 'SITE SPECIFIC LUBRICANTS', 'TABLES']);

// Col indices (0-based) in each data sheet
const COL_FUNCTIONAL_LOCATION = 3; // Machine / Functional Location
const COL_SUB_SYSTEM = 5;          // Component / Sub System
const DATA_START_ROW = 30;         // 0-based index (row 31 in Excel)

function slug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function parseFilename(filename: string): { site: string; line: string } {
  const base = filename.replace(/\.[^.]+$/, '').trim(); // strip extension
  const parts = base.split(/\s+/);
  if (parts.length >= 2) {
    return { site: parts[0], line: parts.slice(1).join(' ') };
  }
  return { site: base, line: 'L1' };
}

function cellText(row: unknown[], colIdx: number): string {
  const val = row[colIdx];
  if (val == null) return '';
  return String(val).trim();
}

export function parseExcelToAssetTree(
  arrayBuffer: ArrayBuffer,
  filename: string,
  companyId: string,
): AssetNode {
  const { site, line } = parseFilename(filename);
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  const sectionNodes: AssetNode[] = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName)) continue;

    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Collect machines → components mapping
    const machineMap = new Map<string, Set<string>>();

    for (let i = DATA_START_ROW; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const machine = cellText(row, COL_FUNCTIONAL_LOCATION);
      const component = cellText(row, COL_SUB_SYSTEM);

      if (!machine) continue; // skip blank rows

      if (!machineMap.has(machine)) machineMap.set(machine, new Set());
      if (component) machineMap.get(machine)!.add(component);
    }

    if (machineMap.size === 0) continue; // nothing useful on this sheet

    const machineNodes: AssetNode[] = [];
    machineMap.forEach((components, machineName) => {
      const machineId = `${slug(site)}-${slug(line)}-${slug(sheetName)}-${slug(machineName)}`;
      const componentNodes: AssetNode[] = Array.from(components).map((compName) => ({
        id: `${machineId}-${slug(compName)}`,
        name: compName,
        type: 'component' as const,
        status: 'good' as const,
        companyId,
      }));

      machineNodes.push({
        id: machineId,
        name: machineName,
        type: 'equipment',
        status: 'good',
        companyId,
        children: componentNodes.length > 0 ? componentNodes : undefined,
      });
    });

    sectionNodes.push({
      id: `${slug(site)}-${slug(line)}-${slug(sheetName)}`,
      name: sheetName,
      type: 'system',
      status: 'good',
      companyId,
      children: machineNodes,
    });
  }

  const lineNode: AssetNode = {
    id: `${slug(site)}-${slug(line)}`,
    name: line,
    type: 'plant',
    status: 'good',
    companyId,
    children: sectionNodes,
  };

  const siteNode: AssetNode = {
    id: slug(site),
    name: site,
    type: 'site',
    status: 'good',
    companyId,
    children: [lineNode],
  };

  return siteNode;
}
