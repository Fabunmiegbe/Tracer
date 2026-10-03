'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { BellRing, MessageSquareWarning, WifiOff, Radio, Info, ShieldCheck, Link2 } from 'lucide-react';
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, fns } from '@/lib/firebase';
import type { Point, MapMode } from './DeviceMap';

// Leaflet touches `window`, so it must never render on the server.
const DeviceMap = dynamic(() => import('./DeviceMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-900" />,
});

export type Device = {
  id: string; make: string; model: string; imei: string;
  status: 'safe' | 'lost' | 'stolen'; lockMessage?: string | null;
};
const ONLINE_WINDOW_MS = 90_000; // no ping for 90s = offline

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export default function TrackingDashboard({ device }: { device: Device }) {
  const [points, setPoints] = useState<Point[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState(device.lockMessage ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    const off = onSnapshot(
      query(collection(db, 'devices', device.id, 'locations'), orderBy('recordedAt', 'desc'), limit(300)),
      (snap) =>
        setPoints(
          snap.docs
            .map((d) => {
              const x = d.data({ serverTimestamps: 'estimate' });
              return {
                id: d.id, lat: x.lat, lng: x.lng, accuracy_m: x.accuracy ?? null,
                recorded_at: (x.recordedAt as Timestamp).toDate().toISOString(),
              } as Point;
            })
            .reverse(),
        ),
    );
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { off(); clearInterval(tick); };
  }, [device.id]);

  const last = points.at(-1);
  const online = !!last && now - new Date(last.recorded_at).getTime() < ONLINE_WINDOW_MS;
  const mode: MapMode = online ? 'online' : device.status === 'stolen' ? 'stolen' : 'offline';

  const banner = useMemo(() => {
    if (!last) return { tone: 'bg-slate-800 text-slate-200', icon: Info, text: 'No location yet. Pair the companion agent on this phone to start tracking.' };
    if (online) return { tone: 'bg-emerald-500/15 text-emerald-300', icon: Radio, text: `Live. Updated ${ago(last.recorded_at, now)}${last.accuracy_m ? `, accurate to ~${Math.round(last.accuracy_m)} m` : ''}.` };
    return { tone: device.status === 'stolen' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300', icon: WifiOff, text: `Offline. Last seen ${ago(last.recorded_at, now)}. Showing the path before it went dark.` };
  }, [last, online, now, device.status]);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4000); };

  async function send(type: 'siren' | 'message' | 'stop', payload: object = {}) {
    setBusy(type);
    try {
      await addDoc(collection(db, 'devices', device.id, 'commands'), { type, payload, handledAt: null, createdAt: serverTimestamp() });
      flash(online ? 'Sent. The phone will act within seconds.' : 'Queued. The phone will act when it reconnects.');
    } catch { flash('Could not queue the command. Try again.'); }
    setBusy(null);
  }

  async function setStatus(status: Device['status']) {
    try {
      await updateDoc(doc(db, 'devices', device.id), {
        status, statusChangedAt: serverTimestamp(), lockMessage: status === 'safe' ? null : message.trim() || null,
      });
    } catch { flash('Could not change the status. Try again.'); }
  }

  async function pair() {
    setBusy('pair');
    try {
      const res = await httpsCallable<{ deviceId: string }, { link: string }>(fns, 'createPairing')({ deviceId: device.id });
      setLink(res.data.link);
    } catch { flash('Could not create a pairing link. Try again.'); }
    setBusy(null);
  }

  const Banner = banner.icon;
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col gap-3 lg:flex-row">
      <section className="relative min-h-[55dvh] flex-[2] overflow-hidden rounded-xl border border-slate-800">
        <div className={`absolute inset-x-0 top-0 z-[1000] flex items-center gap-2 px-4 py-2.5 text-sm backdrop-blur ${banner.tone}`} role="status">
          <Banner size={16} aria-hidden /> {banner.text}
        </div>
        <DeviceMap points={points} mode={mode} />
      </section>

      <aside className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-4 lg:max-w-sm">
        <header>
          <h1 className="text-lg font-semibold text-slate-50">{device.make} {device.model}</h1>
          <p className="font-mono text-sm text-slate-400">IMEI {device.imei}</p>
        </header>

        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Device status">
          {(['safe', 'lost', 'stolen'] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} aria-pressed={device.status === s}
              className={`rounded-lg border px-3 py-2 text-sm capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                device.status === s
                  ? s === 'safe' ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300' : 'border-rose-400 bg-rose-400/10 text-rose-300'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
              {s}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <label htmlFor="msg" className="text-sm font-medium text-slate-200">Lock screen message</label>
          <textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={200}
            placeholder="This phone is lost. Please call +234… for a reward."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400" />
          <button disabled={!message.trim() || busy === 'message'} onClick={() => send('message', { text: message.trim() })}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">
            <MessageSquareWarning size={16} aria-hidden /> Show message on phone
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => send('siren')} disabled={busy === 'siren'}
            className="flex items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
            <BellRing size={16} aria-hidden /> Play siren
          </button>
          <button onClick={() => send('stop')} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            Stop siren
          </button>
        </div>

        <div className="space-y-2 border-t border-slate-800 pt-4">
          <button onClick={pair} disabled={busy === 'pair'}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40">
            <Link2 size={16} aria-hidden /> {link ? 'Replace pairing link' : 'Pair this phone'}
          </button>
          {link && (
            <>
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Pairing link"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-300" />
              <p className="text-xs text-slate-400">Open this link on the phone you want to protect, then tap Start sharing. A new link replaces the old one.</p>
            </>
          )}
        </div>

        <p aria-live="polite" className="min-h-5 text-sm text-slate-300">{toast}</p>

        <p className="mt-auto flex gap-2 rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-400">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
          Tracking works only on phones where the owner installed and approved the companion agent. If a phone was stolen and the agent is not running, report it to the police and your carrier; they can block the IMEI network-wide.
        </p>
      </aside>
    </div>
  );
}
