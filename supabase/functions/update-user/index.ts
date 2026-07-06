import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const ROLES = ['ime_admin', 'company_admin', 'plant_manager'] as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

    // ── Caller must be an authenticated ime_admin ─────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: caller } = await admin
      .from('profiles').select('role').eq('id', user.id).single()
    if (caller?.role !== 'ime_admin') return json({ error: 'Only IME admins can manage users' }, 403)

    // ── Validate input ────────────────────────────────────────────────────────
    const { user_id, role, company_id, location_id } = await req.json()
    if (!user_id) return json({ error: 'user_id is required' }, 400)
    if (!ROLES.includes(role)) return json({ error: 'Invalid role' }, 400)
    if (role !== 'ime_admin' && !company_id) return json({ error: 'Company is required for this role' }, 400)
    if (role === 'plant_manager' && !location_id) return json({ error: 'Location is required for Plant Manager' }, 400)

    // Normalize scope so it always matches the role (mirrors invite-user)
    const nextCompany  = role === 'ime_admin' ? null : company_id
    const nextLocation = role === 'plant_manager' ? location_id : null

    // Service-role update bypasses the (intentionally) restrictive profiles RLS;
    // the on_profile_role_change trigger then syncs role/company/location into
    // the user's JWT app_metadata (takes effect on their next token refresh).
    const { error } = await admin
      .from('profiles')
      .update({ role, company_id: nextCompany, location_id: nextLocation })
      .eq('id', user_id)
    if (error) throw error

    return json({ success: true })
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : 'Unknown error'
    console.error('update-user error:', m)
    return json({ error: m }, 400)
  }
})
