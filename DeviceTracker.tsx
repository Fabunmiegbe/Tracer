'use client';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import TrackingDashboard, { type Device } from './TrackingDashboard';

// Use on app/devices/[id]/page.tsx:  <DeviceTracker deviceId={id} />
export default function DeviceTracker({ deviceId }: { deviceId: string }) {
  const [signedIn, setSignedIn] = useState(false);
  const [device, setDevice] = useState<Device | null | undefined>(undefined); // undefined = loading

  useEffect(() => onAuthStateChanged(auth, (u) => setSignedIn(!!u)), []);

  useEffect(() => {
    if (!signedIn) return;
    return onSnapshot(
      doc(db, 'devices', deviceId),
      (s) => setDevice(s.exists() ? ({ id: s.id, ...s.data() } as Device) : null),
      () => setDevice(null), // rules reject devices that are not on this account
    );
  }, [signedIn, deviceId]);

  if (device === undefined) return <div className="h-[50dvh] animate-pulse rounded-xl bg-slate-900" />;
  if (device === null) return <p className="p-6 text-slate-300">Device not found, or it is not on your account.</p>;
  return <TrackingDashboard device={device} />;
}
