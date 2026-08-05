import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, Search,
  Building2, Factory, Settings2, Wrench, Upload, Cpu, Loader2,
  MapPin, CheckCircle, AlertTriangle, Gauge,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAll';
import { useScope } from '../context/ScopeContext';
import { importUASHierarchy, type HierarchyResult } from '../utils/uasImporter';
import type { AssetNode } from '../data/mockData';
import EquipmentDetail from '../components/EquipmentDetail';

// ── Icons / colors ────────────────────────────────────────────────────────────

const typeIcons: Record<string, typeof Building2> = {
  site: Building2,
  plant: Factory,
  system: Settings2,
  equipment: Wrench,
  component: Cpu,
  point: Gauge,
};

const typeColors: Record<string, string> = {
  site: 'text-blue-500',
  plant: 'text-blue-600',
  system: 'text-orange-500',
  equipment: 'text-gray-500',
  component: 'text-purple-500',
  point: 'text-teal-500',
};

const typeBadgeColors: Record<string, string> = {
  site: 'bg-blue-50 text-blue-700 border-blue-200',
  plant: 'bg-green-50 text-green-700 border-green-200',
  system: 'bg-orange-50 text-orange-700 border-orange-200',
  equipment: 'bg-gray-50 text-gray-700 border-gray-200',
  component: 'bg-purple-50 text-purple-700 border-purple-200',
  point: 'bg-teal-50 text-teal-700 border-teal-200',
};

// Subtle status LED: worst alarm across a node's points, rolled up. Danger and
// Warning get a soft ring so they catch the eye without shouting; Normal is a
// small muted green dot; a node with no readings shows a blank spacer.
const ALARM_DOT: Record<string, string> = {
  Danger:  'bg-red-500 ring-2 ring-red-200',
  Warning: 'bg-orange-500 ring-2 ring-orange-100',
  Alert:   'bg-blue-400 ring-2 ring-blue-100',
  Normal:  'bg-emerald-400',
};

function AlarmDot({ level }: { level: AssetNode['alarm'] }) {
  if (!level) return <span className="w-2 mr-2 shrink-0" aria-hidden />;
  return (
    <span
      className={`w-2 h-2 rounded-full mr-2 shrink-0 ${ALARM_DOT[level] ?? ALARM_DOT.Normal}`}
      title={`${level}`}
    />
  );
}

// ── Tree node component ───────────────────────────────────────────────────────

function AssetTreeNode({
  node, depth = 0, onSelectEquipment,
}: {
  node: AssetNode;
  depth?: number;
  onSelectEquipment: (id: string, tag: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const Icon = typeIcons[node.type] || Building2;
  const typeLabel = t(`assets.${node.type}`, { defaultValue: node.type });
  const isEquipment = node.type === 'equipment';

  return (
    <div>
      <div
        className={`flex items-center py-2.5 px-2 rounded-lg group ${isEquipment ? 'hover:bg-blue-50 cursor-pointer' : 'hover:bg-gray-50 cursor-default'}`}
        // Tighter indent step on phones — 24px/level left deep nodes ~100px of
        // label width. The CSS var is set per breakpoint in index.css.
        style={{ paddingLeft: `calc(${depth} * var(--tree-indent, 24px) + 8px)` }}
        onClick={isEquipment ? () => onSelectEquipment(node.id, node.name) : undefined}
      >
        {hasChildren ? (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
            className="mr-1 text-gray-400 hover:text-gray-600"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-5 mr-1" />
        )}
        <AlarmDot level={node.alarm} />
        <Icon size={16} className={`mr-2 shrink-0 ${typeColors[node.type]}`} />
        <span className={`text-sm font-medium flex-1 truncate ${isEquipment ? 'text-primary group-hover:underline' : 'text-gray-800'}`}>
          {node.name}
        </span>
        {/* Type is already conveyed by the icon; the text badge costs ~70px that
            deep tree labels need on a phone. */}
        <span className={`hidden sm:inline text-xs px-2.5 py-0.5 rounded border font-medium mr-3 shrink-0 ${typeBadgeColors[node.type] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
          {typeLabel}
        </span>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children!.map(child => (
            <AssetTreeNode key={child.id} node={child} depth={depth + 1} onSelectEquipment={onSelectEquipment} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Supabase shape ────────────────────────────────────────────────────────────

interface DBPoint     { id: string; name: string; sensor_model: string | null; uas_order: number | null; }
interface DBComponent { id: string; name: string; uas_order: number | null; measurement_points: DBPoint[]; }
interface DBEquipment { id: string; tag: string; uas_order: number | null; components: DBComponent[]; }
interface DBSection   { id: string; uas_name: string; uas_order: number | null; equipment: DBEquipment[]; }
interface DBLine      { id: string; name: string; uas_order: number | null; sections: DBSection[]; }

// UAS3 orders siblings by process flow (Depalletizer → Airveyor → Filler → …),
// not alphabetically. Mirror that; fall back to name when order is missing.
function byUasOrder<T extends { uas_order: number | null }>(label: (x: T) => string) {
  return (a: T, b: T) => {
    const ao = a.uas_order, bo = b.uas_order;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    return label(a).localeCompare(label(b));
  };
}

function buildTree(
  locationId: string,
  locationName: string,
  companyId: string,
  lines: DBLine[],
): AssetNode {
  return {
    id: locationId,
    name: locationName,
    type: 'site',
    status: 'good',
    companyId,
    locationId,
    children: [...lines].sort(byUasOrder<DBLine>(l => l.name)).map(line => ({
      id: line.id,
      name: line.name,
      type: 'plant',
      status: 'good',
      companyId,
      locationId,
      children: [...(line.sections ?? [])].sort(byUasOrder<DBSection>(s => s.uas_name)).map(sec => ({
        id: sec.id,
        name: sec.uas_name,
        type: 'system',
        status: 'good',
        companyId,
        locationId,
        children: [...(sec.equipment ?? [])].sort(byUasOrder<DBEquipment>(e => e.tag)).map(eq => ({
          id: eq.id,
          name: eq.tag,
          type: 'equipment',
          status: 'good',
          companyId,
          locationId,
          children: [...(eq.components ?? [])].sort(byUasOrder<DBComponent>(c => c.name)).map(comp => ({
            id: comp.id,
            name: comp.name,
            type: 'component',
            status: 'good',
            companyId,
            locationId,
            children: [...(comp.measurement_points ?? [])].sort(byUasOrder<DBPoint>(p => p.name)).map(pt => ({
              id: pt.id,
              name: pt.sensor_model ? `${pt.name} · ${pt.sensor_model}` : pt.name,
              type: 'point',
              status: 'good',
              companyId,
              locationId,
            })),
          })),
        })),
      })),
    })),
  };
}

const ALARM_RANK: Record<string, number> = { Normal: 0, Alert: 1, Warning: 2, Danger: 3 };
const RANK_ALARM = ['Normal', 'Alert', 'Warning', 'Danger'] as const;

// Annotate every node with the worst current alarm among its measurement points,
// rolling up leaf → root so a collapsed branch still signals what's inside.
function annotateAlarms(node: AssetNode, pointAlarm: Map<string, string>): AssetNode['alarm'] {
  if (node.type === 'point') {
    node.alarm = (pointAlarm.get(node.id) as AssetNode['alarm']) ?? 'Normal';
    return node.alarm;
  }
  let worst = -1;
  for (const child of node.children ?? []) {
    const a = annotateAlarms(child, pointAlarm);
    if (a && ALARM_RANK[a] > worst) worst = ALARM_RANK[a];
  }
  node.alarm = worst >= 0 ? RANK_ALARM[worst] : null;
  return node.alarm;
}

function countNodes(node: AssetNode): Record<string, number> {
  const counts: Record<string, number> = { site: 0, plant: 0, system: 0, equipment: 0, component: 0, point: 0 };
  function walk(n: AssetNode) {
    counts[n.type] = (counts[n.type] || 0) + 1;
    n.children?.forEach(walk);
  }
  walk(node);
  return counts;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Assets() {
  const { t } = useTranslation();
  const { selectedCompanyId, selectedLocationId, locations } = useScope();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tree, setTree] = useState<AssetNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<HierarchyResult | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<{ id: string; tag: string } | null>(null);

  const selectedLocation = locations.find(l => l.id === selectedLocationId);

  // ── Fetch asset hierarchy from Supabase ──────────────────────────────────
  const fetchAssets = useCallback(async () => {
    if (!selectedCompanyId || !selectedLocationId) { setTree(null); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('lines')
      .select(`
        id, name, uas_order,
        sections (
          id, uas_name, uas_order,
          equipment (
            id, tag, uas_order,
            components (
              id, name, uas_order,
              measurement_points ( id, name, sensor_model, uas_order )
            )
          )
        )
      `)
      .eq('location_id', selectedLocationId)
      .eq('company_id', selectedCompanyId)
      .order('uas_order', { nullsFirst: false })
      .order('name');

    if (!error && data && data.length > 0 && selectedLocation) {
      const built = buildTree(selectedLocationId, selectedLocation.name, selectedCompanyId, data as DBLine[]);

      // Latest alarm level per measurement point for this location, then roll up.
      const { rows: measRows } = await fetchAllRows<{ measurement_point_id: string; alarm_level: string | null; measured_at: string | null }>(
        (from, to) => supabase
          .from('measurements')
          .select('measurement_point_id, alarm_level, measured_at')
          .eq('location_id', selectedLocationId)
          .order('measured_at', { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: { measurement_point_id: string; alarm_level: string | null; measured_at: string | null }[] | null; error: unknown }>,
      );
      const pointAlarm = new Map<string, string>();
      for (const m of measRows) {
        if (m.measurement_point_id && !pointAlarm.has(m.measurement_point_id)) {
          pointAlarm.set(m.measurement_point_id, m.alarm_level ?? 'Normal');
        }
      }
      annotateAlarms(built, pointAlarm);
      setTree(built);
    } else {
      setTree(null);
    }
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId, selectedLocation]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  // ── Import handler ───────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedCompanyId || !selectedLocationId) {
      setImportResult({
        lines: 0, sections: 0, equipment: 0,
        components: 0, measurementPoints: 0,
        errors: ['Select a company and location in the header before importing.'],
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = await importUASHierarchy(buffer, selectedCompanyId, selectedLocationId);
      setImportResult(result);
      if (!result.errors.length) await fetchAssets();
    } catch (err) {
      setImportResult({
        lines: 0, sections: 0, equipment: 0,
        components: 0, measurementPoints: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const counts = tree ? countNodes(tree) : null;

  const filterTree = (node: AssetNode, q: string): AssetNode | null => {
    if (!q) return node;
    const match = node.name.toLowerCase().includes(q);
    const filteredChildren = node.children
      ?.map(c => filterTree(c, q))
      .filter((c): c is AssetNode => c !== null);
    if (match || (filteredChildren && filteredChildren.length > 0)) {
      return { ...node, children: filteredChildren };
    }
    return null;
  };

  const displayTree = searchTerm && tree
    ? filterTree(tree, searchTerm.toLowerCase())
    : tree;

  // ── Equipment detail view ────────────────────────────────────────────────
  if (selectedEquipment) {
    return (
      <EquipmentDetail
        equipmentId={selectedEquipment.id}
        equipmentTag={selectedEquipment.tag}
        onBack={() => setSelectedEquipment(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('assets.title')}</h1>
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <button
            disabled={importing || true}
            title="Excel import is disabled — the asset tree now syncs live from UAS3"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-gray-400 text-sm font-medium cursor-not-allowed"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Import Asset Tree
          </button>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className={`flex items-start gap-3 px-5 py-4 rounded-xl border mb-4 ${importResult.errors.length ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          {importResult.errors.length
            ? <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            : <CheckCircle size={18} className="text-green-500 shrink-0 mt-0.5" />
          }
          <div>
            {importResult.errors.length
              ? <p className="text-sm font-semibold text-red-700">{importResult.errors.join(' · ')}</p>
              : (
                <>
                  <p className="text-sm font-semibold text-green-700">Asset tree imported</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    {importResult.equipment} equipment · {importResult.components} components · {importResult.sections} sections · {importResult.lines} lines
                  </p>
                </>
              )
            }
          </div>
        </div>
      )}

      <div className="bg-card-bg rounded-xl border border-card-border">
        <div className="flex items-center justify-between p-5 pb-0">
          <h2 className="text-lg font-semibold text-gray-900">{t('assets.title')}</h2>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t('assets.search')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 rounded-lg border border-card-border text-sm w-60"
            />
          </div>
        </div>

        {counts && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3 sm:py-4 border-b border-card-border">
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <Building2 size={14} className="text-blue-500" />
              {t('assets.site')} <span className="font-semibold text-gray-900 ml-1">{counts.site}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <Factory size={14} className="text-blue-600" />
              {t('assets.plant')} <span className="font-semibold text-gray-900 ml-1">{counts.plant}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <Settings2 size={14} className="text-orange-500" />
              {t('assets.system')} <span className="font-semibold text-gray-900 ml-1">{counts.system}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <Wrench size={14} className="text-gray-500" />
              {t('assets.equipment')} <span className="font-semibold text-gray-900 ml-1">{counts.equipment}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <Cpu size={14} className="text-purple-500" />
              {t('assets.component', { defaultValue: 'Component' })} <span className="font-semibold text-gray-900 ml-1">{counts.component}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-600">
              <Gauge size={14} className="text-teal-500" />
              {t('assets.point', { defaultValue: 'Point' })} <span className="font-semibold text-gray-900 ml-1">{counts.point}</span>
            </div>
            {/* Alarm-dot legend — the dot before each asset shows its worst reading */}
            <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-400">
              {(['Danger', 'Warning', 'Alert', 'Normal'] as const).map(l => (
                <span key={l} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${ALARM_DOT[l]}`} />{l}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="p-5">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 size={24} className="animate-spin text-gray-300" />
            </div>
          ) : !selectedCompanyId ? (
            <div className="text-center py-12 text-gray-400">
              <Building2 size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No company selected</p>
              <p className="text-xs mt-1">Select a company from the header to view assets</p>
            </div>
          ) : !selectedLocationId ? (
            <div className="text-center py-12 text-gray-400">
              <MapPin size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No location selected</p>
              <p className="text-xs mt-1">Select a location from the header to view assets</p>
            </div>
          ) : !displayTree ? (
            <div className="text-center py-12 text-gray-400">
              <Wrench size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No assets found</p>
              <p className="text-xs mt-1">Import a UAS Export file to build the asset tree</p>
            </div>
          ) : (
            <AssetTreeNode
              node={displayTree}
              onSelectEquipment={(id, tag) => setSelectedEquipment({ id, tag })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
