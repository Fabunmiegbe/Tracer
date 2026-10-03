'use client';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type Point = { id: string; lat: number; lng: number; accuracy_m: number | null; recorded_at: string };
export type MapMode = 'online' | 'offline' | 'stolen';

const COLORS: Record<MapMode, string> = { online: '#34d399', offline: '#fbbf24', stolen: '#fb7185' };

const pulseIcon = (color: string, live: boolean) =>
  L.divIcon({
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<span class="fmi-dot${live ? ' fmi-live' : ''}" style="--c:${color}"></span>`,
  });

export default function DeviceMap({ points, mode }: { points: Point[]; mode: MapMode }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const layer = useRef<L.LayerGroup>();

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: false }).setView([6.45, 7.5], 5);
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 19,
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = undefined; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g || points.length === 0) return;
    g.clearLayers();
    const color = COLORS[mode];
    const latest = points[points.length - 1];
    const path = points.map((p) => [p.lat, p.lng] as [number, number]);

    // Breadcrumb trail: older points fade, so direction of travel reads at a glance
    L.polyline(path, { color, weight: 3, opacity: 0.55, dashArray: mode === 'online' ? undefined : '6 8' }).addTo(g);
    points.slice(0, -1).forEach((p, i) =>
      L.circleMarker([p.lat, p.lng], {
        radius: 3, color, fillColor: color, fillOpacity: 0.2 + 0.6 * (i / points.length), weight: 0,
      }).bindTooltip(new Date(p.recorded_at).toLocaleString()).addTo(g));

    if (latest.accuracy_m)
      L.circle([latest.lat, latest.lng], {
        radius: latest.accuracy_m, color, weight: 1, fillColor: color, fillOpacity: 0.12,
      }).addTo(g);
    L.marker([latest.lat, latest.lng], { icon: pulseIcon(color, mode === 'online') }).addTo(g);

    m.flyTo([latest.lat, latest.lng], Math.max(m.getZoom(), 15), { duration: 0.8 });
  }, [points, mode]);

  return <div ref={el} className="h-full w-full bg-slate-950" role="application" aria-label="Device location map" />;
}
