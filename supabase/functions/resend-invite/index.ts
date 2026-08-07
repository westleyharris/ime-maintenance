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
    const siteUrl      = Deno.env.get('SITE_URL') ?? 'https://portal.ime-us.com'

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
    if (caller?.role !== 'ime_admin') return json({ error: 'Only IME admins can resend invites' }, 403)

    const { user_id } = await req.json()
    if (!user_id) return json({ error: 'user_id is required' }, 400)

    const { data: target } = await admin
      .from('profiles').select('email, role, company_id, location_id').eq('id', user_id).single()
    if (!target?.email) return json({ error: 'User not found' }, 404)

    // Already accepted? Resending would be pointless (and Supabase rejects an
    // invite for a confirmed user). Tell the admin to use password reset.
    const { data: authUser } = await admin.auth.admin.getUserById(user_id)
    if (authUser?.user?.last_sign_in_at) {
      return json({ error: 'This user has already accepted their invite and set a password. Use "Forgot password" on the login page instead.' }, 400)
    }

    // Re-inviting an unconfirmed user is allowed and issues a fresh link,
    // superseding the previous one.
    const { error } = await admin.auth.admin.inviteUserByEmail(target.email, {
      data: {
        role: target.role,
        company_id: target.company_id ?? null,
        location_id: target.location_id ?? null,
      },
      redirectTo: `${siteUrl}/set-password`,
    })
    if (error) throw error

    return json({ success: true, email: target.email })
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : 'Unknown error'
    console.error('resend-invite error:', m)
    return json({ error: m }, 400)
  }
})
