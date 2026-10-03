import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

initializeApp();
const db = getFirestore();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// IMEI = 15 digits ending in a Luhn check digit
const luhnOk = (s: string) => {
  if (!/^\d{15}$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(s[14 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    total += d;
  }
  return total % 10 === 0;
};

/** Owner asks for a pairing link. The token is shown once; only its hash is stored. */
export const createPairing = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const deviceId = String(req.data?.deviceId ?? '');
  const dev = await db.doc(`devices/${deviceId}`).get();
  if (!dev.exists || dev.data()!.ownerId !== uid) throw new HttpsError('permission-denied', 'Not your device.');

  const token = randomBytes(32).toString('hex');
  await db.doc(`pairings/${deviceId}`).set({ tokenHash: sha(token), createdAt: new Date() }); // replaces any old token
  await dev.ref.update({ agentPairedAt: new Date() });
  // Token travels in the URL fragment, so it never reaches server logs.
  return { link: `${process.env.SITE_URL}/agent#d=${deviceId}&t=${token}` };
});

/** The phone trades its pairing token for a Firebase sign-in limited to that one device. */
export const agentSignIn = onCall(async (req) => {
  const deviceId = String(req.data?.deviceId ?? '');
  const token = String(req.data?.token ?? '');
  const stored = (await db.doc(`pairings/${deviceId}`).get()).data()?.tokenHash as string | undefined;
  const given = sha(token);
  if (!stored || stored.length !== given.length || !timingSafeEqual(Buffer.from(stored), Buffer.from(given)))
    throw new HttpsError('permission-denied', 'Pairing is not valid.');
  return { customToken: await getAuth().createCustomToken(`agent:${deviceId}`, { deviceId }) };
});

// ── IMEI bookkeeping ─────────────────────────────────────────────────
// imeiIndex/<hash> makes each IMEI unique across accounts; blacklist/<hash> is the public flag.
async function claim(imei: string, deviceId: string) {
  const ref = db.doc(`imeiIndex/${sha(imei)}`);
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists && s.data()!.deviceId !== deviceId) return false;
    t.set(ref, { deviceId });
    return true;
  });
}
async function release(imei: string, deviceId: string) {
  const h = sha(imei);
  await db.runTransaction(async (t) => {
    const idx = db.doc(`imeiIndex/${h}`);
    const s = await t.get(idx);
    if (s.data()?.deviceId !== deviceId) return; // another account owns it; leave its flag alone
    t.delete(idx);
    t.delete(db.doc(`blacklist/${h}`));
  });
}

export const syncDevice = onDocumentWritten('devices/{id}', async (event) => {
  const id = event.params.id;
  const imeisOf = (d?: FirebaseFirestore.DocumentData) => [d?.imei, d?.imei2].filter(Boolean) as string[];
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!after) { await Promise.all(imeisOf(before).map((i) => release(i, id))); return; }

  const list = imeisOf(after);
  const valid = list.every(luhnOk) && (await Promise.all(list.map((i) => claim(i, id)))).every(Boolean);
  if (!valid) { await event.data!.after.ref.delete(); return; } // bad checksum or already registered elsewhere

  const flagged = after.status === 'lost' || after.status === 'stolen';
  await Promise.all(list.map((i) => {
    const ref = db.doc(`blacklist/${sha(i)}`);
    return flagged ? ref.set({ status: after.status, reportedAt: after.statusChangedAt ?? new Date() }) : ref.delete();
  }));
});
