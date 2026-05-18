import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, Search,
  Building2, Factory, Settings2, Wrench, Upload, Cpu, Loader2,
  MapPin, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
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
};

const typeColors: Record<string, string> = {
  site: 'text-blue-500',
  plant: 'text-blue-600',
  system: 'text-orange-500',
  equipment: 'text-gray-500',
  component: 'text-purple-500',
};

const typeBadgeColors: Record<string, string> = {
  site: 'bg-blue-50 text-blue-700 border-blue-200',
  plant: 'bg-green-50 text-green-700 border-green-200',
  system: 'bg-orange-50 text-orange-700 border-orange-200',
  equipment: 'bg-gray-50 text-gray-700 border-gray-200',
  component: 'bg-purple-50 text-purple-700 border-purple-200',
};

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
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
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
        <Icon size={16} className={`mr-2 shrink-0 ${typeColors[node.type]}`} />
        <span className={`text-sm font-medium flex-1 truncate ${isEquipment ? 'text-primary group-hover:underline' : 'text-gray-800'}`}>
          {node.name}
        </span>
        <span className={`text-xs px-2.5 py-0.5 rounded border font-medium mr-3 shrink-0 ${typeBadgeColors[node.type] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
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

interface DBComponent { id: string; name: string; }
interface DBEquipment { id: string; tag: string; components: DBComponent[]; }
interface DBSection   { id: string; uas_name: string; equipment: DBEquipment[]; }
interface DBLine      { id: string; name: string; sections: DBSection[]; }

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
    children: lines.map(line => ({
      id: line.id,
      name: line.name,
      type: 'plant',
      status: 'good',
      companyId,
      locationId,
      children: line.sections.map(sec => ({
        id: sec.id,
        name: sec.uas_name,
        type: 'system',
        status: 'good',
        companyId,
        locationId,
        children: sec.equipment.map(eq => ({
          id: eq.id,
          name: eq.tag,
          type: 'equipment',
          status: 'good',
          companyId,
          locationId,
          children: eq.components.map(comp => ({
            id: comp.id,
            name: comp.name,
            type: 'component',
            status: 'good',
            companyId,
            locationId,
          })),
        })),
      })),
    })),
  };
}

function countNodes(node: AssetNode): Record<string, number> {
  const counts: Record<string, number> = { site: 0, plant: 0, system: 0, equipment: 0, component: 0 };
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
        id, name,
        sections (
          id, uas_name,
          equipment (
            id, tag,
            components ( id, name )
          )
        )
      `)
      .eq('location_id', selectedLocationId)
      .eq('company_id', selectedCompanyId)
      .order('name');

    if (!error && data && data.length > 0 && selectedLocation) {
      setTree(buildTree(selectedLocationId, selectedLocation.name, selectedCompanyId, data as DBLine[]));
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
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-blue-50 transition-colors disabled:opacity-60"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? 'Importing…' : 'Import Asset Tree'}
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
          <div className="flex items-center gap-6 px-5 py-4 border-b border-card-border">
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
