import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { AssetNode } from '../data/mockData';

const STORAGE_KEY = 'ime-imported-assets';

interface AssetContextValue {
  importedAssets: AssetNode[];
  addImportedAsset: (node: AssetNode) => void;
  removeImportedAsset: (id: string) => void;
  clearImportedAssets: () => void;
}

const AssetContext = createContext<AssetContextValue | null>(null);

export function AssetProvider({ children }: { children: ReactNode }) {
  const [importedAssets, setImportedAssets] = useState<AssetNode[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as AssetNode[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(importedAssets));
  }, [importedAssets]);

  const addImportedAsset = (node: AssetNode) => {
    setImportedAssets((prev) => {
      // Replace if same site id already exists, otherwise append
      const exists = prev.findIndex((n) => n.id === node.id);
      if (exists >= 0) {
        const next = [...prev];
        next[exists] = node;
        return next;
      }
      return [...prev, node];
    });
  };

  const removeImportedAsset = (id: string) => {
    setImportedAssets((prev) => prev.filter((n) => n.id !== id));
  };

  const clearImportedAssets = () => setImportedAssets([]);

  return (
    <AssetContext.Provider value={{ importedAssets, addImportedAsset, removeImportedAsset, clearImportedAssets }}>
      {children}
    </AssetContext.Provider>
  );
}

export function useAssets() {
  const ctx = useContext(AssetContext);
  if (!ctx) throw new Error('useAssets must be used within AssetProvider');
  return ctx;
}
