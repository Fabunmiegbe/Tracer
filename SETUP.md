# FindMyIMEI on Firebase: setup

## How it works
An IMEI alone cannot locate a phone (only carriers see tower data). This app works like Find My Device: the owner pairs a **companion agent** on the phone, and the agent reports GPS location. The IMEI powers the registry, the public stolen-phone lookup and police reports.

| Piece | File |
|---|---|
| Access rules | `firestore.rules`, `storage.rules` |
| Pairing, agent sign-in, IMEI uniqueness, blacklist sync | `functions/src/index.ts` |
| Firebase clients (`auth`, `db`, `fns`, separate `agent` app) | `lib/firebase.ts` |
| Map | `components/DeviceMap.tsx` |
| Dashboard + wrapper | `components/TrackingDashboard.tsx`, `DeviceTracker.tsx` |
| Phone agent | `app/agent/page.tsx` |

## 1. Next.js app
```bash
npx create-next-app@latest findmyimei --ts --tailwind --app
cd findmyimei
npm i firebase leaflet lucide-react framer-motion
npm i -D @types/leaflet
```
Copy `components/`, `lib/`, `app/agent/`, `firestore.rules`, `storage.rules` and `functions/` into the project.

## 2. Firebase project
1. Create a project at console.firebase.google.com and add a **Web app**.
2. **Authentication**: enable Email/Password and Google (Apple needs a paid Apple Developer account). For 2FA, upgrade to Identity Platform and enable TOTP.
3. **Firestore**: create the database in production mode.
4. **Storage**: create the default bucket.
5. Upgrade to the **Blaze** plan. Cloud Functions require it; the free allowances still apply.
6. Authentication → Settings → Authorized domains: add your live domain.

## 3. Environment (`.env.local`)
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_APP_ID=
```
Create `functions/.env` with `SITE_URL=https://your-domain.com` (used to build pairing links).

## 4. Deploy rules and functions
```bash
npm i -g firebase-tools
firebase login
firebase init firestore storage functions   # TypeScript; keep the existing rules and functions/src/index.ts
cd functions && npm i firebase-admin firebase-functions && cd ..
firebase deploy --only firestore:rules,storage,functions
```
Callable function names: `createPairing`, `agentSignIn`. Trigger: `syncDevice`.

## 5. Pages to add
Device page, `app/devices/[id]/page.tsx`:
```tsx
import DeviceTracker from '@/components/DeviceTracker';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DeviceTracker deviceId={(await params).id} />;
}
```
Add device (client side), after the user is signed in:
```ts
await addDoc(collection(db, 'devices'), {
  ownerId: auth.currentUser!.uid, make, model, imei, imei2: imei2 || null, serial, color,
  receiptPath: path || null, status: 'safe', statusChangedAt: serverTimestamp(), createdAt: serverTimestamp(),
});
```
Upload receipts to `receipts/<uid>/<deviceId>/<file>` first. Check the IMEI check digit in the form too: `syncDevice` deletes devices with a bad checksum or an IMEI already registered, so the user would otherwise see the device vanish.

Public lookup (no login needed):
```ts
const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(imei)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
const snap = await getDoc(doc(db, 'blacklist', hash)); // snap.exists() => flagged
```
`app/globals.css`:
```css
.fmi-dot{position:relative;display:block;width:14px;height:14px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px #0f172a}
.fmi-live::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--c);animation:fmi 1.8s ease-out infinite}
@keyframes fmi{from{transform:scale(1);opacity:.7}to{transform:scale(3.2);opacity:0}}
@media (prefers-reduced-motion:reduce){.fmi-live::after{animation:none}}
body{background:#0b1220}
```

## 6. Try it
`npm run dev`, sign in, add a device, open its page, tap **Pair this phone**, open the link on the phone (HTTPS is required for geolocation, so use your deployed URL or a tunnel), tap **Start sharing**. Points appear live on the map.

## Known gaps
- **Re-pairing does not sign out an already paired phone.** A new link replaces the token, but a phone signed in earlier keeps its access until you add a `pairId` claim and check it in the rules.
- **Deleting a device leaves its `locations` and `commands` behind.** Firestore does not cascade; add a function that recursively deletes them.
- **No location expiry.** Add an `expireAt` field and a Firestore TTL policy, or old points accumulate.
- **Write volume.** One point per 10 seconds is about 8,600 writes a day per tracked phone against 20,000 free. Slow the interval when the phone is stationary.
- **Blacklist scraping.** Enable App Check and rate-limit lookups. A 15-digit IMEI can be guessed.
- **Not built yet:** police report PDF function, sidebar and auth pages, 2FA enrolment screen, native Android agent.
