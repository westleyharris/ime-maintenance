import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { email, full_name, role, company_id, location_id } = await req.json()

    if (!email || !role) {
      return new Response(JSON.stringify({ error: 'email and role are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const siteUrl = Deno.env.get('SITE_URL') ?? 'http://localhost:5173'

    const { data, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { role, company_id: company_id ?? null, location_id: location_id ?? null },
      redirectTo: `${siteUrl}/set-password`,
    })

    if (inviteError) throw inviteError

    const userId = data.user?.id
    if (!userId) throw new Error('No user ID returned from invite')

    const { error: profileError } = await supabase.from('profiles').upsert({
      id: userId,
      email,
      full_name: full_name?.trim() || null,
      role,
      company_id: role === 'ime_admin' ? null : (company_id ?? null),
      location_id: role === 'plant_manager' ? (location_id ?? null) : null,
    })

    if (profileError) throw profileError

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('invite-user error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
