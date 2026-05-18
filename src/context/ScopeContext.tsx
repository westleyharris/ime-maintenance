import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface Company { id: string; name: string; }
interface Location { id: string; name: string; company_id: string; }

interface ScopeContextValue {
  // Selected scope
  selectedCompanyId: string | null;
  selectedLocationId: string | null;
  // Available options
  companies: Company[];
  locations: Location[];
  // Setters — only do anything for roles that can change them
  setCompany: (id: string | null) => void;
  setLocation: (id: string | null) => void;
  loading: boolean;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isImeAdmin = profile?.role === 'ime_admin';
  const canChangeLocation = profile?.role === 'ime_admin' || profile?.role === 'company_admin';

  // Load companies (ime_admin sees all, others see just their own)
  useEffect(() => {
    if (!profile) return;
    async function load() {
      if (isImeAdmin) {
        const { data } = await supabase.from('companies').select('id, name').order('name');
        setCompanies(data ?? []);
      } else if (profile?.company_id) {
        const { data } = await supabase.from('companies').select('id, name').eq('id', profile!.company_id).single();
        if (data) {
          setCompanies([data]);
          setSelectedCompanyId(data.id);
        }
      }
      setLoading(false);
    }
    load();
  }, [profile, isImeAdmin]);

  // Load locations when company changes
  useEffect(() => {
    if (!selectedCompanyId) { setLocations([]); setSelectedLocationId(null); return; }
    async function load() {
      const { data } = await supabase
        .from('locations')
        .select('id, name, company_id')
        .eq('company_id', selectedCompanyId)
        .order('name');
      setLocations(data ?? []);
      // plant_manager: lock to their assigned location_id
      if (profile?.role === 'plant_manager') {
        const assigned = profile.location_id
          ? (data ?? []).find(l => l.id === profile.location_id)
          : (data ?? [])[0];
        setSelectedLocationId(assigned?.id ?? null);
      }
    }
    load();
  }, [selectedCompanyId, profile?.role, profile?.location_id]);

  const setCompany = (id: string | null) => {
    if (!isImeAdmin) return;
    setSelectedCompanyId(id);
    setSelectedLocationId(null);
  };

  const setLocation = (id: string | null) => {
    if (!canChangeLocation) return;
    setSelectedLocationId(id);
  };

  return (
    <ScopeContext.Provider value={{
      selectedCompanyId, selectedLocationId,
      companies, locations,
      setCompany, setLocation,
      loading,
    }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope must be used within ScopeProvider');
  return ctx;
}
