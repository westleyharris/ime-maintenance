import { useState } from 'react';
import { MessageSquarePlus, X, Loader2, CheckCircle2, ImageUp, Camera } from 'lucide-react';
import html2canvas from 'html2canvas';
import { supabase } from '../lib/supabase';

// Capture only the visible viewport at reduced scale — fast and small, vs.
// rendering the whole (often huge) page which lags and can produce a broken image.
async function captureViewport(): Promise<string | null> {
  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scale: 0.7,
      imageTimeout: 1500,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const url = canvas.toDataURL('image/jpeg', 0.8);
    return url && url.length > 1000 ? url : null;   // guard against empty/0x0 captures
  } catch {
    return null;
  }
}

export default function FeedbackButton() {
  const [open, setOpen]                 = useState(false);
  const [capturing, setCapturing]       = useState(false);
  const [hideForShot, setHideForShot]   = useState(false);
  const [shot, setShot]                 = useState<string | null>(null);
  const [message, setMessage]           = useState('');
  const [sending, setSending]           = useState(false);
  const [sent, setSent]                 = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const openWidget = async () => {
    setMessage(''); setSent(false); setError(null); setShot(null);
    setCapturing(true);
    const img = await captureViewport();   // page captured before the modal exists
    setShot(img);
    setOpen(true);
    setCapturing(false);
  };

  const recapture = async () => {
    setCapturing(true);
    setHideForShot(true);                                   // hide modal so it isn't in the shot
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
    const img = await captureViewport();
    setHideForShot(false);
    setShot(img);
    if (!img) setError('Could not capture the screen — use Attach instead.');
    setCapturing(false);
  };

  const onAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setShot(reader.result as string); setError(null); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const send = async () => {
    if (!message.trim()) return;
    setSending(true); setError(null);
    const { data, error } = await supabase.functions.invoke('submit-feedback', {
      body: { message, pageUrl: window.location.href, screenshot: shot },
    });
    setSending(false);
    if (error) {
      let msg = error.message;
      try { const j = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
      setError(msg);
      return;
    }
    if (data?.error) { setError(data.error); return; }
    setSent(true);
    setTimeout(() => setOpen(false), 1500);
  };

  return (
    <>
      <button onClick={openWidget} disabled={capturing} title="Send feedback"
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-primary transition-colors border border-gray-200 rounded px-2 py-1">
        {capturing && !open ? <Loader2 size={13} className="animate-spin" /> : <MessageSquarePlus size={13} />}
        <span className="hidden md:inline">Feedback</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-6"
          style={hideForShot ? { display: 'none' } : undefined}
          onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Send feedback</h2>
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>

            {sent ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-green-600">
                <CheckCircle2 size={40} />
                <p className="text-sm font-semibold">Thanks! Your feedback was sent.</p>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
                  placeholder="Describe the issue or suggestion…"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20" />

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Screenshot</p>
                    <div className="flex items-center gap-3">
                      <button onClick={recapture} disabled={capturing}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50">
                        <Camera size={12} /> Recapture
                      </button>
                      <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer">
                        <ImageUp size={12} /> Attach
                        <input type="file" accept="image/*" className="hidden" onChange={onAttach} />
                      </label>
                      {shot && <button onClick={() => setShot(null)} className="text-[11px] font-semibold text-gray-400 hover:text-red-500">Remove</button>}
                    </div>
                  </div>
                  {capturing ? (
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg py-6">
                      <Loader2 size={14} className="animate-spin" /> Capturing screen…
                    </div>
                  ) : shot ? (
                    <img src={shot} alt="screenshot preview"
                      onError={() => { setShot(null); setError('Preview could not load — please use Attach.'); }}
                      className="w-full max-h-48 object-contain rounded-lg border border-gray-200 bg-gray-50" />
                  ) : (
                    <div className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg py-6 text-center">
                      No screenshot — use Recapture or Attach (optional)
                    </div>
                  )}
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-500 hover:bg-gray-100">Cancel</button>
                  <button onClick={send} disabled={sending || !message.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light disabled:opacity-50">
                    {sending ? <Loader2 size={14} className="animate-spin" /> : null} Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
