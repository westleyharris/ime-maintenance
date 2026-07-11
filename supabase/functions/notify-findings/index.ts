import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const CONDITION_COLORS: Record<string, [string, string]> = {
  Danger:  ['#fde8e8', '#b42318'],
  Warning: ['#fef0dd', '#a16207'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

    // SMTP (same Gmail setup as submit-feedback; 465 = implicit TLS, works on
    // the edge runtime — 587 STARTTLS does not)
    const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com'
    const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465')
    const SMTP_USER = Deno.env.get('SMTP_USER') ?? 'westley.harris11@gmail.com'
    const SMTP_FROM = Deno.env.get('SMTP_FROM') ?? SMTP_USER
    const SMTP_NAME = Deno.env.get('SMTP_NAME') ?? 'IME'
    const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD')
    if (!SMTP_PASSWORD) return json({ error: 'SMTP_PASSWORD secret is not set' }, 500)

    // ── Caller must be an authenticated ime_admin (the analyst) ───────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: caller } = await admin
      .from('profiles').select('role, full_name, email').eq('id', user.id).single()
    if (caller?.role !== 'ime_admin') return json({ error: 'Only IME admins can send finding notifications' }, 403)
    const senderName = caller.full_name?.trim() || caller.email || 'IME analyst'

    const { findingIds, recipientIds, note } = await req.json()
    if (!Array.isArray(findingIds) || findingIds.length === 0) return json({ error: 'findingIds is required' }, 400)
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) return json({ error: 'recipientIds is required' }, 400)

    // ── Recipients: only platform roles that may be notified ──────────────────
    const { data: recipients } = await admin
      .from('profiles')
      .select('id, email, full_name, role')
      .in('id', recipientIds)
      .in('role', ['ime_admin', 'company_admin', 'plant_manager'])
    const emails = (recipients ?? []).map(r => r.email).filter((e): e is string => !!e)
    if (emails.length === 0) return json({ error: 'No valid recipients found' }, 400)

    // ── Findings + asset context for the email body (per-equipment) ───────────
    const { data: findings } = await admin
      .from('findings')
      .select(`
        id, condition, finding, recommendation, generated_tag, creation_date, notified_at, company_id, location_id,
        equipment ( tag, sections ( uas_name, lines ( name, locations ( name ) ) ) )
      `)
      .in('id', findingIds)
    if (!findings || findings.length === 0) return json({ error: 'No findings found for the given ids' }, 400)

    const safe = (s: unknown) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))

    // deno-lint-ignore no-explicit-any
    const rowHtml = (f: any) => {
      const eq   = f.equipment
      const sec  = eq?.sections
      const [bg, fg] = CONDITION_COLORS[f.condition] ?? ['#eee', '#333']
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">
            <span style="background:${bg};color:${fg};font-weight:bold;font-size:11px;padding:2px 8px;border-radius:10px">${safe(f.condition)}</span>
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${safe(sec?.lines?.name)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${safe(sec?.uas_name)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb"><b style="font-family:monospace">${safe(eq?.tag)}</b></td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${safe(f.recommendation || '—')}</td>
        </tr>`
    }

    const loc = (findings[0] as { equipment?: { sections?: { lines?: { locations?: { name?: string } } } } })
      ?.equipment?.sections?.lines?.locations?.name ?? ''
    const subject = `Ultrasound findings notification${loc ? ` — ${loc}` : ''} (${findings.length} asset${findings.length !== 1 ? 's' : ''})`

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
        <h2 style="margin:0 0 6px">Ultrasound findings notification</h2>
        <p style="margin:0 0 14px;color:#6b7280">Sent by ${safe(senderName)} · ${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
        ${note ? `<p style="white-space:pre-wrap;border-left:3px solid #2563eb;padding-left:12px;margin:0 0 16px">${safe(note)}</p>` : ''}
        <table style="border-collapse:collapse;font-size:13px;width:100%">
          <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">
            <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb">Condition</th>
            <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb">Area</th>
            <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb">Functional Location</th>
            <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb">Machine</th>
            <th style="padding:6px 10px;border-bottom:2px solid #e5e7eb">Recommendation</th>
          </tr>
          ${findings.map(rowHtml).join('')}
        </table>
        <p style="margin-top:16px;color:#9ca3af;font-size:12px">Open the IME Platform → Findings tab for full details and to create work orders.</p>
      </div>`

    const text = findings.map((f: { condition?: string; equipment?: { tag?: string }; recommendation?: string }) =>
      `[${f.condition}] ${f.equipment?.tag ?? ''} — ${f.recommendation ?? 'no recommendation'}`
    ).join('\n')

    const client = new SMTPClient({
      connection: { hostname: SMTP_HOST, port: SMTP_PORT, tls: SMTP_PORT === 465, auth: { username: SMTP_USER, password: SMTP_PASSWORD } },
    })
    await client.send({
      from: `${SMTP_NAME} <${SMTP_FROM}>`,
      to: emails,
      replyTo: caller.email ?? SMTP_FROM,
      subject,
      content: (note ? `${note}\n\n` : '') + text,
      html,
    })
    await client.close()

    // ── KPI stamp: first notification time only (never overwritten) ───────────
    await admin
      .from('findings')
      .update({ notified_at: new Date().toISOString() })
      .in('id', findingIds)
      .is('notified_at', null)

    return json({ success: true, findings: findings.length, recipients: emails.length })
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : 'Unknown error'
    console.error('notify-findings error:', m)
    return json({ error: m }, 400)
  }
})
