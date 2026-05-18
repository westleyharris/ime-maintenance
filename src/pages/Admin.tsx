import { useState, useEffect, useCallback } from 'react';
import { Building2, MapPin, Users, Plus, Loader2, X, ChevronRight, Check, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { UserRole } from '../types/auth';

interface Company  { id: string; name: string; industry: string | null; country: string | null; }
interface Location { id: string; name: string; company_id: string; }
interface UserRow  { id: string; email: string; full_name: string | null; role: UserRole; company_id: string | null; location_id: string | null; }

type ActiveTab = 'companies' | 'users';

const ROLE_LABELS: Record<UserRole, string> = {
  ime_admin:     'IME Admin',
  company_admin: 'Company Admin',
  plant_manager: 'Plant Manager',
};

const ROLE_BADGE: Record<UserRole, string> = {
  ime_admin:     'bg-sidebar/10 text-sidebar border-sidebar/20',
  company_admin: 'bg-blue-50 text-blue-700 border-blue-200',
  plant_manager: 'bg-green-50 text-green-700 border-green-200',
};

export default function Admin() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('companies');

  // ── Companies ──────────────────────────────────────────────────────────────
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  // ── Locations ──────────────────────────────────────────────────────────────
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);

  // ── Users ──────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [allLocations, setAllLocations] = useState<Location[]>([]);

  // ── Add Company form ───────────────────────────────────────────────────────
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyIndustry, setNewCompanyIndustry] = useState('');
  const [newCompanyCountry, setNewCompanyCountry] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyError, setCompanyError] = useState('');

  // ── Add Location form ──────────────────────────────────────────────────────
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationError, setLocationError] = useState('');

  // ── Invite user ────────────────────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('plant_manager');
  const [inviteCompanyId, setInviteCompanyId] = useState<string | null>(null);
  const [inviteLocationId, setInviteLocationId] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  // ── User editing ───────────────────────────────────────────────────────────
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('plant_manager');
  const [editCompanyId, setEditCompanyId] = useState<string | null>(null);
  const [editLocationId, setEditLocationId] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [userError, setUserError] = useState('');

  // ── Fetch companies ────────────────────────────────────────────────────────
  const fetchCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    const { data } = await supabase.from('companies').select('id, name, industry, country').order('name');
    setCompanies(data ?? []);
    setLoadingCompanies(false);
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  // ── Fetch locations for selected company ───────────────────────────────────
  useEffect(() => {
    if (!selectedCompanyId) { setLocations([]); return; }
    setLoadingLocations(true);
    supabase.from('locations').select('id, name, company_id').eq('company_id', selectedCompanyId).order('name')
      .then(({ data }) => { setLocations(data ?? []); setLoadingLocations(false); });
  }, [selectedCompanyId]);

  // ── Fetch users + all locations when users tab active ──────────────────────
  useEffect(() => {
    if (activeTab !== 'users') return;
    setLoadingUsers(true);
    Promise.all([
      supabase.from('profiles').select('id, email, full_name, role, company_id, location_id').order('full_name'),
      supabase.from('locations').select('id, name, company_id').order('name'),
    ]).then(([usersRes, locsRes]) => {
      setUsers(usersRes.data ?? []);
      setAllLocations(locsRes.data ?? []);
      setLoadingUsers(false);
    });
  }, [activeTab]);

  // ── Create company ─────────────────────────────────────────────────────────
  const handleCreateCompany = async () => {
    if (!newCompanyName.trim()) { setCompanyError('Company name is required.'); return; }
    setSavingCompany(true); setCompanyError('');
    const { error } = await supabase.from('companies').insert({
      name: newCompanyName.trim(),
      industry: newCompanyIndustry.trim() || null,
      country: newCompanyCountry.trim() || null,
    });
    if (error) { setCompanyError(error.message); } else {
      setNewCompanyName(''); setNewCompanyIndustry(''); setNewCompanyCountry('');
      setShowAddCompany(false); await fetchCompanies();
    }
    setSavingCompany(false);
  };

  // ── Create location ────────────────────────────────────────────────────────
  const handleCreateLocation = async () => {
    if (!newLocationName.trim()) { setLocationError('Location name is required.'); return; }
    if (!selectedCompanyId) return;
    setSavingLocation(true); setLocationError('');
    const { error } = await supabase.from('locations').insert({ name: newLocationName.trim(), company_id: selectedCompanyId });
    if (error) { setLocationError(error.message); } else {
      setNewLocationName(''); setShowAddLocation(false);
      const { data } = await supabase.from('locations').select('id, name, company_id').eq('company_id', selectedCompanyId).order('name');
      setLocations(data ?? []);
    }
    setSavingLocation(false);
  };

  // ── Start editing user ─────────────────────────────────────────────────────
  const startEdit = (u: UserRow) => {
    setEditingUserId(u.id);
    setEditRole(u.role);
    setEditCompanyId(u.company_id);
    setEditLocationId(u.location_id);
    setUserError('');
  };

  // ── Save user assignment ───────────────────────────────────────────────────
  const saveUser = async () => {
    if (!editingUserId) return;
    if (editRole !== 'ime_admin' && !editCompanyId) { setUserError('Company is required for this role.'); return; }
    if (editRole === 'plant_manager' && !editLocationId) { setUserError('Location is required for Plant Manager.'); return; }
    setSavingUser(true); setUserError('');

    const updates: Record<string, unknown> = {
      role: editRole,
      company_id: editRole === 'ime_admin' ? null : editCompanyId,
      location_id: editRole === 'plant_manager' ? editLocationId : null,
    };

    const { error } = await supabase.from('profiles').update(updates).eq('id', editingUserId);
    if (error) { setUserError(error.message); setSavingUser(false); return; }

    // Sync JWT app_metadata so scope changes take effect on next login
    try { await supabase.rpc('sync_user_metadata', { user_id: editingUserId }); } catch { /* best-effort */ }

    setUsers(prev => prev.map(u => u.id === editingUserId ? { ...u, ...updates } as UserRow : u));
    setEditingUserId(null);
    setSavingUser(false);
  };

  // ── Send invite ────────────────────────────────────────────────────────────
  const sendInvite = async () => {
    if (!inviteEmail.trim()) { setInviteError('Email is required.'); return; }
    if (inviteRole !== 'ime_admin' && !inviteCompanyId) { setInviteError('Company is required for this role.'); return; }
    if (inviteRole === 'plant_manager' && !inviteLocationId) { setInviteError('Location is required for Plant Manager.'); return; }
    setSendingInvite(true); setInviteError(''); setInviteSuccess('');

    const { error } = await supabase.functions.invoke('invite-user', {
      body: {
        email: inviteEmail.trim(),
        full_name: inviteFullName.trim() || null,
        role: inviteRole,
        company_id: inviteRole === 'ime_admin' ? null : inviteCompanyId,
        location_id: inviteRole === 'plant_manager' ? inviteLocationId : null,
      },
    });

    if (error) {
      setInviteError(error.message ?? 'Failed to send invite.');
    } else {
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail(''); setInviteFullName('');
      setInviteRole('plant_manager'); setInviteCompanyId(null); setInviteLocationId(null);
      // Refresh user list so pending invitee appears
      const { data } = await supabase.from('profiles').select('id, email, full_name, role, company_id, location_id').order('full_name');
      setUsers(data ?? []);
    }
    setSendingInvite(false);
  };

  const locationsForEdit = editCompanyId ? allLocations.filter(l => l.company_id === editCompanyId) : [];
  const locationsForInvite = inviteCompanyId ? allLocations.filter(l => l.company_id === inviteCompanyId) : [];
  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
        <p className="text-sm text-gray-500">Manage companies, locations, and users</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {(['companies', 'users'] as ActiveTab[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab ? 'text-primary border-primary' : 'text-gray-400 border-transparent hover:text-gray-600'
            }`}
          >
            {tab === 'companies' ? 'Companies & Locations' : 'Users'}
          </button>
        ))}
      </div>

      {/* ── Companies & Locations ── */}
      {activeTab === 'companies' && (
        <div className="grid grid-cols-2 gap-5">
          {/* Companies */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900">Companies</h2>
              </div>
              <button onClick={() => { setShowAddCompany(v => !v); setCompanyError(''); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-light transition-colors">
                <Plus size={13} /> Add Company
              </button>
            </div>

            {showAddCompany && (
              <div className="mb-4 p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">New Company</p>
                  <button onClick={() => setShowAddCompany(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
                <input placeholder="Company name *" value={newCompanyName} onChange={e => setNewCompanyName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <input placeholder="Industry (optional)" value={newCompanyIndustry} onChange={e => setNewCompanyIndustry(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <input placeholder="Country (optional)" value={newCompanyCountry} onChange={e => setNewCompanyCountry(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
                {companyError && <p className="text-xs text-red-600">{companyError}</p>}
                <button onClick={handleCreateCompany} disabled={savingCompany}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-light disabled:opacity-60 transition-colors">
                  {savingCompany && <Loader2 size={12} className="animate-spin" />} Create Company
                </button>
              </div>
            )}

            {loadingCompanies ? (
              <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
            ) : companies.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No companies yet</p>
            ) : (
              <div className="space-y-1.5">
                {companies.map(c => (
                  <button key={c.id} onClick={() => setSelectedCompanyId(selectedCompanyId === c.id ? null : c.id)}
                    className={`w-full text-left flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                      selectedCompanyId === c.id ? 'border-primary bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                      {(c.industry || c.country) && (
                        <p className="text-xs text-gray-400 mt-0.5">{[c.industry, c.country].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <ChevronRight size={14} className={`text-gray-300 transition-transform ${selectedCompanyId === c.id ? 'rotate-90' : ''}`} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Locations */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900">
                  {selectedCompany ? `${selectedCompany.name} — Locations` : 'Locations'}
                </h2>
              </div>
              {selectedCompanyId && (
                <button onClick={() => { setShowAddLocation(v => !v); setLocationError(''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-light transition-colors">
                  <Plus size={13} /> Add Location
                </button>
              )}
            </div>

            {showAddLocation && selectedCompanyId && (
              <div className="mb-4 p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">New Location</p>
                  <button onClick={() => setShowAddLocation(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
                <input placeholder="Location name *" value={newLocationName} onChange={e => setNewLocationName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
                {locationError && <p className="text-xs text-red-600">{locationError}</p>}
                <button onClick={handleCreateLocation} disabled={savingLocation}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-light disabled:opacity-60 transition-colors">
                  {savingLocation && <Loader2 size={12} className="animate-spin" />} Create Location
                </button>
              </div>
            )}

            {!selectedCompanyId ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Building2 size={32} className="mb-3 opacity-30" />
                <p className="text-sm">Select a company to manage its locations</p>
              </div>
            ) : loadingLocations ? (
              <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
            ) : locations.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No locations yet — add one above</p>
            ) : (
              <div className="space-y-1.5">
                {locations.map(l => (
                  <div key={l.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200">
                    <MapPin size={14} className="text-gray-300 shrink-0" />
                    <p className="text-sm font-medium text-gray-800">{l.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Users tab ── */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Users</h2>
              <p className="text-xs text-gray-400 ml-1">Click a row to edit assignment</p>
            </div>
            <button onClick={() => { setShowInvite(v => !v); setInviteError(''); setInviteSuccess(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-light transition-colors">
              <Mail size={13} /> Invite User
            </button>
          </div>

          {/* Invite form */}
          {showInvite && (
            <div className="mb-5 p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Invite New User</p>
                <button onClick={() => { setShowInvite(false); setInviteError(''); setInviteSuccess(''); }}
                  className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Email address *" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white" />
                <input placeholder="Full name (optional)" value={inviteFullName} onChange={e => setInviteFullName(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white" />
              </div>

              {/* Role */}
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1.5">Role</p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => (
                    <button key={r} onClick={() => { setInviteRole(r); setInviteCompanyId(null); setInviteLocationId(null); }}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        inviteRole === r ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'
                      }`}>
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Company picker */}
              {inviteRole !== 'ime_admin' && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Company</p>
                  <select value={inviteCompanyId ?? ''} onChange={e => { setInviteCompanyId(e.target.value || null); setInviteLocationId(null); }}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                    <option value="">Select company…</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {/* Location picker — plant_manager only */}
              {inviteRole === 'plant_manager' && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Location (Plant)</p>
                  <select value={inviteLocationId ?? ''} onChange={e => setInviteLocationId(e.target.value || null)}
                    disabled={!inviteCompanyId}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white disabled:opacity-50">
                    <option value="">Select location…</option>
                    {locationsForInvite.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  {!inviteCompanyId && <p className="text-xs text-gray-400 mt-1">Select a company first</p>}
                </div>
              )}

              {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
              {inviteSuccess && <p className="text-xs text-green-600 font-medium">{inviteSuccess}</p>}

              <button onClick={sendInvite} disabled={sendingInvite}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-light disabled:opacity-60 transition-colors">
                {sendingInvite ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                Send Invite
              </button>
            </div>
          )}

          {loadingUsers ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No users found</p>
          ) : (
            <div className="space-y-2">
              {users.map(u => {
                const isEditing = editingUserId === u.id;
                const companyName = companies.find(c => c.id === (isEditing ? editCompanyId : u.company_id))?.name;
                const locName = allLocations.find(l => l.id === (isEditing ? editLocationId : u.location_id))?.name;

                return (
                  <div key={u.id} className={`rounded-xl border transition-all ${isEditing ? 'border-primary bg-blue-50/40' : 'border-gray-200'}`}>
                    {/* Row summary */}
                    <button onClick={() => isEditing ? setEditingUserId(null) : startEdit(u)}
                      className="w-full flex items-center gap-4 px-4 py-3 text-left">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{u.full_name ?? '—'}</p>
                        <p className="text-xs text-gray-400 truncate">{u.email}</p>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${ROLE_BADGE[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                      {u.company_id && (
                        <span className="text-xs text-gray-500 shrink-0 hidden sm:block">{companyName ?? '—'}</span>
                      )}
                      {u.location_id && (
                        <span className="text-xs text-gray-400 shrink-0 hidden sm:block">{locName ?? '—'}</span>
                      )}
                    </button>

                    {/* Edit form */}
                    {isEditing && (
                      <div className="px-4 pb-4 space-y-3 border-t border-blue-100 pt-3">
                        {/* Role */}
                        <div className="grid grid-cols-3 gap-2">
                          {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => (
                            <button key={r} onClick={() => { setEditRole(r); setEditCompanyId(null); setEditLocationId(null); }}
                              className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                                editRole === r ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40'
                              }`}>
                              {ROLE_LABELS[r]}
                            </button>
                          ))}
                        </div>

                        {/* Company picker — not for ime_admin */}
                        {editRole !== 'ime_admin' && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1.5">Company</p>
                            <select value={editCompanyId ?? ''} onChange={e => { setEditCompanyId(e.target.value || null); setEditLocationId(null); }}
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white">
                              <option value="">Select company…</option>
                              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                        )}

                        {/* Location picker — plant_manager only */}
                        {editRole === 'plant_manager' && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1.5">Location (Plant)</p>
                            <select value={editLocationId ?? ''} onChange={e => setEditLocationId(e.target.value || null)}
                              disabled={!editCompanyId}
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white disabled:opacity-50">
                              <option value="">Select location…</option>
                              {locationsForEdit.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                            {!editCompanyId && <p className="text-xs text-gray-400 mt-1">Select a company first</p>}
                          </div>
                        )}

                        {userError && <p className="text-xs text-red-600">{userError}</p>}

                        <div className="flex items-center gap-2">
                          <button onClick={saveUser} disabled={savingUser}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-light disabled:opacity-60 transition-colors">
                            {savingUser ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            Save
                          </button>
                          <button onClick={() => setEditingUserId(null)}
                            className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
