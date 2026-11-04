import { describe, expect, it } from 'vitest';

import { abilitySlots, directionName, gainedText } from '../abilities';
import { distanceM, offset, pointInPolygon } from '../geo';
import { fetchCheckpointSpots, overpassQuery, parseWays, sampleSpots } from '../osm';
import { openCheckpoints, pingTrails } from '../rules';
import type { Checkpoint, Ping, PlayerAbility } from '../types';

const center = { lat: 52.5128, lng: 13.3559 };
const area = [
  offset(center, 300, -400),
  offset(center, 300, 400),
  offset(center, -300, 400),
  offset(center, -300, -400),
];

describe('Fähigkeiten', () => {
  const owned = (rows: Partial<PlayerAbility>[]): PlayerAbility[] =>
    rows.map((r) => ({ game_id: 'g', user_id: 'u', ability: 'jammer', charges: 1, armed: false, cooldown_until: null, ...r }));

  it('zeigt alle erlaubten Fähigkeiten der eigenen Rolle, auch ohne Ladung', () => {
    const slots = abilitySlots('runner', ['jammer', 'fake_ping', 'radar'], owned([{ ability: 'jammer', charges: 2 }]), 0);
    expect(slots.map((s) => [s.ability, s.charges, s.usable])).toEqual([
      ['jammer', 2, true],
      ['fake_ping', 0, false],
    ]);
  });

  it('sperrt während der Abklingzeit und solange sie scharf ist', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');
    const slots = abilitySlots(
      'hunter',
      ['radar', 'compass'],
      owned([
        { ability: 'radar', cooldown_until: '2026-11-04T12:01:30Z' },
        { ability: 'compass', armed: true },
      ]),
      now,
    );
    expect(slots[0]).toMatchObject({ ability: 'radar', cooldownMs: 90_000, usable: false });
    expect(slots[1]).toMatchObject({ ability: 'compass', usable: false });
  });

  it('übersetzt Himmelsrichtungen', () => {
    expect(directionName(0)).toBe('Norden');
    expect(directionName(44)).toBe('Nordosten');
    expect(directionName(100)).toBe('Osten');
    expect(directionName(181)).toBe('Süden');
    expect(directionName(-90)).toBe('Westen');
    expect(directionName(350)).toBe('Norden');
  });

  it('erklärt, woher eine Fähigkeit kommt', () => {
    expect(gainedText('fake_ping', 'checkpoint')).toBe('Toter Briefkasten geleert: Fake-Ping erhalten!');
    expect(gainedText('radar', 'catch')).toBe('Belohnung für den Fang: Radar');
  });
});

describe('Pings', () => {
  const ping = (id: number, target: string, kind: Ping['kind'], lat: number | null = 1): Ping => ({
    id,
    game_id: 'g',
    target_id: target,
    seq: id,
    kind,
    lat,
    lng: lat,
    radius_m: 100,
    created_at: '',
  });

  it('merkt sich pro Agent den neuesten Ping und den letzten mit Ort', () => {
    const trails = pingTrails([ping(1, 'a', 'regular'), ping(2, 'a', 'radar'), ping(3, 'a', 'jammed', null), ping(4, 'b', 'regular')]);
    const a = trails.get('a')!;
    expect(a.latest.kind).toBe('jammed');
    expect(a.located?.id).toBe(2);
    expect(a.previous?.id).toBe(1);
    expect(trails.get('b')?.previous).toBeNull();
  });
});

describe('Tote Briefkästen', () => {
  const cp = (id: number, appears: number, expires: number): Checkpoint => ({
    id,
    game_id: 'g',
    seq: id,
    lat: 0,
    lng: 0,
    appears_at: new Date(appears).toISOString(),
    hunters_see_at: new Date(appears + 60_000).toISOString(),
    expires_at: new Date(expires).toISOString(),
    revealed: false,
  });

  it('zeigt nur offene, nicht geleerte Briefkästen', () => {
    const list = [cp(1, 0, 300_000), cp(2, 0, 300_000), cp(3, 400_000, 700_000)];
    const claims = [{ checkpoint_id: 2, game_id: 'g', user_id: 'u', claimed_at: '' }];
    expect(openCheckpoints(list, claims, 100_000).map((c) => c.id)).toEqual([1]);
    expect(openCheckpoints(list, [], 350_000)).toEqual([]);
  });
});

describe('OpenStreetMap', () => {
  // Ein Weg quer durchs Gebiet, einer am Rand und einer ganz draußen.
  const across = [offset(center, 0, -600), offset(center, 0, 600)];
  const edge = [offset(center, 295, -300), offset(center, 295, 300)];
  const outside = [offset(center, 1000, 0), offset(center, 1000, 300)];
  const overpass = {
    elements: [
      { type: 'way', id: 1, geometry: across.map((p) => ({ lat: p.lat, lon: p.lng })) },
      { type: 'way', id: 2, geometry: edge.map((p) => ({ lat: p.lat, lon: p.lng })) },
      { type: 'way', id: 3, geometry: outside.map((p) => ({ lat: p.lat, lon: p.lng })) },
      { type: 'node', id: 4, lat: 1, lon: 2 },
      { type: 'way', id: 5, geometry: [{ lat: 1, lon: 2 }] },
    ],
  };

  it('fragt nur Fußwege im Einsatzgebiet ab, ohne Straßenübergänge', () => {
    const q = overpassQuery(area);
    expect(q).toContain('(poly:"');
    expect(q).toContain('footway|path|pedestrian|track');
    expect(q).toContain('crossing');
    expect(q).toContain(`${area[0].lat.toFixed(6)} ${area[0].lng.toFixed(6)}`);
  });

  it('liest Wege aus der Antwort', () => {
    expect(parseWays(overpass)).toHaveLength(3);
    expect(parseWays(null)).toEqual([]);
    expect(parseWays({ elements: 'kaputt' })).toEqual([]);
  });

  it('verteilt Orte entlang der Wege, nur im Gebiet und nicht am Rand', () => {
    const spots = sampleSpots(parseWays(overpass), area);
    expect(spots.length).toBeGreaterThan(10);
    for (const s of spots) {
      expect(pointInPolygon(s, area)).toBe(true);
      expect(Math.abs(s.lat - center.lat)).toBeLessThan(0.0001); // nur der Weg quer durch, nicht der am Rand
    }
    for (let i = 1; i < spots.length; i++) {
      for (let j = 0; j < i; j++) expect(distanceM(spots[i], spots[j])).toBeGreaterThanOrEqual(34.9);
    }
  });

  it('begrenzt die Anzahl und verteilt sie trotzdem übers Gebiet', () => {
    const spots = sampleSpots(parseWays(overpass), area, { max: 5 });
    expect(spots.length).toBeLessThanOrEqual(5);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    const lngs = spots.map((s) => s.lng);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeGreaterThan(0.006); // über ~400 m verteilt
  });

  it('lädt die Orte von Overpass', async () => {
    let body = '';
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return { ok: true, json: async () => overpass } as Response;
    }) as typeof fetch;
    const spots = await fetchCheckpointSpots(area, fakeFetch);
    expect(body.startsWith('data=')).toBe(true);
    expect(spots.length).toBeGreaterThan(10);

    const failing = (async () => ({ ok: false, status: 429 }) as Response) as typeof fetch;
    await expect(fetchCheckpointSpots(area, failing)).rejects.toThrow('overpass_429');
  });
});

describe('Meldungen', () => {
  // Eigener Import, damit die Datei oben übersichtlich bleibt.
  it('warnt Agenten vor dem Radar, verrät dem Jäger aber keine Agenten-Tricks', async () => {
    const { describeEvent, describePing, pickMessage } = await import('../event-messages');
    const names = { h: 'Hai', a: 'Falke' };
    const ev = (type: string, actor: string | null, payload: Record<string, unknown> = {}) =>
      ({ id: 1, game_id: 'g', type, actor_id: actor, target_id: null, audience: 'all', payload, created_at: '' }) as never;

    expect(describeEvent(ev('ability_used', 'h', { ability: 'radar' }), names, 'a', 'runner')?.tone).toBe('danger');
    expect(describeEvent(ev('ability_used', 'h', { ability: 'radar' }), names, 'h', 'hunter')).toBeNull();
    expect(describeEvent(ev('ability_used', 'a', { ability: 'jammer' }), names, 'a', 'runner')?.text).toContain('Störsender scharf');
    expect(describeEvent(ev('checkpoint', null), names, 'h', 'hunter')).toBeNull();
    expect(describeEvent(ev('ability_gained', 'a', { ability: 'fake_ping', source: 'checkpoint' }), names, 'a', 'runner')?.text).toBe(
      'Toter Briefkasten geleert: Fake-Ping erhalten!',
    );

    const ping = (kind: string, target: string) =>
      ({ id: 1, game_id: 'g', target_id: target, seq: 1, kind, lat: null, lng: null, radius_m: 0, created_at: '' }) as never;
    expect(describePing(ping('jammed', 'a'), names, 'h', 'hunter')?.text).toBe('Signal von Falke gestört!');
    expect(describePing(ping('jammed', 'a'), names, 'a', 'runner')?.tone).toBe('good');
    expect(describePing(ping('exposed', 'a'), names, 'a', 'runner')?.priority).toBeGreaterThan(5);
    expect(describePing(ping('regular', 'a'), names, 'h', 'hunter')).toBeNull();

    // Der Fake-Ping-Hinweis gewinnt gegen die normale Ping-Meldung.
    const picked = pickMessage([
      describeEvent(ev('fake_ping_sent', 'a'), names, 'a', 'runner'),
      describeEvent(ev('ping', null), names, 'a', 'runner'),
    ]);
    expect(picked?.text).toContain('Fake-Ping gesendet');
  });
});

describe('Decknamen', () => {
  it('würfelt Decknamen im Agenten-Stil', async () => {
    const { randomCodename } = await import('../codenames');
    expect(randomCodename(() => 0)).toBe('Falke-00');
    expect(randomCodename(() => 0.999)).toMatch(/^Nova-99$/);
    for (let i = 0; i < 50; i++) expect(randomCodename()).toMatch(/^[A-Za-zäöü]+-\d{2}$/);
  });
});
