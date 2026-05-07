import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, Plus, QrCode, Search,
  Building2, Factory, Settings2, Wrench, Upload, Cpu, Loader2,
} from 'lucide-react';
import { assets, companies, countAssetsByType, type AssetNode } from '../data/mockData';
import { useAssets } from '../context/AssetContext';
import { parseExcelToAssetTree } from '../utils/excelParser';

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

const statusColors: Record<string, string> = {
  good: 'bg-green-500',
  warning: 'bg-yellow-400',
  critical: 'bg-red-500',
};

const typeBadgeColors: Record<string, string> = {
  site: 'bg-blue-50 text-blue-700 border-blue-200',
  plant: 'bg-green-50 text-green-700 border-green-200',
  system: 'bg-orange-50 text-orange-700 border-orange-200',
  equipment: 'bg-gray-50 text-gray-700 border-gray-200',
  component: 'bg-purple-50 text-purple-700 border-purple-200',
};

function AssetTreeNode({ node, depth = 0 }: { node: AssetNode; depth?: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const Icon = typeIcons[node.type] || Building2;

  const typeKey = node.type as string;
  const typeLabel = t(`assets.${typeKey}`, { defaultValue: typeKey });

  return (
    <div>
      <div
        className="flex items-center py-2.5 px-2 hover:bg-gray-50 rounded-lg group cursor-pointer"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mr-1 text-gray-400 hover:text-gray-600"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-5 mr-1" />
        )}

        <Icon size={16} className={`mr-2 shrink-0 ${typeColors[node.type]}`} />

        <span className="text-sm font-medium text-gray-800 flex-1 truncate">{node.name}</span>

        <span className={`text-xs px-2.5 py-0.5 rounded border font-medium mr-3 shrink-0 ${typeBadgeColors[node.type] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
          {typeLabel}
        </span>

        <span className={`w-3 h-3 rounded-full shrink-0 ${statusColors[node.status]}`} />
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <AssetTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Assets() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState('c1');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { importedAssets, addImportedAsset } = useAssets();

  // Combine mock assets + imported assets filtered by company
  const baseAssets = assets.filter((a) => a.companyId === selectedCompany);
  const importedForCompany = importedAssets.filter((a) => a.companyId === selectedCompany);
  const allAssets = [...baseAssets, ...importedForCompany];

  const filteredAssets = searchTerm
    ? allAssets.filter((a) => a.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : allAssets;

  const counts = countAssetsByType(allAssets);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const tree = parseExcelToAssetTree(buffer, file.name, selectedCompany);
      addImportedAsset(tree);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setImporting(false);
      // Reset so same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900">{t('assets.title')}</h1>
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="px-4 py-2 rounded-lg text-sm border border-card-border bg-white text-gray-600"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Import Asset Tree button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-primary text-primary text-sm font-medium hover:bg-blue-50 transition-colors disabled:opacity-60"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? 'Importing…' : t('assets.importAssetTree', { defaultValue: 'Import Asset Tree' })}
          </button>

          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-card-border bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
            <QrCode size={16} />
            {t('assets.bulkPrintQR')}
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-light">
            <Plus size={16} />
            {t('assets.addAsset')}
          </button>
        </div>
      </div>

      {/* Import error */}
      {importError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {importError}
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
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 rounded-lg border border-card-border text-sm w-60"
            />
          </div>
        </div>

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

        <div className="p-5">
          {filteredAssets.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Building2 size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No assets found. Import a survey file to get started.</p>
            </div>
          ) : (
            filteredAssets.map((node) => (
              <AssetTreeNode key={node.id} node={node} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
