import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

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

    // SMTP (reuses the Gmail SMTP used for auth emails)
    const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com'
    const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465')  // implicit TLS works on the edge runtime; 587 STARTTLS does not
    const SMTP_USER = Deno.env.get('SMTP_USER') ?? 'westley.harris11@gmail.com'
    const SMTP_FROM = Deno.env.get('SMTP_FROM') ?? SMTP_USER
    const SMTP_NAME = Deno.env.get('SMTP_NAME') ?? 'IME'
    const SMTP_PASSWORD = Deno.env.get('SMTP_PASSWORD')
    if (!SMTP_PASSWORD) return json({ error: 'SMTP_PASSWORD secret is not set' }, 500)

    // ── Identify the submitting user ──────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const { message, pageUrl, screenshot, filename } = await req.json()
    if (!message || !String(message).trim()) return json({ error: 'message is required' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // Submitter's profile (for scope + display)
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, email, company_id, location_id')
      .eq('id', user.id)
      .single()
    const submitterEmail = profile?.email ?? user.email ?? 'unknown'
    const submitterName  = profile?.full_name?.trim() || submitterEmail

    // ── Screenshot → Storage ──────────────────────────────────────────────────
    let screenshotPath: string | null = null
    let attachBytes: Uint8Array | null = null
    let attachName = filename || 'screenshot.jpg'
    if (screenshot && typeof screenshot === 'string') {
      const base64 = screenshot.includes(',') ? screenshot.split(',')[1] : screenshot
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      attachBytes = bytes
      const contentType = screenshot.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
      attachName = contentType === 'image/png' ? 'screenshot.png' : 'screenshot.jpg'
      screenshotPath = `${user.id}/${Date.now()}-${attachName}`
      await admin.storage.from('feedback-screenshots').upload(screenshotPath, bytes, { contentType, upsert: false })
    }

    // ── Persist the feedback row ──────────────────────────────────────────────
    await admin.from('feedback').insert({
      user_id: user.id,
      user_email: submitterEmail,
      company_id: profile?.company_id ?? null,
      location_id: profile?.location_id ?? null,
      message: String(message),
      page_url: pageUrl ?? null,
      screenshot_path: screenshotPath,
    })

    // ── Recipients: every IME admin ───────────────────────────────────────────
    const { data: admins } = await admin.from('profiles').select('email').eq('role', 'ime_admin')
    const recipients = (admins ?? []).map(a => a.email).filter((e): e is string => !!e)
    if (recipients.length === 0) return json({ error: 'No ime_admin recipients found' }, 500)

    // ── Send the email ────────────────────────────────────────────────────────
    const safe = (s: string) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
        <h2 style="margin:0 0 12px">New platform feedback</h2>
        <p style="white-space:pre-wrap;border-left:3px solid #2563eb;padding-left:12px;margin:0 0 16px">${safe(message)}</p>
        <table style="font-size:13px;color:#4b5563">
          <tr><td style="padding:2px 12px 2px 0"><b>From</b></td><td>${safe(submitterName)} &lt;${safe(submitterEmail)}&gt;</td></tr>
          <tr><td style="padding:2px 12px 2px 0"><b>Page</b></td><td>${safe(pageUrl ?? '—')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0"><b>Time</b></td><td>${new Date().toISOString()}</td></tr>
        </table>
        ${attachBytes ? '<p style="margin-top:16px;color:#6b7280">Screenshot attached.</p>' : ''}
      </div>`

    const client = new SMTPClient({
      connection: { hostname: SMTP_HOST, port: SMTP_PORT, tls: SMTP_PORT === 465, auth: { username: SMTP_USER, password: SMTP_PASSWORD } },
    })
    await client.send({
      from: `${SMTP_NAME} <${SMTP_FROM}>`,
      to: recipients,
      replyTo: submitterEmail,
      subject: `New feedback from ${submitterName}`,
      content: String(message),
      html,
      attachments: attachBytes
        ? [{ filename: attachName, content: attachBytes, encoding: 'binary', contentType: attachName.endsWith('.png') ? 'image/png' : 'image/jpeg' }]
        : [],
    })
    await client.close()

    return json({ success: true, recipients: recipients.length })
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : 'Unknown error'
    console.error('submit-feedback error:', m)
    return json({ error: m }, 400)
  }
})
