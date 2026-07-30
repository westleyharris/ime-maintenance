import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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
    if (caller?.role !== 'ime_admin') return json({ error: 'Only IME admins can remove users' }, 403)

    const { user_id } = await req.json()
    if (!user_id) return json({ error: 'user_id is required' }, 400)

    // ── Safety rails ──────────────────────────────────────────────────────────
    // 1. Never let an admin delete their own account out from under themselves.
    if (user_id === user.id) return json({ error: 'You cannot remove your own account' }, 400)

    const { data: target } = await admin
      .from('profiles').select('role, email').eq('id', user_id).single()
    if (!target) return json({ error: 'User not found' }, 404)

    // 2. Never remove the last IME admin — that would lock everyone out of the
    //    admin panel (and of user management entirely).
    if (target.role === 'ime_admin') {
      const { count } = await admin
        .from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ime_admin')
      if ((count ?? 0) <= 1) return json({ error: 'Cannot remove the last IME admin' }, 400)
    }

    // Deleting the auth user cascades to public.profiles (profiles_id_fkey).
    // Historical references (work_orders.created_by, feedback.user_id) are plain
    // columns, so past work orders / feedback keep their records intact.
    const { error } = await admin.auth.admin.deleteUser(user_id)
    if (error) throw error

    return json({ success: true, email: target.email })
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : 'Unknown error'
    console.error('delete-user error:', m)
    return json({ error: m }, 400)
  }
})
