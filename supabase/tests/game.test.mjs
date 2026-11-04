// Spielt komplette Runden mit simulierten Spielern gegen das lokale Supabase durch.
// Start: npx supabase start && npm run test:backend
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Spielfeld: ein Rechteck von etwa 800 m x 600 m im Berliner Tiergarten.
const AREA = [
  { lat: 52.5155, lng: 13.3500 },
  { lat: 52.5155, lng: 13.3618 },
  { lat: 52.5101, lng: 13.3618 },
  { lat: 52.5101, lng: 13.3500 },
];
const CENTER = { lat: 52.5128, lng: 13.3559 };

const db = new pg.Client({ connectionString: DB_URL });

before(async () => {
  await db.connect();
});
after(async () => {
  await db.end();
});

async function player(name) {
  const client = createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { name, client, id: data.user.id };
}

async function rpc(p, fn, args) {
  const { data, error } = await p.client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

async function rpcError(p, fn, args) {
  const { error } = await p.client.rpc(fn, args);
  assert.ok(error, `${fn} sollte fehlschlagen`);
  return error.message;
}

// Verschiebt alle Zeitpunkte eines Spiels in die Vergangenheit ("Zeitreise"):
// Spieluhr, tote Briefkästen, Abklingzeiten und die Uhren der Strafen.
// Standorte bleiben frisch, damit die Entfernungsprüfung beim Fangen greift.
async function fastForward(gameId, seconds) {
  await db.query(
    `update games set
       started_at = started_at - make_interval(secs => $2),
       hunt_starts_at = hunt_starts_at - make_interval(secs => $2),
       ends_at = ends_at - make_interval(secs => $2),
       next_ping_at = next_ping_at - make_interval(secs => $2),
       next_checkpoint_at = next_checkpoint_at - make_interval(secs => $2)
     where id = $1`,
    [gameId, seconds],
  );
  await db.query(
    `update checkpoints set
       appears_at = appears_at - make_interval(secs => $2),
       hunters_see_at = hunters_see_at - make_interval(secs => $2),
       expires_at = expires_at - make_interval(secs => $2)
     where game_id = $1`,
    [gameId, seconds],
  );
  await db.query(
    `update player_abilities set cooldown_until = cooldown_until - make_interval(secs => $2) where game_id = $1`,
    [gameId, seconds],
  );
  await db.query(
    `update private.runner_state set
       anchor_at = anchor_at - make_interval(secs => $2),
       outside_since = outside_since - make_interval(secs => $2),
       last_exposed_at = last_exposed_at - make_interval(secs => $2)
     where game_id = $1`,
    [gameId, seconds],
  );
}

// Gibt einem Spieler für den Test genau diese Fähigkeiten (überschreibt die zufällige Start-Fähigkeit).
async function giveAbilities(gameId, userId, charges) {
  await db.query('delete from player_abilities where game_id = $1 and user_id = $2', [gameId, userId]);
  for (const [ability, n] of Object.entries(charges)) {
    await db.query('insert into player_abilities (game_id, user_id, ability, charges) values ($1, $2, $3, $4)', [
      gameId,
      userId,
      ability,
      n,
    ]);
  }
}

async function myAbilities(p, gameId) {
  const { data, error } = await p.client.from('player_abilities').select('user_id, ability, charges, armed').eq('game_id', gameId).order('ability');
  if (error) throw new Error(error.message);
  return data;
}

async function visibleEvents(p, gameId) {
  const { data, error } = await p.client.from('events').select('type, actor_id, audience, payload').eq('game_id', gameId).order('id');
  if (error) throw new Error(error.message);
  return data;
}

// Himmelsrichtung von a nach b in Grad (0 = Norden, 90 = Osten).
function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function insideArea(p) {
  let inside = false;
  for (let i = 0, j = AREA.length - 1; i < AREA.length; j = i++) {
    const a = AREA[i];
    const b = AREA[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

function offset(lat, lng, northM, eastM) {
  return {
    lat: lat + northM / 111320,
    lng: lng + eastM / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

function distanceM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function move(p, gameId, pos) {
  return rpc(p, 'update_position', { p_game: gameId, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: 5 });
}

async function setupGame({ mode = 'infection', runners = 3 } = {}) {
  const host = await player('Host');
  const others = [];
  for (let i = 0; i < runners; i++) others.push(await player(`Agent ${i + 1}`));
  const gameId = await rpc(host, 'create_game', { p_name: host.name });
  const { data: game } = await host.client.from('games').select('code').eq('id', gameId).single();
  for (const p of others) {
    const joined = await rpc(p, 'join_game', { p_code: game.code.toLowerCase(), p_name: p.name });
    assert.equal(joined, gameId);
  }
  await rpc(host, 'update_settings', { p_game: gameId, p_mode: mode, p_headstart_sec: 300, p_duration_sec: 2700 });
  await rpc(host, 'set_area', { p_game: gameId, p_points: AREA });
  await rpc(host, 'set_role', { p_game: gameId, p_user: host.id, p_role: 'hunter' });
  return { host, hunter: host, runners: others, gameId, code: game.code };
}

test('Lobby: beitreten, Einstellungen nur durch den Host, Spielfeld prüfen', async () => {
  const { host, runners, gameId, code } = await setupGame();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);

  assert.equal(await rpcError(runners[0], 'set_area', { p_game: gameId, p_points: AREA }), 'not_host');
  assert.equal(await rpcError(runners[0], 'start_game', { p_game: gameId }), 'not_host');

  const tiny = [CENTER, offset(CENTER.lat, CENTER.lng, 10, 0), offset(CENTER.lat, CENTER.lng, 0, 10)];
  assert.equal(await rpcError(host, 'set_area', { p_game: gameId, p_points: tiny }), 'area_too_small');

  const bowtie = [AREA[0], AREA[2], AREA[1], AREA[3]];
  assert.equal(await rpcError(host, 'set_area', { p_game: gameId, p_points: bowtie }), 'area_self_intersects');

  const result = await rpc(host, 'set_area', { p_game: gameId, p_points: AREA });
  assert.ok(result.area_m2 > 400000 && result.area_m2 < 600000, `Fläche ${result.area_m2}`);

  const stranger = await player('Fremder');
  const { data: hidden } = await stranger.client.from('games').select('*').eq('id', gameId);
  assert.deepEqual(hidden, [], 'Fremde sehen das Spiel nicht');
  assert.equal(await rpcError(stranger, 'join_game', { p_code: 'ZZZZZZ', p_name: 'x' }), 'game_not_found');
  assert.equal(await rpcError(stranger, 'join_game', { p_code: code, p_name: '   ' }), 'invalid_name');

  const { data: players } = await runners[1].client.from('players').select('name, role').eq('game_id', gameId);
  assert.equal(players.length, 4);
});

test('Direktes Schreiben in Tabellen ist verboten', async () => {
  const { runners, gameId } = await setupGame();
  const r = runners[0];
  const { error: e1 } = await r.client.from('players').update({ role: 'hunter' }).eq('game_id', gameId).eq('user_id', r.id);
  const { data: me } = await r.client.from('players').select('role').eq('game_id', gameId).eq('user_id', r.id).single();
  assert.ok(e1 || me.role === 'runner', 'Rolle darf sich nicht direkt ändern lassen');
  assert.equal(me.role, 'runner');
  const { error: e2 } = await r.client.from('pings').insert({ game_id: gameId, target_id: r.id, seq: 1, lat: 0, lng: 0, radius_m: 1 });
  assert.ok(e2, 'Pings dürfen nicht direkt geschrieben werden');
  const { error: e3 } = await r.client.from('games').update({ status: 'ended' }).eq('id', gameId);
  const { data: g } = await r.client.from('games').select('status').eq('id', gameId).single();
  assert.ok(e3 || g.status === 'lobby');
  assert.equal(g.status, 'lobby');
});

test('Doppelagent-Modus: komplette Runde bis alle gefangen sind', async () => {
  const { hunter, runners, gameId } = await setupGame({ mode: 'infection' });
  const [a, b, c] = runners;

  await rpc(hunter, 'start_game', { p_game: gameId });
  let state = await rpc(a, 'tick', { p_game: gameId });
  assert.equal(state.status, 'headstart');

  // Jeder sieht nur seine eigene Agenten-ID.
  const { data: secretsA } = await a.client.from('player_secrets').select('*').eq('game_id', gameId);
  assert.equal(secretsA.length, 1);
  assert.equal(secretsA[0].user_id, a.id);
  const { data: secretsH } = await hunter.client.from('player_secrets').select('*').eq('game_id', gameId);
  assert.equal(secretsH.length, 1, 'Jäger sieht nur die eigene ID');

  // Agenten verteilen sich, der Jäger bleibt in der Mitte.
  const posA = offset(CENTER.lat, CENTER.lng, 200, 150);
  const posB = offset(CENTER.lat, CENTER.lng, -200, -250);
  const posC = offset(CENTER.lat, CENTER.lng, 100, -300);
  await move(a, gameId, posA);
  await move(b, gameId, posB);
  await move(c, gameId, posC);
  const moveResult = await move(hunter, gameId, CENTER);
  assert.equal(moveResult.inside, true);

  // Außerhalb des Spielfelds?
  const outside = await move(c, gameId, offset(CENTER.lat, CENTER.lng, 2000, 0));
  assert.equal(outside.inside, false);
  await move(c, gameId, posC);

  // Der Jäger sieht keine Agenten-Standorte, nur seinen eigenen.
  const { data: hunterView } = await hunter.client.from('positions').select('user_id').eq('game_id', gameId);
  assert.deepEqual(hunterView.map((r) => r.user_id), [hunter.id]);
  // Ein Agent sieht nur sich selbst.
  const { data: runnerView } = await a.client.from('positions').select('user_id').eq('game_id', gameId);
  assert.deepEqual(runnerView.map((r) => r.user_id), [a.id]);

  // Fangen während des Vorsprungs geht nicht.
  assert.equal(await rpcError(hunter, 'catch_runner', { p_game: gameId, p_token: secretsA[0].catch_token }), 'not_hunting');

  // Vorsprung vorbei: Jagd beginnt und der erste Ping kommt sofort.
  await fastForward(gameId, 301);
  state = await rpc(hunter, 'tick', { p_game: gameId });
  assert.equal(state.status, 'hunt');
  assert.equal(state.ping_seq, 1);

  const { data: pingsHunter } = await hunter.client.from('pings').select('*').eq('game_id', gameId);
  assert.equal(pingsHunter.length, 3, 'Ein Ping pro Agent');
  for (const ping of pingsHunter) {
    assert.equal(ping.radius_m, 250);
    const real = { [a.id]: posA, [b.id]: posB, [c.id]: posC }[ping.target_id];
    const d = distanceM(real, ping);
    assert.ok(d <= ping.radius_m, `Agent liegt im Kreis (${d.toFixed(1)} m)`);
  }
  const { data: pingsA } = await a.client.from('pings').select('target_id').eq('game_id', gameId);
  assert.deepEqual(pingsA.map((p) => p.target_id), [a.id], 'Agent sieht nur seinen eigenen Ping');

  // Kein zweiter Ping, bevor das Intervall vorbei ist.
  state = await rpc(b, 'tick', { p_game: gameId });
  assert.equal(state.ping_seq, 1);

  // Nach 5 Minuten kommt der nächste Ping.
  await fastForward(gameId, 300);
  state = await rpc(b, 'tick', { p_game: gameId });
  assert.equal(state.ping_seq, 2);

  // Ein Agent kann nicht fangen, ungültige Codes werden abgelehnt.
  assert.equal(await rpcError(b, 'catch_runner', { p_game: gameId, p_token: secretsA[0].catch_token }), 'not_a_hunter');
  assert.equal(await rpcError(hunter, 'catch_runner', { p_game: gameId, p_token: 'SH1-falsch' }), 'invalid_code');

  // Zu weit weg: Fang wird abgelehnt.
  assert.equal(await rpcError(hunter, 'catch_runner', { p_game: gameId, p_token: secretsA[0].catch_token }), 'too_far');

  // Der Jäger läuft zu Agent A und scannt seinen QR-Code.
  await move(hunter, gameId, offset(posA.lat, posA.lng, 5, 5));
  const caught = await rpc(hunter, 'catch_runner', { p_game: gameId, p_token: secretsA[0].catch_token });
  assert.equal(caught.target_id, a.id);
  assert.equal(caught.name, 'Agent 1');

  // A ist jetzt Jäger und sieht ab sofort alle Pings, aber weiter keine Agenten-Standorte.
  const { data: aNow } = await a.client.from('players').select('role, status').eq('game_id', gameId).eq('user_id', a.id).single();
  assert.deepEqual(aNow, { role: 'hunter', status: 'active' });
  const { data: pingsANow } = await a.client.from('pings').select('target_id').eq('game_id', gameId);
  assert.ok(pingsANow.length >= 6);
  const { data: aPositions } = await a.client.from('positions').select('user_id').eq('game_id', gameId);
  assert.deepEqual(new Set(aPositions.map((r) => r.user_id)), new Set([a.id, hunter.id]), 'Neuer Jäger sieht nur Jäger');

  // Die alte Agenten-ID ist verbraucht.
  assert.equal(await rpcError(hunter, 'catch_runner', { p_game: gameId, p_token: secretsA[0].catch_token }), 'invalid_code');

  // A (jetzt Jäger) fängt B, der Host fängt C. Danach ist das Spiel vorbei.
  const { data: [secretB] } = await b.client.from('player_secrets').select('catch_token').eq('game_id', gameId);
  const { data: [secretC] } = await c.client.from('player_secrets').select('catch_token').eq('game_id', gameId);
  await move(a, gameId, posB);
  await rpc(a, 'catch_runner', { p_game: gameId, p_token: secretB.catch_token });
  await move(hunter, gameId, posC);
  await rpc(hunter, 'catch_runner', { p_game: gameId, p_token: secretC.catch_token });

  const { data: ended } = await c.client.from('games').select('status, winner, end_reason').eq('id', gameId).single();
  assert.deepEqual(ended, { status: 'ended', winner: 'hunters', end_reason: 'all_caught' });

  // Nach dem Spiel sehen alle die Wege und alle Pings.
  const { data: history } = await c.client.from('position_history').select('user_id').eq('game_id', gameId);
  assert.ok(new Set(history.map((h) => h.user_id)).size === 4);
  const { data: events } = await c.client.from('events').select('type').eq('game_id', gameId).order('id');
  const types = events.map((e) => e.type);
  for (const t of ['created', 'joined', 'started', 'hunt_started', 'ping', 'caught', 'ended']) {
    assert.ok(types.includes(t), `Ereignis ${t} fehlt`);
  }
});

test('Festnahme-Modus: Gefangene scheiden aus und werden Zuschauer', async () => {
  const { hunter, runners, gameId } = await setupGame({ mode: 'elimination', runners: 2 });
  const [a, b] = runners;
  await rpc(hunter, 'start_game', { p_game: gameId });
  const posB = offset(CENTER.lat, CENTER.lng, -150, 100);
  await move(a, gameId, CENTER);
  await move(b, gameId, posB);
  await move(hunter, gameId, CENTER);
  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });

  const { data: [secretA] } = await a.client.from('player_secrets').select('catch_token').eq('game_id', gameId);
  const res = await rpc(hunter, 'catch_runner', { p_game: gameId, p_token: secretA.catch_token });
  assert.equal(res.mode, 'elimination');

  const { data: aNow } = await a.client.from('players').select('role, status').eq('game_id', gameId).eq('user_id', a.id).single();
  assert.deepEqual(aNow, { role: 'runner', status: 'out' });

  // Zuschauer sehen alle Standorte live.
  const { data: spectatorView } = await a.client.from('positions').select('user_id').eq('game_id', gameId);
  assert.equal(spectatorView.length, 3);

  // B überlebt bis zum Ende: Agenten gewinnen.
  await fastForward(gameId, 2700);
  const state = await rpc(b, 'tick', { p_game: gameId });
  assert.equal(state.status, 'ended');
  const { data: ended } = await b.client.from('games').select('winner, end_reason').eq('id', gameId).single();
  assert.deepEqual(ended, { winner: 'runners', end_reason: 'time_up' });
});

test('Pings werden mit der Zeit häufiger und genauer', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 1 });
  await rpc(hunter, 'start_game', { p_game: gameId });
  await move(runners[0], gameId, CENTER);
  await fastForward(gameId, 300);
  await rpc(hunter, 'tick', { p_game: gameId }); // Ping 1 bei Minute 0
  await fastForward(gameId, 900);
  await rpc(hunter, 'tick', { p_game: gameId }); // Ping 2 bei Minute 15 → Phase 2
  await fastForward(gameId, 900);
  const state = await rpc(hunter, 'tick', { p_game: gameId }); // Ping 3 bei Minute 30 → Phase 3
  // Der Agent steht die ganze Zeit still und bekommt dafür Extra-Pings. Hier zählen nur die regelmäßigen.
  const { data: pings } = await hunter.client
    .from('pings')
    .select('seq, radius_m')
    .eq('game_id', gameId)
    .eq('kind', 'regular')
    .order('seq');
  assert.deepEqual(pings.map((p) => p.radius_m), [250, 150, 75]);
  const nextIn = (Date.parse(state.next_ping_at) - Date.parse(state.server_now)) / 1000;
  assert.ok(Math.abs(nextIn - 180) < 2, `Nächster Ping in ${nextIn} s`);
});

test('Notfall-Knopf beendet die Runde für alle', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 1 });
  await rpc(hunter, 'start_game', { p_game: gameId });
  await rpc(runners[0], 'abort_game', { p_game: gameId });
  const { data } = await hunter.client.from('games').select('status, winner, end_reason').eq('id', gameId).single();
  assert.deepEqual(data, { status: 'ended', winner: null, end_reason: 'aborted' });
  const { data: secrets } = await runners[0].client.from('player_secrets').select('*').eq('game_id', gameId);
  assert.deepEqual(secrets, [], 'Agenten-IDs werden nach dem Spiel gelöscht');
});

test('Echtzeit: Jäger bekommt Pings live, aber nie Agenten-Standorte', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 1 });
  const [a] = runners;
  await rpc(hunter, 'start_game', { p_game: gameId });
  await move(hunter, gameId, CENTER);

  const received = { positions: [], pings: [] };
  const channel = hunter.client
    .channel(`game-${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: `game_id=eq.${gameId}` }, (msg) =>
      received.positions.push(msg.new.user_id),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings', filter: `game_id=eq.${gameId}` }, (msg) =>
      received.pings.push(msg.new),
    );
  await new Promise((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
    });
  });
  await new Promise((r) => setTimeout(r, 3000));

  await move(a, gameId, offset(CENTER.lat, CENTER.lng, 100, 100));
  await move(hunter, gameId, offset(CENTER.lat, CENTER.lng, 1, 1));
  await fastForward(gameId, 301);
  await rpc(a, 'tick', { p_game: gameId });
  await new Promise((r) => setTimeout(r, 2500));
  await hunter.client.removeChannel(channel);

  console.log('empfangen:', JSON.stringify({ positions: received.positions.length, pings: received.pings.length }));
  assert.equal(received.pings.length, 1, 'Ping kommt live an');
  assert.equal(received.pings[0].target_id, a.id);
  assert.ok(!received.positions.includes(a.id), 'Agenten-Standort darf nie beim Jäger ankommen');
  assert.ok(received.positions.includes(hunter.id), 'Eigener Standort kommt an');
});

test('Neue Runde: Host setzt ein beendetes Spiel zurück in die Lobby', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 2 });
  await rpc(hunter, 'start_game', { p_game: gameId });
  assert.equal(await rpcError(hunter, 'reset_game', { p_game: gameId }), 'wrong_status');
  await move(runners[0], gameId, CENTER);
  await rpc(runners[1], 'abort_game', { p_game: gameId });
  assert.equal(await rpcError(runners[0], 'reset_game', { p_game: gameId }), 'not_host');
  await rpc(hunter, 'reset_game', { p_game: gameId });

  const { data: g } = await runners[0].client.from('games').select('status, area, ping_seq').eq('id', gameId).single();
  assert.equal(g.status, 'lobby');
  assert.equal(g.area.length, 4, 'Einsatzgebiet bleibt erhalten');
  const { data: players } = await runners[0].client.from('players').select('role, status').eq('game_id', gameId);
  assert.equal(players.length, 3);
  assert.ok(players.every((p) => p.role === 'runner' && p.status === 'active'));
  const { data: pos } = await runners[0].client.from('positions').select('*').eq('game_id', gameId);
  assert.deepEqual(pos, []);

  // Neue Runde lässt sich wieder starten.
  await rpc(hunter, 'set_role', { p_game: gameId, p_user: hunter.id, p_role: 'hunter' });
  await rpc(hunter, 'start_game', { p_game: gameId });
  const state = await rpc(runners[0], 'tick', { p_game: gameId });
  assert.equal(state.status, 'headstart');
});

test('Aufräumen: alte Spiele werden mit allen Standorten gelöscht', async () => {
  const { gameId } = await setupGame({ runners: 1 });
  await db.query(`update games set created_at = now() - interval '25 hours' where id = $1`, [gameId]);
  const { rows } = await db.query('select private.cleanup_old_games () as n');
  assert.ok(rows[0].n >= 1);
  const { rows: left } = await db.query('select count(*)::int as n from games where id = $1', [gameId]);
  assert.equal(left[0].n, 0);
  const { rows: jobs } = await db.query(`select jobname from cron.job where jobname = 'signal-hunt-cleanup'`);
  assert.equal(jobs.length, 1);
});

// ---------------------------------------------------------------------------
// Schritt 2: Fähigkeiten, tote Briefkästen und Strafen
// ---------------------------------------------------------------------------

test('Fähigkeiten: Start-Fähigkeit, Einstellungen und Rollen', async () => {
  const { host, hunter, runners, gameId } = await setupGame({ runners: 2 });
  const [a, b] = runners;

  assert.equal(await rpcError(a, 'update_extras', { p_game: gameId, p_abilities: ['radar'], p_checkpoints: false }), 'not_host');
  assert.equal(
    await rpcError(host, 'update_extras', { p_game: gameId, p_abilities: ['radar', 'tarnkappe'], p_checkpoints: false }),
    'invalid_ability',
  );
  await rpc(host, 'update_extras', { p_game: gameId, p_abilities: ['jammer', 'radar'], p_checkpoints: false });
  const { data: g } = await host.client.from('games').select('abilities, checkpoints_enabled').eq('id', gameId).single();
  assert.deepEqual(g, { abilities: ['jammer', 'radar'], checkpoints_enabled: false });

  await rpc(host, 'start_game', { p_game: gameId });

  // Jeder startet mit genau einer erlaubten Fähigkeit seiner Rolle und sieht nur seine eigenen.
  assert.deepEqual(await myAbilities(a, gameId), [{ user_id: a.id, ability: 'jammer', charges: 1, armed: false }]);
  assert.deepEqual(await myAbilities(b, gameId), [{ user_id: b.id, ability: 'jammer', charges: 1, armed: false }]);
  assert.deepEqual(await myAbilities(hunter, gameId), [{ user_id: hunter.id, ability: 'radar', charges: 1, armed: false }]);

  // Direkt schreiben geht nicht.
  const { error: e1 } = await a.client.from('player_abilities').insert({ game_id: gameId, user_id: a.id, ability: 'fake_ping', charges: 9 });
  assert.ok(e1, 'Fähigkeiten dürfen nicht direkt geschrieben werden');
  const { error: e2 } = await a.client.from('checkpoints').insert({ game_id: gameId, seq: 1, lat: 0, lng: 0, hunters_see_at: 'now()', expires_at: 'now()' });
  assert.ok(e2, 'Briefkästen dürfen nicht direkt geschrieben werden');

  assert.equal(await rpcError(a, 'use_ability', { p_game: gameId, p_ability: 'radar' }), 'not_hunting');
  assert.equal(await rpcError(hunter, 'use_ability', { p_game: gameId, p_ability: 'radar' }), 'not_hunting', 'Jäger erst nach dem Vorsprung');
  assert.equal(await rpcError(a, 'use_ability', { p_game: gameId, p_ability: 'fake_ping' }), 'ability_disabled');
  assert.equal(await rpcError(a, 'use_ability', { p_game: gameId, p_ability: 'tarnkappe' }), 'invalid_ability');

  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });
  assert.equal(await rpcError(a, 'use_ability', { p_game: gameId, p_ability: 'radar' }), 'wrong_role');
  assert.equal(await rpcError(hunter, 'use_ability', { p_game: gameId, p_ability: 'jammer' }), 'wrong_role');
  assert.equal(await rpcError(hunter, 'use_ability', { p_game: gameId, p_ability: 'compass' }), 'ability_disabled');
});

test('Störsender und Fake-Ping: Der Jäger merkt nichts davon', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 2 });
  const [a, b] = runners;
  await rpc(hunter, 'start_game', { p_game: gameId });
  await giveAbilities(gameId, a.id, { jammer: 2 });
  await giveAbilities(gameId, b.id, { fake_ping: 1 });

  const posA = offset(CENTER.lat, CENTER.lng, 150, 200);
  const posB = offset(CENTER.lat, CENTER.lng, -220, -330); // nahe der Südwest-Ecke
  await move(a, gameId, posA);
  await move(b, gameId, posB);
  await move(hunter, gameId, CENTER);

  // Schon im Vorsprung scharf schalten. Nur der Agent selbst erfährt davon.
  const armed = await rpc(a, 'use_ability', { p_game: gameId, p_ability: 'jammer' });
  assert.deepEqual(armed, { ability: 'jammer', armed: true });
  assert.equal(await rpcError(a, 'use_ability', { p_game: gameId, p_ability: 'jammer' }), 'cooldown');
  await rpc(b, 'use_ability', { p_game: gameId, p_ability: 'fake_ping' });
  assert.equal(await rpcError(b, 'use_ability', { p_game: gameId, p_ability: 'fake_ping' }), 'no_charges');

  assert.deepEqual(await myAbilities(a, gameId), [{ user_id: a.id, ability: 'jammer', charges: 1, armed: true }]);
  const hunterEvents = await visibleEvents(hunter, gameId);
  assert.ok(!hunterEvents.some((e) => e.type === 'ability_used'), 'Jäger sieht nicht, dass Agenten etwas scharf geschaltet haben');
  assert.ok((await visibleEvents(a, gameId)).some((e) => e.type === 'ability_used' && e.actor_id === a.id));
  assert.ok(!(await visibleEvents(a, gameId)).some((e) => e.type === 'ability_used' && e.actor_id === b.id), 'Agenten sehen es auch nicht voneinander');

  // Erster Ping: A ist gestört, B wird an einen falschen Ort verlegt.
  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });
  const { data: pings } = await hunter.client.from('pings').select('*').eq('game_id', gameId).order('id');
  assert.equal(pings.length, 2);
  const pingA = pings.find((p) => p.target_id === a.id);
  const pingB = pings.find((p) => p.target_id === b.id);
  assert.equal(pingA.kind, 'jammed');
  assert.equal(pingA.lat, null);
  assert.equal(pingA.lng, null);

  // Der Fake-Ping sieht aus wie ein echter: gleiche Art, gleicher Radius, aber weit weg vom echten Ort.
  assert.equal(pingB.kind, 'regular');
  assert.equal(pingB.radius_m, 250);
  assert.ok(distanceM(posB, pingB) >= 300, `Fake-Ping ${distanceM(posB, pingB).toFixed(0)} m vom echten Ort`);
  assert.ok(insideArea(pingB), 'Fake-Ping liegt im Einsatzgebiet');
  assert.deepEqual(Object.keys(pingB).sort(), ['created_at', 'game_id', 'id', 'kind', 'lat', 'lng', 'radius_m', 'seq', 'target_id']);
  assert.ok(!(await visibleEvents(hunter, gameId)).some((e) => e.type === 'fake_ping_sent'), 'Jäger erfährt nichts vom Fake-Ping');
  const eventsB = await visibleEvents(b, gameId);
  assert.ok(eventsB.some((e) => e.type === 'fake_ping_sent' && e.payload.ping_id === pingB.id), 'B weiß, dass sein Ping gefälscht war');

  // Beide Fähigkeiten sind verbraucht: Der nächste Ping ist wieder echt.
  assert.deepEqual(await myAbilities(a, gameId), [{ user_id: a.id, ability: 'jammer', charges: 1, armed: false }]);
  await fastForward(gameId, 300);
  await rpc(hunter, 'tick', { p_game: gameId });
  const { data: second } = await hunter.client.from('pings').select('*').eq('game_id', gameId).eq('seq', 2).eq('kind', 'regular');
  assert.equal(second.length, 2);
  for (const p of second) {
    const real = p.target_id === a.id ? posA : posB;
    assert.ok(distanceM(real, p) <= p.radius_m, 'Wieder ein echter Kreis');
  }

  // Nach Ablauf der Abklingzeit lässt sich der Störsender wieder einsetzen.
  await fastForward(gameId, 301);
  await rpc(a, 'use_ability', { p_game: gameId, p_ability: 'jammer' });

  // Nach dem Spiel sieht jeder, wer wann getrickst hat.
  await rpc(hunter, 'abort_game', { p_game: gameId });
  assert.ok((await visibleEvents(hunter, gameId)).some((e) => e.type === 'fake_ping_sent'));
});

test('Radar und Kompass: sofortiger Ping und Richtung ohne Entfernung', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 2 });
  const [a, b] = runners;
  await rpc(hunter, 'start_game', { p_game: gameId });
  await giveAbilities(gameId, hunter.id, { radar: 1, compass: 2 });
  await giveAbilities(gameId, a.id, {});
  await giveAbilities(gameId, b.id, {});
  const posA = offset(CENTER.lat, CENTER.lng, 200, 150);
  const posB = offset(CENTER.lat, CENTER.lng, -250, -200);
  await move(a, gameId, posA);
  await move(b, gameId, posB);
  await move(hunter, gameId, CENTER);
  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });

  const radar = await rpc(hunter, 'use_ability', { p_game: gameId, p_ability: 'radar' });
  assert.deepEqual(radar, { ability: 'radar', targets: 2 });
  const { data: radarPings } = await hunter.client.from('pings').select('*').eq('game_id', gameId).eq('kind', 'radar');
  assert.equal(radarPings.length, 2);
  for (const p of radarPings) {
    const real = p.target_id === a.id ? posA : posB;
    assert.ok(distanceM(real, p) <= p.radius_m);
  }
  assert.equal(await rpcError(hunter, 'use_ability', { p_game: gameId, p_ability: 'radar' }), 'no_charges');
  // Die Agenten werden gewarnt.
  assert.ok((await visibleEvents(a, gameId)).some((e) => e.type === 'ability_used' && e.payload.ability === 'radar'));

  // Kompass: Richtung zum nächsten Agenten (A), aber keine Entfernung.
  const compass = await rpc(hunter, 'use_ability', { p_game: gameId, p_ability: 'compass' });
  assert.deepEqual(Object.keys(compass).sort(), ['ability', 'bearing_deg', 'until']);
  const expected = bearingDeg(CENTER, posA);
  const diff = Math.abs(((compass.bearing_deg - expected + 540) % 360) - 180);
  assert.ok(diff < 2, `Kompass zeigt ${compass.bearing_deg}°, erwartet ${expected.toFixed(1)}°`);
  assert.equal(await rpcError(hunter, 'use_ability', { p_game: gameId, p_ability: 'compass' }), 'cooldown');
  assert.ok((await visibleEvents(b, gameId)).some((e) => e.type === 'ability_used' && e.payload.ability === 'compass'));

  // Weiterhin: Der Jäger sieht keine Agenten-Standorte.
  const { data: hunterView } = await hunter.client.from('positions').select('user_id').eq('game_id', gameId);
  assert.deepEqual(hunterView.map((r) => r.user_id), [hunter.id]);
});

test('Fangen bringt dem Jäger eine Fähigkeit, Doppelagenten wechseln die Ausrüstung', async () => {
  const { hunter, runners, gameId } = await setupGame({ mode: 'infection', runners: 2 });
  const [a] = runners;
  await rpc(hunter, 'start_game', { p_game: gameId });
  await giveAbilities(gameId, hunter.id, {});
  await giveAbilities(gameId, a.id, { jammer: 1, fake_ping: 1 });
  await move(a, gameId, CENTER);
  await move(hunter, gameId, CENTER);
  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });

  const { data: [secretA] } = await a.client.from('player_secrets').select('catch_token').eq('game_id', gameId);
  await rpc(hunter, 'catch_runner', { p_game: gameId, p_token: secretA.catch_token });

  const mine = await myAbilities(hunter, gameId);
  assert.equal(mine.reduce((s, x) => s + x.charges, 0), 1, 'Eine Fähigkeit pro Fang');
  assert.ok(['radar', 'compass'].includes(mine[0].ability));
  const converted = await myAbilities(a, gameId);
  assert.equal(converted.length, 1, 'Agenten-Fähigkeiten sind weg, eine Jäger-Fähigkeit ist neu');
  assert.ok(['radar', 'compass'].includes(converted[0].ability));
});

test('Tote Briefkästen: Agenten zuerst, Jäger nach einer Minute, wer ihn leert, bleibt geheim', async () => {
  const { host, hunter, runners, gameId } = await setupGame({ runners: 2 });
  const [a, b] = runners;

  // Sichere Orte: zwei weit auseinander, einer außerhalb (wird verworfen).
  const spot1 = offset(CENTER.lat, CENTER.lng, 200, -250);
  const spot2 = offset(CENTER.lat, CENTER.lng, -200, 250);
  const outsideSpot = offset(CENTER.lat, CENTER.lng, 2000, 0);
  assert.equal(await rpcError(a, 'set_checkpoint_spots', { p_game: gameId, p_points: [spot1] }), 'not_host');
  const saved = await rpc(host, 'set_checkpoint_spots', { p_game: gameId, p_points: [spot1, spot2, outsideSpot] });
  assert.deepEqual(saved, { spots: 2 });
  const { data: g } = await host.client.from('games').select('checkpoint_spot_count').eq('id', gameId).single();
  assert.equal(g.checkpoint_spot_count, 2);

  await rpc(host, 'start_game', { p_game: gameId });
  await move(a, gameId, offset(CENTER.lat, CENTER.lng, 50, 0));
  await move(b, gameId, offset(CENTER.lat, CENTER.lng, -50, 0));
  await move(hunter, gameId, CENTER);
  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });
  const { data: none } = await a.client.from('checkpoints').select('id').eq('game_id', gameId);
  assert.deepEqual(none, [], 'Noch kein Briefkasten direkt zu Beginn der Jagd');

  // 2 Minuten nach Jagdbeginn erscheint der erste Briefkasten, zuerst nur für Agenten.
  await fastForward(gameId, 121);
  await rpc(a, 'tick', { p_game: gameId });
  const { data: forA } = await a.client.from('checkpoints').select('*').eq('game_id', gameId);
  assert.equal(forA.length, 1);
  const cp = forA[0];
  assert.ok(distanceM(cp, spot1) < 1 || distanceM(cp, spot2) < 1, 'Briefkasten liegt an einem sicheren Ort');
  const { data: forHunter } = await hunter.client.from('checkpoints').select('id').eq('game_id', gameId);
  assert.deepEqual(forHunter, [], 'Jäger sieht ihn noch nicht');
  assert.ok((await visibleEvents(b, gameId)).some((e) => e.type === 'checkpoint'));
  assert.ok(!(await visibleEvents(hunter, gameId)).some((e) => e.type === 'checkpoint'));

  // Nach einer Minute sieht ihn auch der Jäger.
  await fastForward(gameId, 61);
  await rpc(hunter, 'tick', { p_game: gameId });
  const { data: later } = await hunter.client.from('checkpoints').select('id, revealed').eq('game_id', gameId);
  assert.deepEqual(later, [{ id: cp.id, revealed: true }]);

  // A erreicht den Briefkasten (bis 15 m) und bekommt eine Agenten-Fähigkeit.
  const before = await myAbilities(a, gameId);
  const res = await move(a, gameId, offset(cp.lat, cp.lng, 8, 5));
  assert.ok(['jammer', 'fake_ping'].includes(res.claimed), `geleert: ${res.claimed}`);
  const after = await myAbilities(a, gameId);
  assert.equal(after.reduce((s, x) => s + x.charges, 0), before.reduce((s, x) => s + x.charges, 0) + 1);

  // B kommt zu spät. Agenten sehen, dass er leer ist, der Jäger nicht.
  const late = await move(b, gameId, offset(cp.lat, cp.lng, 3, 3));
  assert.equal(late.claimed, null);
  const { data: claimsB } = await b.client.from('checkpoint_claims').select('checkpoint_id, user_id').eq('game_id', gameId);
  assert.deepEqual(claimsB, [{ checkpoint_id: cp.id, user_id: a.id }]);
  const { data: claimsHunter } = await hunter.client.from('checkpoint_claims').select('checkpoint_id').eq('game_id', gameId);
  assert.deepEqual(claimsHunter, [], 'Jäger erfährt nicht, dass jemand dort war');
  assert.ok(!(await visibleEvents(hunter, gameId)).some((e) => e.type === 'checkpoint_claimed'));
  const { data: stillThere } = await hunter.client.from('checkpoints').select('id').eq('game_id', gameId);
  assert.equal(stillThere.length, 1, 'Für den Jäger bleibt er bis zum Ablauf sichtbar');

  // 7 Minuten später der nächste, möglichst weit weg vom letzten.
  await fastForward(gameId, 7 * 60);
  await rpc(a, 'tick', { p_game: gameId });
  const { data: two } = await a.client.from('checkpoints').select('*').eq('game_id', gameId).order('id');
  assert.equal(two.length, 2);
  assert.ok(distanceM(two[0], two[1]) > 150, 'Nicht am selben Ort wie der letzte');

  // Nach 5 Minuten ist er abgelaufen und lässt sich nicht mehr leeren.
  await fastForward(gameId, 301);
  const expired = await move(b, gameId, offset(two[1].lat, two[1].lng, 2, 2));
  assert.equal(expired.claimed, null);

  // Spieler ohne sichere Orte: keine Briefkästen (Standard in allen anderen Tests).
  const other = await setupGame({ runners: 1 });
  await rpc(other.host, 'start_game', { p_game: other.gameId });
  await fastForward(other.gameId, 301);
  await rpc(other.host, 'tick', { p_game: other.gameId });
  const { data: og } = await other.host.client.from('games').select('next_checkpoint_at').eq('id', other.gameId).single();
  assert.equal(og.next_checkpoint_at, null);
});

test('Neues Einsatzgebiet löscht die alten sicheren Orte', async () => {
  const { host, gameId } = await setupGame({ runners: 1 });
  await rpc(host, 'set_checkpoint_spots', { p_game: gameId, p_points: [CENTER] });
  await rpc(host, 'set_area', { p_game: gameId, p_points: AREA });
  const { data: g } = await host.client.from('games').select('checkpoint_spot_count').eq('id', gameId).single();
  assert.equal(g.checkpoint_spot_count, 0);
});

test('Strafe fürs Stillstehen: Warnung nach 2 Minuten, Extra-Ping nach 3', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 1 });
  const [a] = runners;
  await rpc(hunter, 'start_game', { p_game: gameId });
  await giveAbilities(gameId, a.id, {});
  await move(a, gameId, CENTER);
  await fastForward(gameId, 301);
  let state = await rpc(a, 'tick', { p_game: gameId });
  assert.ok(state.idle_sec < 5, 'Die Uhr startet mit der Jagd');

  await fastForward(gameId, 125);
  state = await rpc(a, 'tick', { p_game: gameId });
  assert.ok(state.idle_sec >= 120 && state.idle_sec < 180, `Warnung bei ${state.idle_sec} s`);
  const { data: noIdle } = await hunter.client.from('pings').select('id').eq('game_id', gameId).eq('kind', 'idle');
  assert.deepEqual(noIdle, []);

  // Kleine Bewegungen (unter 20 m) zählen nicht.
  await move(a, gameId, offset(CENTER.lat, CENTER.lng, 8, 6));
  await fastForward(gameId, 60);
  state = await rpc(a, 'tick', { p_game: gameId });
  const { data: idle } = await hunter.client.from('pings').select('*').eq('game_id', gameId).eq('kind', 'idle');
  assert.equal(idle.length, 1, 'Extra-Ping nach 3 Minuten Stillstand');
  assert.ok(distanceM(CENTER, idle[0]) <= idle[0].radius_m);
  assert.ok(state.idle_sec < 5, 'Danach beginnt die Uhr von vorn');

  // Wer sich bewegt, setzt die Uhr zurück.
  await fastForward(gameId, 150);
  const moved = await move(a, gameId, offset(CENTER.lat, CENTER.lng, 40, 0));
  assert.ok(moved.idle_sec < 5);

  // Der Jäger hat kein Stillstand-Problem.
  const hunterState = await rpc(hunter, 'tick', { p_game: gameId });
  assert.equal(hunterState.idle_sec, null);
});

test('Spielfeldgrenze: Nach 30 Sekunden außerhalb sieht der Jäger den genauen Standort', async () => {
  const { hunter, runners, gameId } = await setupGame({ runners: 1 });
  const [a] = runners;
  await rpc(hunter, 'start_game', { p_game: gameId });
  await giveAbilities(gameId, a.id, { jammer: 1 });
  await move(a, gameId, CENTER);
  await move(hunter, gameId, offset(CENTER.lat, CENTER.lng, -100, 0));
  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });
  await rpc(a, 'use_ability', { p_game: gameId, p_ability: 'jammer' });

  const out1 = offset(CENTER.lat, CENTER.lng, 500, 0);
  let res = await move(a, gameId, out1);
  assert.equal(res.inside, false);
  assert.ok(res.outside_sec < 5);
  const exposed = async () =>
    (await hunter.client.from('pings').select('*').eq('game_id', gameId).eq('kind', 'exposed').order('id')).data;
  assert.deepEqual(await exposed(), [], 'In den ersten 30 Sekunden noch nichts');

  await fastForward(gameId, 31);
  const state = await rpc(a, 'tick', { p_game: gameId });
  assert.ok(state.outside_sec >= 30);
  let list = await exposed();
  assert.equal(list.length, 1, 'Genauer Standort trotz Störsender');
  assert.ok(distanceM(out1, list[0]) < 1, 'Genau, nicht verschoben');
  assert.deepEqual(await myAbilities(a, gameId), [{ user_id: a.id, ability: 'jammer', charges: 0, armed: true }]);

  // Höchstens alle 15 Sekunden ein neuer genauer Standort.
  const out2 = offset(CENTER.lat, CENTER.lng, 520, 30);
  await move(a, gameId, out2);
  assert.equal((await exposed()).length, 1);
  await fastForward(gameId, 16);
  await move(a, gameId, offset(CENTER.lat, CENTER.lng, 540, 40));
  list = await exposed();
  assert.equal(list.length, 2);

  // Zurück im Gebiet: keine genauen Standorte mehr.
  res = await move(a, gameId, CENTER);
  assert.equal(res.inside, true);
  assert.equal(res.outside_sec, null);
  await fastForward(gameId, 40);
  await rpc(a, 'tick', { p_game: gameId });
  assert.equal((await exposed()).length, 2);

  // Und der Jäger sieht weiterhin nie die Tabelle der Standorte der Agenten.
  const { data: hunterView } = await hunter.client.from('positions').select('user_id').eq('game_id', gameId);
  assert.deepEqual(hunterView.map((r) => r.user_id), [hunter.id]);
});

test('Echtzeit: Briefkasten erreicht den Jäger erst nach einer Minute, geleerte nie', async () => {
  const { host, hunter, runners, gameId } = await setupGame({ runners: 1 });
  const [a] = runners;
  await rpc(host, 'set_checkpoint_spots', { p_game: gameId, p_points: [offset(CENTER.lat, CENTER.lng, 150, 150)] });
  await rpc(host, 'start_game', { p_game: gameId });
  await move(a, gameId, CENTER);
  await move(hunter, gameId, offset(CENTER.lat, CENTER.lng, -200, 0));
  await fastForward(gameId, 301);
  await rpc(hunter, 'tick', { p_game: gameId });

  const seen = { hunter: [], runner: [], hunterClaims: 0, runnerClaims: 0 };
  const listen = (p, key, claimKey) =>
    p.client
      .channel(`cp-${key}-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkpoints', filter: `game_id=eq.${gameId}` }, (msg) =>
        seen[key].push(msg.eventType),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkpoint_claims', filter: `game_id=eq.${gameId}` }, () => {
        seen[claimKey] += 1;
      });
  const channels = [listen(hunter, 'hunter', 'hunterClaims'), listen(a, 'runner', 'runnerClaims')];
  await Promise.all(
    channels.map(
      (channel) =>
        new Promise((resolve, reject) => {
          channel.subscribe((status, err) => {
            if (status === 'SUBSCRIBED') resolve();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
          });
        }),
    ),
  );
  await new Promise((r) => setTimeout(r, 3000));

  await fastForward(gameId, 121);
  await rpc(a, 'tick', { p_game: gameId });
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(seen.runner.includes('INSERT'), 'Agent bekommt den neuen Briefkasten sofort');
  assert.deepEqual(seen.hunter, [], 'Jäger bekommt ihn noch nicht');

  await fastForward(gameId, 61);
  await rpc(hunter, 'tick', { p_game: gameId });
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(seen.hunter.includes('UPDATE'), 'Nach einer Minute kommt er beim Jäger an');

  const { data: [cp] } = await a.client.from('checkpoints').select('lat, lng').eq('game_id', gameId);
  await move(a, gameId, offset(cp.lat, cp.lng, 3, 3));
  await new Promise((r) => setTimeout(r, 2500));
  for (const c of channels) await c.unsubscribe();

  console.log('empfangen:', JSON.stringify(seen));
  assert.equal(seen.runnerClaims, 1, 'Agent erfährt, dass der Briefkasten leer ist');
  assert.equal(seen.hunterClaims, 0, 'Jäger erfährt es nie');
});

// ---------------------------------------------------------------------------
// Datenschutz: eigene Daten löschen, inaktive anonyme Nutzer entfernen
// ---------------------------------------------------------------------------

async function userExists(id) {
  const { rows } = await db.query('select count(*)::int as n from auth.users where id = $1', [id]);
  return rows[0].n === 1;
}

test('Meine Daten löschen: Host gibt ab, Runde läuft weiter, eigene Spuren sind weg', async () => {
  const { host, runners, gameId } = await setupGame({ runners: 3 });
  const [a, b, c] = runners;

  // Der Host löscht in der Lobby: A wird Host, der Einsatz bleibt.
  await rpc(host, 'delete_my_data', {});
  assert.equal(await userExists(host.id), false, 'Anonymes Konto ist gelöscht');
  const { data: g } = await a.client.from('games').select('host_id, status').eq('id', gameId).single();
  assert.deepEqual(g, { host_id: a.id, status: 'lobby' });
  const { data: left } = await a.client.from('players').select('user_id').eq('game_id', gameId);
  assert.deepEqual(new Set(left.map((p) => p.user_id)), new Set([a.id, b.id, c.id]));

  // Neue Runde mit A als Jäger.
  await rpc(a, 'set_role', { p_game: gameId, p_user: a.id, p_role: 'hunter' });
  await rpc(a, 'start_game', { p_game: gameId });
  await move(a, gameId, CENTER);
  await move(b, gameId, offset(CENTER.lat, CENTER.lng, 100, 100));
  await move(c, gameId, offset(CENTER.lat, CENTER.lng, -100, -100));
  await fastForward(gameId, 301);
  await rpc(a, 'tick', { p_game: gameId });
  const { rows: before } = await db.query('select count(*)::int as n from pings where target_id = $1', [b.id]);
  assert.ok(before[0].n >= 1);

  // B löscht mitten in der Runde: B ist raus, C spielt weiter.
  await rpc(b, 'delete_my_data', {});
  assert.equal(await userExists(b.id), false);
  for (const table of ['pings', 'positions', 'position_history', 'player_abilities', 'player_secrets']) {
    const column = table === 'pings' ? 'target_id' : 'user_id';
    const { rows } = await db.query(`select count(*)::int as n from ${table} where ${column} = $1`, [b.id]);
    assert.equal(rows[0].n, 0, `Keine Reste in ${table}`);
  }
  const { rows: ev } = await db.query('select count(*)::int as n from events where actor_id = $1 or target_id = $1', [b.id]);
  assert.equal(ev[0].n, 0, 'Keine Ereignisse mehr mit B');
  const { data: still } = await a.client.from('games').select('status').eq('id', gameId).single();
  assert.equal(still.status, 'hunt', 'Die Runde läuft für die anderen weiter');

  // Der letzte Agent löscht: Die Jäger gewinnen, der Einsatz bleibt für A sichtbar.
  await rpc(c, 'delete_my_data', {});
  const { data: ended } = await a.client.from('games').select('status, winner').eq('id', gameId).single();
  assert.deepEqual(ended, { status: 'ended', winner: 'hunters' });
});

test('Anonyme Nutzer werden nach 30 Tagen ohne Nutzung gelöscht', async () => {
  const idle = await player('Lange weg');
  const fresh = await player('Gerade da');
  const { host: busy } = await setupGame({ runners: 1 });
  for (const id of [idle.id, busy.id]) {
    await db.query(
      `update auth.users set created_at = now() - interval '40 days', last_sign_in_at = now() - interval '40 days',
         updated_at = now() - interval '40 days' where id = $1`,
      [id],
    );
    await db.query(
      `update auth.sessions set created_at = now() - interval '40 days', updated_at = now() - interval '40 days',
         refreshed_at = (now() - interval '35 days') at time zone 'utc' where user_id = $1`,
      [id],
    );
  }
  const { rows } = await db.query('select private.cleanup_inactive_users () as n');
  assert.ok(rows[0].n >= 1);
  assert.equal(await userExists(idle.id), false, 'Inaktiver Nutzer ist gelöscht');
  assert.equal(await userExists(fresh.id), true, 'Aktiver Nutzer bleibt');
  assert.equal(await userExists(busy.id), true, 'Wer in einem Einsatz ist, bleibt');
  const { rows: jobs } = await db.query(`select jobname from cron.job where jobname = 'signal-hunt-inactive-users'`);
  assert.equal(jobs.length, 1);
});
