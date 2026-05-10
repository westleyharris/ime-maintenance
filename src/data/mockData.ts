export interface Company {
  id: string;
  name: string;
  industry: string;
  country: string;
  status: 'active' | 'inactive';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId: string;
}

export interface AssetNode {
  id: string;
  name: string;
  type: 'site' | 'plant' | 'system' | 'equipment' | 'component';
  status: 'good' | 'warning' | 'critical';
  companyId: string;
  locationId?: string;
  children?: AssetNode[];
}

export interface WorkOrder {
  id: string;
  woNumber: string;
  type: 'preventive' | 'corrective' | 'emergency';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'closed' | 'cancelled';
  description: string;
  downtimeHours: number | null;
  companyId: string;
  createdAt: string;
}

export interface InspectionFinding {
  id: string;
  severity: 'warning' | 'critical';
  findingType: 'visual' | 'vibration' | 'thermal' | 'ultrasound';
  description: string;
  status: 'open' | 'closed';
  recommendation: string;
  reInspectionDate: string | null;
  companyId: string;
}

export interface PMSchedule {
  id: string;
  name: string;
  frequencyDays: number;
  nextDate: string;
  status: 'active' | 'inactive';
  type: 'preventive';
  priority: 'medium' | 'high';
  companyId: string;
}

// Companies
export const companies: Company[] = [
  { id: 'c1', name: 'Mock Company', industry: 'Manufacturing', country: 'United States', status: 'active' },
  { id: 'c2', name: 'Acme Industries', industry: 'Beverages', country: 'Honduras', status: 'active' },
];

// Users
export const users: User[] = [
  { id: 'u1', name: 'IME Admin', email: 'admin@ime-us.com', role: 'ime_admin', companyId: 'c1' },
  { id: 'u2', name: 'John Doe', email: 'john@mockcompany.com', role: 'company_admin', companyId: 'c1' },
  { id: 'u3', name: 'Maria Lopez', email: 'maria@acme.com', role: 'technician', companyId: 'c2' },
];

// Assets (hierarchical tree)
export const assets: AssetNode[] = [
  {
    id: 'a1',
    name: 'North Plant',
    type: 'site',
    status: 'critical',
    companyId: 'c1',
    children: [
      {
        id: 'a2',
        name: 'Lubrication Room A',
        type: 'plant',
        status: 'warning',
        companyId: 'c1',
        children: [
          {
            id: 'a3',
            name: 'Hydraulic Circuit #3',
            type: 'system',
            status: 'critical',
            companyId: 'c1',
            children: [
              { id: 'a4', name: 'Pump P-101', type: 'equipment', status: 'critical', companyId: 'c1' },
              { id: 'a5', name: 'Motor M-201', type: 'equipment', status: 'good', companyId: 'c1' },
            ],
          },
        ],
      },
      {
        id: 'a6',
        name: 'Compressor Bay',
        type: 'plant',
        status: 'good',
        companyId: 'c1',
        children: [
          {
            id: 'a7',
            name: 'Air System #1',
            type: 'system',
            status: 'good',
            companyId: 'c1',
            children: [
              { id: 'a8', name: 'Compressor C-301', type: 'equipment', status: 'good', companyId: 'c1' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'a9',
    name: 'South Warehouse',
    type: 'site',
    status: 'good',
    companyId: 'c1',
  },
];

// Work Orders
export const workOrders: WorkOrder[] = [
  {
    id: 'wo1',
    woNumber: 'WO-2026-0001',
    type: 'corrective',
    priority: 'medium',
    status: 'closed',
    description: 'Replace mechanical seal on pump P-101',
    downtimeHours: 4.5,
    companyId: 'c1',
    createdAt: '2026-03-15',
  },
  {
    id: 'wo2',
    woNumber: 'WO-2026-0002',
    type: 'preventive',
    priority: 'medium',
    status: 'cancelled',
    description: '[Auto-generated] Check bearings',
    downtimeHours: null,
    companyId: 'c1',
    createdAt: '2026-03-20',
  },
  {
    id: 'wo3',
    woNumber: 'WO-2026-0003',
    type: 'corrective',
    priority: 'high',
    status: 'open',
    description: 'Investigate abnormal vibration on compressor C-301',
    downtimeHours: null,
    companyId: 'c1',
    createdAt: '2026-04-01',
  },
  {
    id: 'wo4',
    woNumber: 'WO-2026-0004',
    type: 'preventive',
    priority: 'low',
    status: 'in_progress',
    description: 'Lubrication schedule - quarterly',
    downtimeHours: null,
    companyId: 'c1',
    createdAt: '2026-04-05',
  },
  {
    id: 'wo5',
    woNumber: 'WO-2026-0005',
    type: 'emergency',
    priority: 'critical',
    status: 'closed',
    description: 'Emergency shutdown - hydraulic leak detected',
    downtimeHours: 12,
    companyId: 'c1',
    createdAt: '2026-04-08',
  },
];

// Inspection Findings
export const inspectionFindings: InspectionFinding[] = [
  {
    id: 'if1',
    severity: 'warning',
    findingType: 'visual',
    description: 'Cavitation was found in pump impeller',
    status: 'open',
    recommendation: 'Visual inspection recommended',
    reInspectionDate: '2026-03-30',
    companyId: 'c1',
  },
  {
    id: 'if2',
    severity: 'critical',
    findingType: 'vibration',
    description: 'ML model (v2) predicted critical condition with 97% confidence',
    status: 'open',
    recommendation: '--',
    reInspectionDate: null,
    companyId: 'c1',
  },
  {
    id: 'if3',
    severity: 'critical',
    findingType: 'vibration',
    description: 'ML model (v2) predicted critical condition with 10% confidence',
    status: 'open',
    recommendation: '--',
    reInspectionDate: null,
    companyId: 'c1',
  },
  {
    id: 'if4',
    severity: 'critical',
    findingType: 'vibration',
    description: 'ML model (v2) predicted critical condition with 82% confidence',
    status: 'open',
    recommendation: '--',
    reInspectionDate: null,
    companyId: 'c1',
  },
  {
    id: 'if5',
    severity: 'critical',
    findingType: 'vibration',
    description: 'Vibration analysis detected critical condition. Affected bearing DE.',
    status: 'open',
    recommendation: 'Excessive vibration detected. Schedule maintenance.',
    reInspectionDate: null,
    companyId: 'c1',
  },
  {
    id: 'if6',
    severity: 'critical',
    findingType: 'vibration',
    description: 'Vibration analysis detected critical condition. Affected bearing NDE.',
    status: 'open',
    recommendation: 'Misalignment detected. Realign shaft.',
    reInspectionDate: null,
    companyId: 'c1',
  },
  {
    id: 'if7',
    severity: 'critical',
    findingType: 'vibration',
    description: 'Vibration analysis detected critical condition. Affected coupling.',
    status: 'open',
    recommendation: 'Misalignment detected. Realign shaft.',
    reInspectionDate: null,
    companyId: 'c1',
  },
];

// PM Schedules
export const pmSchedules: PMSchedule[] = [
  {
    id: 'pm1',
    name: 'Check bearings',
    frequencyDays: 30,
    nextDate: '2026-04-08',
    status: 'active',
    type: 'preventive',
    priority: 'medium',
    companyId: 'c1',
  },
  {
    id: 'pm2',
    name: 'Oil analysis - hydraulic system',
    frequencyDays: 90,
    nextDate: '2026-06-15',
    status: 'active',
    type: 'preventive',
    priority: 'high',
    companyId: 'c1',
  },
  {
    id: 'pm3',
    name: 'Compressor filter replacement',
    frequencyDays: 60,
    nextDate: '2026-05-01',
    status: 'inactive',
    type: 'preventive',
    priority: 'medium',
    companyId: 'c1',
  },
];

// Dashboard KPI helpers
export function calculateKPIs(companyId?: string) {
  const filteredWOs = companyId
    ? workOrders.filter(wo => wo.companyId === companyId)
    : workOrders;

  const closedCorrectiveWOs = filteredWOs.filter(
    wo => (wo.type === 'corrective' || wo.type === 'emergency') && wo.status === 'closed' && wo.downtimeHours
  );

  const totalDowntime = closedCorrectiveWOs.reduce((sum, wo) => sum + (wo.downtimeHours || 0), 0);
  const mttr = closedCorrectiveWOs.length > 0 ? totalDowntime / closedCorrectiveWOs.length : 0;
  const mtbf = closedCorrectiveWOs.length > 0 ? 720 / closedCorrectiveWOs.length : 0;
  const availability = mtbf + mttr > 0 ? (mtbf / (mtbf + mttr)) * 100 : 100;

  const openWOs = filteredWOs.filter(wo => wo.status === 'open' || wo.status === 'in_progress').length;

  const preventiveWOs = filteredWOs.filter(wo => wo.type === 'preventive');
  const closedPreventive = preventiveWOs.filter(wo => wo.status === 'closed').length;
  const pmCompliance = preventiveWOs.length > 0 ? (closedPreventive / preventiveWOs.length) * 100 : 0;

  const filteredFindings = companyId
    ? inspectionFindings.filter(f => f.companyId === companyId)
    : inspectionFindings;
  const criticalOpen = filteredFindings.filter(f => f.severity === 'critical' && f.status === 'open').length;

  return {
    mtbf: mtbf.toFixed(1),
    mttr: mttr.toFixed(1),
    availability: availability.toFixed(1),
    woBacklog: openWOs,
    pmCompliance: pmCompliance.toFixed(0),
    criticalFindings: criticalOpen,
  };
}

// Count assets by type
export function countAssetsByType(nodes: AssetNode[]): Record<string, number> {
  const counts: Record<string, number> = { site: 0, plant: 0, system: 0, equipment: 0, component: 0 };
  function walk(list: AssetNode[]) {
    for (const node of list) {
      counts[node.type] = (counts[node.type] || 0) + 1;
      if (node.children) walk(node.children);
    }
  }
  walk(nodes);
  return counts;
}
