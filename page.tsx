'use client';
// Companion agent. Open on the phone you want to protect: /agent#d=<deviceId>&t=<pairingToken>
// Location is shared only after the person holding the phone taps "Start sharing" and accepts
// the browser permission prompt. A visible indicator stays on screen while sharing.
import { useEffect, useRef, useState } from 'react';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { agent } from '@/lib/firebase'; // separate app instance: never replaces an owner's login

const STALE_MS = 5 * 60_000; // ignore siren/stop commands that sat unhandled for more than 5 minutes

export default function Agent() {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const watch = useRef<number>();
  const unsub = useRef<Unsubscribe>();
  const lastSent = useRef(0);
  const siren = useRef<{ ctx: AudioContext; osc: OscillatorNode; lfo: OscillatorNode } | null>(null);

  const stopSiren = () => {
    siren.current?.osc.stop(); siren.current?.lfo.stop(); siren.current?.ctx.close(); siren.current = null;
  };
  const startSiren = () => {
    if (siren.current) return;
    const ctx = new AudioContext(); // allowed because the person tapped Start first
    const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    osc.type = 'square'; osc.frequency.value = 900; lfo.frequency.value = 2; depth.gain.value = 300;
    lfo.connect(depth).connect(osc.frequency);
    osc.connect(ctx.destination); osc.start(); lfo.start();
    siren.current = { ctx, osc, lfo };
  };

  async function start() {
    setError(null);
    const p = new URLSearchParams(location.hash.slice(1));
    const d = p.get('d'), t = p.get('t');
    if (!d || !t) return setError('This pairing link is incomplete. Create a new one from your dashboard.');
    if (!('geolocation' in navigator)) return setError('This browser cannot share location.');

    try {
      const res = await httpsCallable<{ deviceId: string; token: string }, { customToken: string }>(agent.fns, 'agentSignIn')({ deviceId: d, token: t });
      await signInWithCustomToken(agent.auth, res.data.customToken);
    } catch {
      return setError('This pairing link is no longer valid. Create a new one from your dashboard.');
    }

    watch.current = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        if (Date.now() - lastSent.current < 10_000) return; // one point per 10 seconds
        lastSent.current = Date.now();
        try {
          await addDoc(collection(agent.db, 'devices', d, 'locations'), {
            lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, source: 'gps', recordedAt: serverTimestamp(),
          });
          setError(null);
        } catch { setError('Could not send location. Check your connection or pair this phone again.'); }
      },
      (e) => setError(e.code === 1 ? 'Location permission was denied. Allow it in browser settings to continue.' : 'Could not get a location fix.'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );

    // Unhandled commands include ones queued while the phone was offline.
    unsub.current = onSnapshot(query(collection(agent.db, 'devices', d, 'commands'), where('handledAt', '==', null)), (snap) => {
      snap.docChanges().filter((c) => c.type === 'added').map((c) => c.doc)
        .sort((a, b) => (a.data().createdAt?.toMillis() ?? 0) - (b.data().createdAt?.toMillis() ?? 0))
        .forEach((c) => {
          const { type, payload, createdAt } = c.data();
          const fresh = Date.now() - (createdAt?.toMillis() ?? Date.now()) < STALE_MS;
          if (type === 'siren' && fresh) startSiren();
          if (type === 'stop' && fresh) stopSiren();
          if (type === 'message') setNotice(payload?.text ?? null);
          updateDoc(doc(agent.db, 'devices', d, 'commands', c.id), { handledAt: serverTimestamp() }).catch(() => {});
        });
    });
    setSharing(true);
  }

  function stop() {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    unsub.current?.(); stopSiren(); signOut(agent.auth); setSharing(false);
  }
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (notice)
    return (
      <main className="grid min-h-dvh place-items-center bg-rose-600 p-8 text-center text-white">
        <div>
          <p className="text-2xl font-semibold">{notice}</p>
          <button onClick={() => { setNotice(null); stopSiren(); }} className="mt-8 rounded-lg bg-white/20 px-4 py-2">Dismiss</button>
        </div>
      </main>
    );

  return (
    <main className="mx-auto grid min-h-dvh max-w-sm place-content-center gap-5 p-6 text-slate-100">
      <h1 className="text-xl font-semibold">Location sharing for this phone</h1>
      <p className="text-sm text-slate-300">
        While on, this phone sends its location to your FindMyIMEI account only, so you can find it if it goes missing. You can stop at any time.
      </p>
      {sharing ? (
        <>
          <p className="flex items-center gap-2 text-emerald-300" role="status">
            <span className="fmi-dot fmi-live" style={{ ['--c' as string]: '#34d399' }} /> Sharing location
          </p>
          <button onClick={stop} className="rounded-lg border border-slate-600 px-4 py-2">Stop sharing</button>
        </>
      ) : (
        <button onClick={start} className="rounded-lg bg-emerald-400 px-4 py-2 font-medium text-slate-950">Start sharing</button>
      )}
      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
      <p className="text-xs text-slate-500">Keep this tab open with the screen on. Browsers pause background tabs, so a native Android app is needed for reliable tracking.</p>
    </main>
  );
}
