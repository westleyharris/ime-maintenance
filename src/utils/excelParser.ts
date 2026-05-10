import * as XLSX from 'xlsx';
import type { AssetNode } from '../data/mockData';

const SKIP_SHEETS = new Set(['COVER', 'Template', 'SITE SPECIFIC LUBRICANTS', 'TABLES']);

const COL_FUNCTIONAL_LOCATION = 3;
const COL_SUB_SYSTEM = 5;
const DATA_START_ROW = 30; // 0-based (row 31 in Excel)

function slug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Strip the location name prefix from the filename to get just the line name.
// "Niles L2.xlsx" + locationName "Niles" → "L2"
function extractLineName(filename: string, locationName: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  const prefix = locationName.trim().toLowerCase();
  const baseLower = base.toLowerCase();
  if (prefix && baseLower.startsWith(prefix)) {
    const remainder = base.slice(locationName.trim().length).trim();
    if (remainder) return remainder;
  }
  // Fallback: everything after the first word
  const parts = base.split(/\s+/);
  return parts.length >= 2 ? parts.slice(1).join(' ') : base;
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
  locationId: string,
  locationName: string,
): AssetNode {
  const lineName = extractLineName(filename, locationName);
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  const sectionNodes: AssetNode[] = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName)) continue;

    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const machineMap = new Map<string, Set<string>>();

    for (let i = DATA_START_ROW; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const machine = cellText(row, COL_FUNCTIONAL_LOCATION);
      const component = cellText(row, COL_SUB_SYSTEM);
      if (!machine) continue;
      if (!machineMap.has(machine)) machineMap.set(machine, new Set());
      if (component) machineMap.get(machine)!.add(component);
    }

    if (machineMap.size === 0) continue;

    const machineNodes: AssetNode[] = [];
    machineMap.forEach((components, machineName) => {
      const machineId = `${slug(locationName)}-${slug(lineName)}-${slug(sheetName)}-${slug(machineName)}`;
      const componentNodes: AssetNode[] = Array.from(components).map(compName => ({
        id: `${machineId}-${slug(compName)}`,
        name: compName,
        type: 'component' as const,
        status: 'good' as const,
        companyId,
        locationId,
      }));
      machineNodes.push({
        id: machineId,
        name: machineName,
        type: 'equipment',
        status: 'good',
        companyId,
        locationId,
        children: componentNodes.length > 0 ? componentNodes : undefined,
      });
    });

    sectionNodes.push({
      id: `${slug(locationName)}-${slug(lineName)}-${slug(sheetName)}`,
      name: sheetName,
      type: 'system',
      status: 'good',
      companyId,
      locationId,
      children: machineNodes,
    });
  }

  const lineNode: AssetNode = {
    id: `${slug(locationName)}-${slug(lineName)}`,
    name: lineName,
    type: 'plant',
    status: 'good',
    companyId,
    locationId,
    children: sectionNodes,
  };

  return {
    id: `${slug(locationName)}`,
    name: locationName,
    type: 'site',
    status: 'good',
    companyId,
    locationId,
    children: [lineNode],
  };
}
