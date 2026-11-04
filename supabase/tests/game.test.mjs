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

// Verschiebt alle Zeitpunkte eines Spiels in die Vergangenheit ("Zeitreise").
async function fastForward(gameId, seconds) {
  await db.query(
    `update games set
       started_at = started_at - make_interval(secs => $2),
       hunt_starts_at = hunt_starts_at - make_interval(secs => $2),
       ends_at = ends_at - make_interval(secs => $2),
       next_ping_at = next_ping_at - make_interval(secs => $2)
     where id = $1`,
    [gameId, seconds],
  );
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
  const { data: pings } = await hunter.client.from('pings').select('seq, radius_m').eq('game_id', gameId).order('seq');
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
