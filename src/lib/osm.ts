import { pointInPolygon } from './geo';
import type { LatLng } from './types';

// Sichere Orte für tote Briefkästen: Punkte auf Fußwegen, Pfaden und Plätzen aus
// OpenStreetMap. Ausgeschlossen sind Straßenübergänge, private Wege, Tunnel und
// Treppen, damit niemand für einen Briefkasten auf die Straße oder auf Gleise läuft.
// Die Daten stehen unter der ODbL: Wo wir sie zeigen, nennen wir die Quelle.

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const OSM_ATTRIBUTION = 'Wegdaten © OpenStreetMap-Mitwirkende';

/** Abfrage für alle passenden Wege im Einsatzgebiet. */
export function overpassQuery(area: LatLng[]): string {
  const poly = area.map((p) => `${p.lat.toFixed(6)} ${p.lng.toFixed(6)}`).join(' ');
  return [
    '[out:json][timeout:25];',
    'way["highway"~"^(footway|path|pedestrian|track)$"]',
    '["footway"!~"^(crossing|traffic_island|access_aisle)$"]',
    '["access"!~"^(private|no|customers)$"]',
    '["foot"!~"^(no|private)$"]',
    '["tunnel"!~"^(yes|building_passage|culvert)$"]',
    '["indoor"!="yes"]',
    `(poly:"${poly}");`,
    'out geom 3000;',
  ].join('');
}

/** Liest die Wege (als Punktfolgen) aus der Antwort von Overpass. */
export function parseWays(json: unknown): LatLng[][] {
  const elements = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const ways: LatLng[][] = [];
  for (const el of elements) {
    const geometry = (el as { type?: string; geometry?: { lat?: unknown; lon?: unknown }[] }).geometry;
    if ((el as { type?: string }).type !== 'way' || !Array.isArray(geometry)) continue;
    const points = geometry
      .filter((g) => typeof g?.lat === 'number' && typeof g?.lon === 'number')
      .map((g) => ({ lat: g.lat as number, lng: g.lon as number }));
    if (points.length >= 2) ways.push(points);
  }
  return ways;
}

const R = 6371008.8;

/** Lokales Meter-System um einen Bezugspunkt (genau genug für ein Spielfeld). */
function projector(origin: LatLng) {
  const kx = (Math.PI / 180) * R * Math.cos((origin.lat * Math.PI) / 180);
  const ky = (Math.PI / 180) * R;
  return {
    to: (p: LatLng) => ({ x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * ky }),
    from: (q: { x: number; y: number }): LatLng => ({ lat: origin.lat + q.y / ky, lng: origin.lng + q.x / kx }),
  };
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export type SampleOptions = {
  /** Abstand der Kandidaten entlang eines Weges. */
  stepM?: number;
  /** Mindestabstand zwischen zwei Orten. */
  minGapM?: number;
  /** Mindestabstand zur Grenze des Einsatzgebiets. */
  edgeMarginM?: number;
  /** Höchstens so viele Orte (der Server nimmt bis zu 300). */
  max?: number;
};

/**
 * Verteilt Orte gleichmäßig entlang der Wege: nur im Gebiet, nicht direkt an der
 * Grenze und mit Mindestabstand zueinander. Sind es zu viele, wird der Abstand
 * schrittweise größer, damit die Orte über das ganze Gebiet verteilt bleiben.
 */
export function sampleSpots(ways: LatLng[][], area: LatLng[], options: SampleOptions = {}): LatLng[] {
  const { stepM = 40, minGapM = 35, edgeMarginM = 20, max = 250 } = options;
  if (area.length < 3) return [];
  const proj = projector(area[0]);
  const edges = area.map((p, i) => [proj.to(p), proj.to(area[(i + 1) % area.length])] as const);

  const candidates: { x: number; y: number }[] = [];
  for (const way of ways) {
    const pts = way.map(proj.to);
    let carry = 0; // Meter bis zum nächsten Kandidaten
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      let at = carry;
      while (at <= len) {
        const t = len === 0 ? 0 : at / len;
        candidates.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
        at += stepM;
      }
      carry = at - len;
    }
  }

  const usable = candidates.filter((q) => {
    if (!pointInPolygon(proj.from(q), area)) return false;
    return edges.every(([a, b]) => distToSegment(q, a, b) >= edgeMarginM);
  });

  let gap = minGapM;
  for (;;) {
    const kept = thin(usable, gap);
    if (kept.length <= max) return kept.map(proj.from);
    gap *= 1.4;
  }
}

/** Behält Punkte nur, wenn im Umkreis von `gap` Metern noch keiner liegt (Raster-Suche). */
function thin(points: { x: number; y: number }[], gap: number): { x: number; y: number }[] {
  const grid = new Map<string, { x: number; y: number }[]>();
  const kept: { x: number; y: number }[] = [];
  const cell = (v: number) => Math.floor(v / gap);
  for (const p of points) {
    const cx = cell(p.x);
    const cy = cell(p.y);
    let free = true;
    for (let dx = -1; dx <= 1 && free; dx++) {
      for (let dy = -1; dy <= 1 && free; dy++) {
        for (const q of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < gap) {
            free = false;
            break;
          }
        }
      }
    }
    if (!free) continue;
    kept.push(p);
    const key = `${cx}:${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), p]);
  }
  return kept;
}

/** Lädt die Wege aus OpenStreetMap und gibt die sicheren Orte im Gebiet zurück. */
export async function fetchCheckpointSpots(
  area: LatLng[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<LatLng[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `data=${encodeURIComponent(overpassQuery(area))}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`overpass_${res.status}`);
    return sampleSpots(parseWays(await res.json()), area);
  } finally {
    clearTimeout(timer);
  }
}
