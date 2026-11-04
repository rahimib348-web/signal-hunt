import type { LatLng } from './types';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Entfernung zwischen zwei Punkten in Metern (Haversine). */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Verschiebt einen Punkt um Meter nach Norden und Osten. */
export function offset(p: LatLng, northM: number, eastM: number): LatLng {
  return {
    lat: p.lat + (northM / EARTH_RADIUS_M) * (180 / Math.PI),
    lng: p.lng + (eastM / (EARTH_RADIUS_M * Math.cos(toRad(p.lat)))) * (180 / Math.PI),
  };
}

/** Projiziert Punkte in ein lokales Meter-Koordinatensystem (gut genug für Spielfelder bis ein paar km). */
function project(points: LatLng[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng0 = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const kx = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(toRad(lat0));
  const ky = (Math.PI / 180) * EARTH_RADIUS_M;
  return points.map((p) => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
}

/** Fläche eines Vielecks in Quadratmetern. */
export function polygonAreaM2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const xy = project(points);
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Liegt der Punkt im Vieleck? (Strahlverfahren) */
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.lat > p.lat !== b.lat > p.lat;
    if (crosses && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const d = (a: typeof p1, b: typeof p1, c: typeof p1) => (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Kreuzen sich Kanten des Vielecks? Dann ist das Spielfeld ungültig. */
export function selfIntersects(points: LatLng[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const xy = project(points);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Benachbarte Kanten teilen sich einen Punkt, die überspringen wir.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) return true;
    }
  }
  return false;
}

export const MIN_AREA_M2 = 10_000;
export const MAX_AREA_M2 = 25_000_000;

/** Empfohlene Spielfeldgröße: etwa 0,15 km² pro Spieler, zwischen 0,4 und 3 km². */
export function suggestedAreaM2(playerCount: number): number {
  return Math.min(3_000_000, Math.max(400_000, playerCount * 150_000));
}

/** Regelmäßiges Vieleck mit gegebener Fläche um einen Mittelpunkt. */
export function regularPolygon(center: LatLng, areaM2: number, sides = 8): LatLng[] {
  const r = Math.sqrt((2 * areaM2) / (sides * Math.sin((2 * Math.PI) / sides)));
  return Array.from({ length: sides }, (_, i) => {
    const angle = (2 * Math.PI * i) / sides + Math.PI / sides;
    return offset(center, r * Math.cos(angle), r * Math.sin(angle));
  });
}

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/** Kartenausschnitt, der alle Punkte mit etwas Rand zeigt. */
export function regionFor(points: LatLng[], padding = 1.3, minDelta = 0.004): Region | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(minDelta, (maxLat - minLat) * padding),
    longitudeDelta: Math.max(minDelta, (maxLng - minLng) * padding),
  };
}

export function formatArea(m2: number): string {
  if (m2 >= 100_000) return `${(m2 / 1_000_000).toFixed(2).replace('.', ',')} km²`;
  return `${Math.round(m2 / 100) * 100} m²`;
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m)} m`;
}
