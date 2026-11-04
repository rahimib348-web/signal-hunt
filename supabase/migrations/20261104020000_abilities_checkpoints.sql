-- Schritt 2: Fähigkeiten, tote Briefkästen und Strafen.
--
-- Weiterhin gilt: Der Jäger bekommt nie die echten Standorte der Agenten.
-- Was Agenten heimlich tun (Störsender scharf schalten, Fake-Ping), liegt in
-- Zeilen, die nur der Agent selbst lesen darf, oder im Schema "private",
-- das die App gar nicht erreicht. Ein Fake-Ping ist in der Tabelle pings
-- nicht von einem echten Ping zu unterscheiden.

-- ---------------------------------------------------------------------------
-- Einstellungen und neue Spalten
-- ---------------------------------------------------------------------------

alter table public.games
  add column abilities text[] not null default '{compass,fake_ping,jammer,radar}'
    check (abilities <@ array['jammer', 'fake_ping', 'radar', 'compass']),
  add column checkpoints_enabled boolean not null default true,
  -- Anzahl sicherer Orte (Fußwege aus OpenStreetMap), an denen tote Briefkästen erscheinen dürfen.
  add column checkpoint_spot_count int not null default 0,
  add column next_checkpoint_at timestamptz;

-- Ping-Arten: regelmäßig, Radar, Stillstand, Grenze (genauer Standort) und gestört (ohne Ort).
alter table public.pings
  alter column lat drop not null,
  alter column lng drop not null,
  add constraint pings_kind_check check (kind in ('regular', 'radar', 'idle', 'exposed', 'jammed')),
  add constraint pings_location_check check ((kind = 'jammed') = (lat is null or lng is null));

-- Wer ein Ereignis sehen darf: alle, nur Agenten, nur Jäger oder nur der Auslöser selbst.
alter table public.events
  add column audience text not null default 'all' check (audience in ('all', 'runners', 'hunters', 'self'));

-- Fremdschlüssel mit Index (Hinweis der Supabase-Prüfung).
create index games_host_idx on public.games (host_id);
create index players_user_idx on public.players (user_id);

-- ---------------------------------------------------------------------------
-- Neue Tabellen
-- ---------------------------------------------------------------------------

-- Fähigkeiten eines Spielers: Ladungen, Abklingzeit und ob sie scharf geschaltet ist.
create table public.player_abilities (
  game_id uuid not null,
  user_id uuid not null,
  ability text not null check (ability in ('jammer', 'fake_ping', 'radar', 'compass')),
  charges int not null default 0 check (charges >= 0),
  armed boolean not null default false,
  cooldown_until timestamptz,
  primary key (game_id, user_id, ability),
  foreign key (game_id, user_id) references public.players (game_id, user_id) on delete cascade
);

-- Tote Briefkästen. Agenten sehen sie sofort, Jäger erst nach einer Minute.
create table public.checkpoints (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  seq int not null,
  lat double precision not null,
  lng double precision not null,
  appears_at timestamptz not null default now(),
  hunters_see_at timestamptz not null,
  expires_at timestamptz not null,
  -- Wird gesetzt, sobald Jäger ihn sehen dürfen. Die Änderung schickt ihn per Echtzeit an die Jäger.
  revealed boolean not null default false
);
create index checkpoints_game_idx on public.checkpoints (game_id, appears_at);

-- Wer einen Briefkasten geleert hat. Jäger sehen das nicht: Sonst wüssten sie,
-- dass gerade ein Agent an diesem Ort war.
create table public.checkpoint_claims (
  checkpoint_id bigint primary key references public.checkpoints (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null,
  claimed_at timestamptz not null default now()
);
create index checkpoint_claims_game_idx on public.checkpoint_claims (game_id);

-- Sichere Orte für Briefkästen (vom Host aus OpenStreetMap geladen). Nur für den Server.
create table private.checkpoint_spots (
  game_id uuid not null references public.games (id) on delete cascade,
  idx int not null,
  lat double precision not null,
  lng double precision not null,
  primary key (game_id, idx)
);

-- Zustand für die Strafen: Ankerpunkt fürs Stillstehen und seit wann außerhalb. Nur für den Server.
create table private.runner_state (
  game_id uuid not null,
  user_id uuid not null,
  anchor_lat double precision,
  anchor_lng double precision,
  anchor_at timestamptz,
  outside_since timestamptz,
  last_exposed_at timestamptz,
  primary key (game_id, user_id),
  foreign key (game_id, user_id) references public.players (game_id, user_id) on delete cascade
);

revoke all on private.checkpoint_spots, private.runner_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Zugriffsregeln (RLS)
-- ---------------------------------------------------------------------------

alter table public.player_abilities enable row level security;
alter table public.checkpoints enable row level security;
alter table public.checkpoint_claims enable row level security;

revoke insert, update, delete, truncate on public.player_abilities, public.checkpoints, public.checkpoint_claims
  from anon, authenticated;
revoke all on public.player_abilities, public.checkpoints, public.checkpoint_claims from anon;

create policy "Nur die eigenen Fähigkeiten" on public.player_abilities
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Briefkästen nach Rolle" on public.checkpoints
  for select to authenticated using (
    private.my_role (game_id) is not null
    and (
      private.my_role (game_id) = 'runner'
      or hunters_see_at <= now()
      or private.my_status (game_id) = 'out'
      or private.game_status (game_id) = 'ended'
    )
  );

create policy "Geleerte Briefkästen sehen nur Agenten" on public.checkpoint_claims
  for select to authenticated using (
    private.my_role (game_id) is not null
    and (
      private.my_role (game_id) = 'runner'
      or private.my_status (game_id) = 'out'
      or private.game_status (game_id) = 'ended'
    )
  );

drop policy "Mitglieder sehen Ereignisse" on public.events;
create policy "Ereignisse nach Rolle" on public.events
  for select to authenticated using (
    private.my_role (game_id) is not null
    and (
      audience = 'all'
      or (audience = 'self' and actor_id = (select auth.uid()))
      or (audience = 'runners' and private.my_role (game_id) = 'runner')
      or (audience = 'hunters' and private.my_role (game_id) = 'hunter')
      or private.my_status (game_id) = 'out'
      or private.game_status (game_id) = 'ended'
    )
  );

-- Gleiche Regeln wie in Schritt 1, nur schneller: auth.uid() wird einmal pro
-- Abfrage ausgewertet statt für jede Zeile (Hinweis der Supabase-Prüfung).
drop policy "Nur die eigene Agenten-ID" on public.player_secrets;
create policy "Nur die eigene Agenten-ID" on public.player_secrets
  for select to authenticated using (user_id = (select auth.uid()));

drop policy "Standorte nach Rolle" on public.positions;
create policy "Standorte nach Rolle" on public.positions
  for select to authenticated using (
    user_id = (select auth.uid())
    or (
      private.my_role (game_id) is not null
      and (
        private.game_status (game_id) in ('lobby', 'ended')
        or private.my_status (game_id) = 'out'
        or (private.my_role (game_id) = 'hunter' and private.role_of (game_id, user_id) = 'hunter')
      )
    )
  );

drop policy "Verlauf nach dem Spiel" on public.position_history;
create policy "Verlauf nach dem Spiel" on public.position_history
  for select to authenticated using (
    user_id = (select auth.uid())
    or (private.my_role (game_id) is not null and private.game_status (game_id) = 'ended')
  );

drop policy "Pings nach Rolle" on public.pings;
create policy "Pings nach Rolle" on public.pings
  for select to authenticated using (
    target_id = (select auth.uid())
    or private.my_role (game_id) = 'hunter'
    or (
      private.my_role (game_id) is not null
      and (private.my_status (game_id) = 'out' or private.game_status (game_id) = 'ended')
    )
  );

-- ---------------------------------------------------------------------------
-- Interne Hilfsfunktionen
-- ---------------------------------------------------------------------------

create function private.dist_m (a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable set search_path = ''
as $$
  select extensions.st_distance (
    extensions.st_setsrid (extensions.st_makepoint (a_lng, a_lat), 4326)::extensions.geography,
    extensions.st_setsrid (extensions.st_makepoint (b_lng, b_lat), 4326)::extensions.geography)
$$;

create function private.ability_role (p_ability text)
returns text language sql immutable set search_path = ''
as $$
  select case when p_ability in ('jammer', 'fake_ping') then 'runner' else 'hunter' end
$$;

-- Abklingzeit nach dem Einsatz in Sekunden (siehe Spielkonzept).
create function private.ability_cooldown_sec (p_ability text)
returns int language sql immutable set search_path = ''
as $$
  select case p_ability when 'jammer' then 600 when 'fake_ping' then 600 when 'radar' then 480 when 'compass' then 480 end
$$;

-- Kreisgröße der aktuellen Phase (jede Phase ist ein Drittel der Jagd).
create function private.ping_radius (g public.games)
returns int language sql stable set search_path = ''
as $$
  select coalesce(
    g.ping_radii_m[least(2, greatest(0, floor(extract(epoch from now() - g.hunt_starts_at) / (g.duration_sec / 3.0))))::int + 1],
    g.ping_radii_m[array_length(g.ping_radii_m, 1)],
    75)
$$;

-- Gibt einem Spieler eine zufällige erlaubte Fähigkeit seiner Rolle.
create function private.grant_ability (p_game uuid, p_user uuid, p_role text, p_source text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_ability text;
begin
  select a into v_ability
    from unnest((select abilities from public.games where id = p_game)) as a
   where private.ability_role (a) = p_role
   order by random()
   limit 1;
  if v_ability is null then
    return null;
  end if;
  insert into public.player_abilities (game_id, user_id, ability, charges)
  values (p_game, p_user, v_ability, 1)
  on conflict (game_id, user_id, ability) do update set charges = public.player_abilities.charges + 1;
  insert into public.events (game_id, type, actor_id, audience, payload)
  values (p_game, 'ability_gained', p_user, 'self', jsonb_build_object('ability', v_ability, 'source', p_source));
  return v_ability;
end;
$$;

-- Ort für einen Fake-Ping: im Einsatzgebiet und mindestens 300 m vom echten
-- Standort entfernt. Ist das Gebiet dafür zu klein, der entfernteste von 40 Zufallspunkten.
create function private.fake_center (p_game uuid, p_lat double precision, p_lng double precision)
returns extensions.geography language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_area extensions.geometry;
  v_real extensions.geography := extensions.st_setsrid (extensions.st_makepoint (p_lng, p_lat), 4326)::extensions.geography;
  v_point extensions.geography;
begin
  select area_geog::extensions.geometry into v_area from public.games where id = p_game;
  if v_area is not null then
    select s.pt into v_point
      from (
        select d.geom::extensions.geography as pt
          from extensions.st_dump (extensions.st_generatepoints (v_area, 40)) as d
      ) s
     order by extensions.st_distance (s.pt, v_real) >= 300 desc,
              case when extensions.st_distance (s.pt, v_real) >= 300 then random()
                   else -extensions.st_distance (s.pt, v_real) end
     limit 1;
  end if;
  if v_point is null then
    v_point := extensions.st_project (v_real, 300 + random() * 200, random() * 2 * pi());
  end if;
  return v_point;
end;
$$;

-- Ein Ping für einen Agenten. Ein scharfer Störsender verschluckt ihn, ein
-- scharfer Fake-Ping verlegt ihn an einen falschen Ort. Pro Ping wird höchstens
-- eine Fähigkeit verbraucht, der Störsender zuerst. Die Grenz-Strafe ("exposed")
-- lässt sich weder stören noch fälschen.
create function private.emit_ping (p_game uuid, p_target uuid, p_radius int, p_seq int, p_kind text)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  pos public.positions;
  v_jammed boolean := false;
  v_fake boolean := false;
  v_center extensions.geography;
  v_id bigint;
begin
  select * into pos from public.positions where game_id = p_game and user_id = p_target;
  if not found then
    return null;
  end if;

  if p_kind <> 'exposed' then
    update public.player_abilities set armed = false
     where game_id = p_game and user_id = p_target and ability = 'jammer' and armed;
    v_jammed := found;
    if v_jammed then
      insert into public.pings (game_id, target_id, seq, kind, lat, lng, radius_m)
      values (p_game, p_target, p_seq, 'jammed', null, null, 0)
      returning id into v_id;
      return v_id;
    end if;
    update public.player_abilities set armed = false
     where game_id = p_game and user_id = p_target and ability = 'fake_ping' and armed;
    v_fake := found;
  end if;

  if v_fake then
    v_center := private.fake_center (p_game, pos.lat, pos.lng);
  elsif p_kind = 'exposed' then
    v_center := extensions.st_setsrid (extensions.st_makepoint (pos.lng, pos.lat), 4326)::extensions.geography;
  else
    -- Der Mittelpunkt wird zufällig verschoben, der Agent liegt aber immer im Kreis.
    v_center := extensions.st_project (
      extensions.st_setsrid (extensions.st_makepoint (pos.lng, pos.lat), 4326)::extensions.geography,
      p_radius * 0.85 * sqrt(random()),
      random() * 2 * pi());
  end if;

  insert into public.pings (game_id, target_id, seq, kind, lat, lng, radius_m)
  values (p_game, p_target, p_seq, p_kind,
          extensions.st_y (v_center::extensions.geometry), extensions.st_x (v_center::extensions.geometry), p_radius)
  returning id into v_id;

  if v_fake then
    insert into public.events (game_id, type, actor_id, audience, payload)
    values (p_game, 'fake_ping_sent', p_target, 'self', jsonb_build_object('ping_id', v_id, 'kind', p_kind));
  end if;
  return v_id;
end;
$$;

-- Ersetzt die Version aus Schritt 1: ein Ping pro freiem Agenten mit bekanntem Standort.
create or replace function private.emit_pings (p_game uuid, p_radius int, p_seq int, p_kind text)
returns int language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select user_id from public.players
     where game_id = p_game and role = 'runner' and status = 'active'
     order by joined_at
  loop
    if private.emit_ping (p_game, r.user_id, p_radius, p_seq, p_kind) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Strafen für einen Agenten während der Jagd:
-- * Stillstand: weniger als 20 m Bewegung in 3 Minuten → Extra-Ping für den Jäger.
-- * Grenze: 30 Sekunden außerhalb des Einsatzgebiets → der Jäger sieht den genauen
--   Standort, bis der Agent zurück ist (höchstens alle 15 Sekunden ein neuer).
create function private.check_runner (p_game uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  pos public.positions;
  st private.runner_state;
begin
  select * into g from public.games where id = p_game;
  if g.status <> 'hunt' then
    return;
  end if;
  select * into pos from public.positions where game_id = p_game and user_id = p_user;
  if not found then
    return;
  end if;
  select * into st from private.runner_state where game_id = p_game and user_id = p_user;
  if not found then
    return;
  end if;

  if st.outside_since is not null and now() - st.outside_since >= interval '30 seconds'
     and (
       st.last_exposed_at is null
       or st.last_exposed_at < st.outside_since
       or (now() - st.last_exposed_at >= interval '15 seconds' and pos.updated_at > st.last_exposed_at)
     ) then
    perform private.emit_ping (p_game, p_user, 10, g.ping_seq, 'exposed');
    update private.runner_state set last_exposed_at = now() where game_id = p_game and user_id = p_user;
  end if;

  if st.anchor_at is not null and now() - st.anchor_at >= interval '180 seconds' then
    perform private.emit_ping (p_game, p_user, private.ping_radius (g), g.ping_seq, 'idle');
    update private.runner_state set anchor_at = now() where game_id = p_game and user_id = p_user;
  end if;
end;
$$;

-- Neuer toter Briefkasten an einem der sicheren Orte: möglichst nicht neben dem
-- letzten Briefkasten und nicht neben einem Jäger.
create function private.spawn_checkpoint (p_game uuid)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_last public.checkpoints;
  v_spot record;
  v_seq int;
  v_id bigint;
begin
  select * into v_last from public.checkpoints where game_id = p_game order by id desc limit 1;
  select s.lat, s.lng into v_spot
    from private.checkpoint_spots s
   where s.game_id = p_game
   order by
     (v_last.id is null or private.dist_m (s.lat, s.lng, v_last.lat, v_last.lng) >= 150) desc,
     not exists (
       select 1
         from public.positions pos
         join public.players pl on pl.game_id = pos.game_id and pl.user_id = pos.user_id
        where pos.game_id = p_game and pl.role = 'hunter' and pl.status = 'active'
          and private.dist_m (s.lat, s.lng, pos.lat, pos.lng) < 100
     ) desc,
     random()
   limit 1;
  if not found then
    return null;
  end if;
  v_seq := coalesce(v_last.seq, 0) + 1;
  insert into public.checkpoints (game_id, seq, lat, lng, appears_at, hunters_see_at, expires_at)
  values (p_game, v_seq, v_spot.lat, v_spot.lng, now(), now() + interval '1 minute', now() + interval '5 minutes')
  returning id into v_id;
  insert into public.events (game_id, type, audience, payload)
  values (p_game, 'checkpoint', 'runners', jsonb_build_object('checkpoint_id', v_id, 'seq', v_seq));
  return v_id;
end;
$$;

-- Ein Agent ist bis auf 15 m an einen offenen Briefkasten herangekommen: Der
-- Erste bekommt eine zufällige Agenten-Fähigkeit.
create function private.try_claim_checkpoint (p_game uuid, p_user uuid, p_lat double precision, p_lng double precision)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_id bigint;
  v_ability text;
begin
  select cp.id into v_id
    from public.checkpoints cp
   where cp.game_id = p_game and cp.appears_at <= now() and cp.expires_at > now()
     and not exists (select 1 from public.checkpoint_claims cc where cc.checkpoint_id = cp.id)
     and private.dist_m (cp.lat, cp.lng, p_lat, p_lng) <= 15
   order by cp.id desc
   limit 1;
  if v_id is null then
    return null;
  end if;
  insert into public.checkpoint_claims (checkpoint_id, game_id, user_id)
  values (v_id, p_game, p_user)
  on conflict do nothing;
  if not found then
    return null;
  end if;
  v_ability := private.grant_ability (p_game, p_user, 'runner', 'checkpoint');
  insert into public.events (game_id, type, actor_id, audience, payload)
  values (p_game, 'checkpoint_claimed', p_user, 'runners', jsonb_build_object('checkpoint_id', v_id));
  return coalesce(v_ability, 'none');
end;
$$;

-- Ersetzt die Version aus Schritt 1: zusätzlich tote Briefkästen und Strafen.
create or replace function private.advance (p_game uuid)
returns public.games language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  v_phase int;
  v_interval int;
  v_radius int;
  v_count int;
  r record;
begin
  select * into g from public.games where id = p_game for update;
  if not found then
    raise exception 'game_not_found';
  end if;

  if g.status = 'headstart' and now() >= g.hunt_starts_at then
    update public.games
       set status = 'hunt',
           -- Erster Briefkasten 2 Minuten nach Beginn der Jagd, danach alle 7 Minuten.
           next_checkpoint_at = case
             when checkpoints_enabled and checkpoint_spot_count > 0 and abilities && array['jammer', 'fake_ping']
             then now() + interval '2 minutes' end
     where id = p_game
     returning * into g;
    -- Die Stillstand-Uhr beginnt erst mit der Jagd.
    update private.runner_state set anchor_at = now() where game_id = p_game and anchor_at is not null;
    insert into public.events (game_id, type) values (p_game, 'hunt_started');
  end if;

  if g.status = 'hunt' then
    if now() >= g.ends_at then
      perform private.finish (p_game, 'runners', 'time_up');
      select * into g from public.games where id = p_game;
      return g;
    end if;

    if g.next_ping_at is not null and now() >= g.next_ping_at then
      v_phase := least(2, greatest(0, floor(
        extract(epoch from now() - g.hunt_starts_at) / (g.duration_sec / 3.0))))::int;
      v_interval := coalesce(g.ping_intervals_sec[v_phase + 1], g.ping_intervals_sec[array_length(g.ping_intervals_sec, 1)], 180);
      v_radius := private.ping_radius (g);
      v_count := private.emit_pings (p_game, v_radius, g.ping_seq + 1, 'regular');
      update public.games
         set ping_seq = g.ping_seq + 1,
             next_ping_at = now() + make_interval(secs => v_interval)
       where id = p_game
       returning * into g;
      insert into public.events (game_id, type, payload)
      values (p_game, 'ping', jsonb_build_object('seq', g.ping_seq, 'radius_m', v_radius, 'targets', v_count, 'phase', v_phase + 1));
    end if;

    if g.next_checkpoint_at is not null and now() >= g.next_checkpoint_at then
      perform private.spawn_checkpoint (p_game);
      update public.games set next_checkpoint_at = now() + interval '7 minutes' where id = p_game returning * into g;
    end if;
    update public.checkpoints set revealed = true
     where game_id = p_game and not revealed and hunters_see_at <= now();

    -- Strafen prüfen, auch wenn das Handy eines Agenten gerade nichts sendet.
    for r in select user_id from public.players where game_id = p_game and role = 'runner' and status = 'active' loop
      perform private.check_runner (p_game, r.user_id);
    end loop;
  end if;

  return g;
end;
$$;

-- ---------------------------------------------------------------------------
-- Geänderte RPCs aus Schritt 1
-- ---------------------------------------------------------------------------

-- Neues Gebiet: Die alten sicheren Orte gelten nicht mehr.
create or replace function public.set_area (p_game uuid, p_points jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_n int;
  v_geom extensions.geometry;
  v_area double precision;
begin
  perform private.require_host (p_game);
  if jsonb_typeof(p_points) <> 'array' then
    raise exception 'invalid_area';
  end if;
  v_n := jsonb_array_length(p_points);
  if v_n < 3 or v_n > 30 then
    raise exception 'invalid_area';
  end if;

  with pts as (
    select ord, extensions.st_setsrid (extensions.st_makepoint ((e ->> 'lng')::float8, (e ->> 'lat')::float8), 4326) as g
      from jsonb_array_elements(p_points) with ordinality as t (e, ord)
  )
  select extensions.st_makepolygon (
           extensions.st_addpoint (extensions.st_makeline (array_agg(g order by ord)), (select g from pts where ord = 1)))
    into v_geom
    from pts;

  if not extensions.st_isvalid (v_geom) then
    raise exception 'area_self_intersects';
  end if;
  v_area := extensions.st_area (v_geom::extensions.geography);
  if v_area < 10000 then
    raise exception 'area_too_small';
  end if;
  if v_area > 25000000 then
    raise exception 'area_too_large';
  end if;

  delete from private.checkpoint_spots where game_id = p_game;
  update public.games
     set area = p_points, area_geog = v_geom::extensions.geography, checkpoint_spot_count = 0
   where id = p_game;
  return jsonb_build_object('area_m2', round(v_area));
end;
$$;

-- Start: zusätzlich bekommt jeder Spieler eine zufällige Fähigkeit seiner Rolle.
create or replace function public.start_game (p_game uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  v_user uuid := auth.uid();
begin
  g := private.require_host (p_game);
  if g.area_geog is null then
    raise exception 'no_area';
  end if;
  if (select count(*) from public.players where game_id = p_game) < 2 then
    raise exception 'not_enough_players';
  end if;
  -- Kein Jäger gewählt: einen zufällig bestimmen.
  if not exists (select 1 from public.players where game_id = p_game and role = 'hunter') then
    update public.players set role = 'hunter'
     where game_id = p_game
       and user_id = (select user_id from public.players where game_id = p_game order by random() limit 1);
  end if;
  if not exists (select 1 from public.players where game_id = p_game and role = 'runner') then
    raise exception 'no_runners';
  end if;

  update public.players set status = 'active', caught_at = null, caught_by = null where game_id = p_game;
  delete from public.player_secrets where game_id = p_game;
  insert into public.player_secrets (game_id, user_id, catch_token)
  select game_id, user_id, 'SH1-' || replace(gen_random_uuid()::text, '-', '')
    from public.players where game_id = p_game;

  delete from public.player_abilities where game_id = p_game;
  delete from public.checkpoints where game_id = p_game;
  delete from private.runner_state where game_id = p_game;
  insert into private.runner_state (game_id, user_id)
  select game_id, user_id from public.players where game_id = p_game and role = 'runner';
  perform private.grant_ability (p_game, pl.user_id, pl.role, 'start')
     from public.players pl
    where pl.game_id = p_game;

  update public.games
     set status = 'headstart',
         started_at = now(),
         hunt_starts_at = now() + make_interval(secs => headstart_sec),
         ends_at = now() + make_interval(secs => headstart_sec + duration_sec),
         next_ping_at = now() + make_interval(secs => headstart_sec),
         next_checkpoint_at = null,
         ping_seq = 0,
         winner = null,
         end_reason = null,
         ended_at = null
   where id = p_game;
  insert into public.events (game_id, type, actor_id) values (p_game, 'started', v_user);
end;
$$;

-- Takt: zusätzlich die Warnungen für den eigenen Agenten (Stillstand, Grenze).
create or replace function public.tick (p_game uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  st private.runner_state;
begin
  perform private.require_user ();
  if private.my_role (p_game) is null then
    raise exception 'not_member';
  end if;
  g := private.advance (p_game);
  select * into st from private.runner_state rs
   where rs.game_id = p_game and rs.user_id = auth.uid()
     and exists (select 1 from public.players pl
                  where pl.game_id = p_game and pl.user_id = auth.uid() and pl.role = 'runner' and pl.status = 'active');
  return jsonb_build_object(
    'status', g.status,
    'server_now', now(),
    'hunt_starts_at', g.hunt_starts_at,
    'ends_at', g.ends_at,
    'next_ping_at', g.next_ping_at,
    'ping_seq', g.ping_seq,
    'idle_sec', case when g.status = 'hunt' and st.anchor_at is not null
                     then floor(extract(epoch from now() - st.anchor_at))::int end,
    'outside_sec', case when g.status in ('headstart', 'hunt') and st.outside_since is not null
                        then floor(extract(epoch from now() - st.outside_since))::int end
  );
end;
$$;

-- Standort: zusätzlich Stillstand, Grenze und tote Briefkästen.
create or replace function public.update_position (p_game uuid, p_lat double precision, p_lng double precision, p_accuracy real default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  g public.games;
  v_inside boolean;
  v_runner boolean;
  v_claimed text;
  st private.runner_state;
begin
  if private.my_role (p_game) is null then
    raise exception 'not_member';
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_position';
  end if;

  g := private.advance (p_game);
  if g.status = 'ended' then
    return jsonb_build_object('status', g.status, 'inside', null);
  end if;

  insert into public.positions (game_id, user_id, lat, lng, accuracy_m, updated_at)
  values (p_game, v_user, p_lat, p_lng, p_accuracy, now())
  on conflict (game_id, user_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, updated_at = excluded.updated_at;

  if g.status in ('headstart', 'hunt') and not exists (
    select 1 from public.position_history
     where game_id = p_game and user_id = v_user and recorded_at > now() - interval '10 seconds'
  ) then
    insert into public.position_history (game_id, user_id, lat, lng) values (p_game, v_user, p_lat, p_lng);
  end if;

  if g.area_geog is not null then
    v_inside := extensions.st_covers (
      g.area_geog,
      extensions.st_setsrid (extensions.st_makepoint (p_lng, p_lat), 4326)::extensions.geography);
  end if;

  v_runner := exists (
    select 1 from public.players
     where game_id = p_game and user_id = v_user and role = 'runner' and status = 'active');
  if v_runner and g.status in ('headstart', 'hunt') then
    insert into private.runner_state (game_id, user_id) values (p_game, v_user) on conflict do nothing;
    -- Neuer Ankerpunkt, sobald sich der Agent mehr als 20 m bewegt hat.
    update private.runner_state
       set anchor_lat = p_lat, anchor_lng = p_lng, anchor_at = now()
     where game_id = p_game and user_id = v_user
       and (anchor_lat is null or private.dist_m (anchor_lat, anchor_lng, p_lat, p_lng) > 20);
    update private.runner_state
       set outside_since = case when coalesce(v_inside, true) then null else coalesce(outside_since, now()) end
     where game_id = p_game and user_id = v_user;
    perform private.check_runner (p_game, v_user);
    if g.status = 'hunt' then
      v_claimed := private.try_claim_checkpoint (p_game, v_user, p_lat, p_lng);
    end if;
    select * into st from private.runner_state where game_id = p_game and user_id = v_user;
  end if;

  return jsonb_build_object(
    'status', g.status,
    'inside', v_inside,
    'idle_sec', case when g.status = 'hunt' and st.anchor_at is not null
                     then floor(extract(epoch from now() - st.anchor_at))::int end,
    'outside_sec', case when st.outside_since is not null
                        then floor(extract(epoch from now() - st.outside_since))::int end,
    'claimed', v_claimed
  );
end;
$$;

-- Fangen: zusätzlich bekommt der Jäger nach jedem Fang eine Fähigkeit. Im
-- Doppelagent-Modus verliert der Gefangene seine Agenten-Fähigkeiten und
-- bekommt eine Jäger-Fähigkeit.
create or replace function public.catch_runner (p_game uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  g public.games;
  v_target uuid;
  v_target_name text;
  v_dist double precision;
begin
  g := private.advance (p_game);
  if g.status <> 'hunt' then
    raise exception 'not_hunting';
  end if;
  if not exists (
    select 1 from public.players where game_id = p_game and user_id = v_user and role = 'hunter' and status = 'active'
  ) then
    raise exception 'not_a_hunter';
  end if;

  select s.user_id into v_target
    from public.player_secrets s
    join public.players pl on pl.game_id = s.game_id and pl.user_id = s.user_id
   where s.game_id = p_game and s.catch_token = btrim(p_token)
     and pl.role = 'runner' and pl.status = 'active';
  if v_target is null then
    raise exception 'invalid_code';
  end if;

  -- Schutz gegen Fernfänge: Sind beide Standorte frisch, dürfen sie höchstens 100 m auseinander liegen.
  select extensions.st_distance (
           extensions.st_setsrid (extensions.st_makepoint (a.lng, a.lat), 4326)::extensions.geography,
           extensions.st_setsrid (extensions.st_makepoint (b.lng, b.lat), 4326)::extensions.geography)
    into v_dist
    from public.positions a, public.positions b
   where a.game_id = p_game and a.user_id = v_user and a.updated_at > now() - interval '60 seconds'
     and b.game_id = p_game and b.user_id = v_target and b.updated_at > now() - interval '60 seconds';
  if v_dist is not null and v_dist > 100 then
    raise exception 'too_far';
  end if;

  if g.mode = 'infection' then
    update public.players set role = 'hunter', caught_at = now(), caught_by = v_user
     where game_id = p_game and user_id = v_target
     returning name into v_target_name;
  else
    update public.players set status = 'out', caught_at = now(), caught_by = v_user
     where game_id = p_game and user_id = v_target
     returning name into v_target_name;
  end if;
  delete from public.player_secrets where game_id = p_game and user_id = v_target;
  delete from public.player_abilities where game_id = p_game and user_id = v_target;
  delete from private.runner_state where game_id = p_game and user_id = v_target;

  insert into public.events (game_id, type, actor_id, target_id, payload)
  values (p_game, 'caught', v_user, v_target, jsonb_build_object('mode', g.mode));

  if not exists (select 1 from public.players where game_id = p_game and role = 'runner' and status = 'active') then
    perform private.finish (p_game, 'hunters', 'all_caught', v_user);
  else
    perform private.grant_ability (p_game, v_user, 'hunter', 'catch');
    if g.mode = 'infection' then
      perform private.grant_ability (p_game, v_target, 'hunter', 'converted');
    end if;
  end if;

  return jsonb_build_object('target_id', v_target, 'name', v_target_name, 'mode', g.mode);
end;
$$;

-- Neue Runde: zusätzlich Fähigkeiten, Briefkästen und Strafen zurücksetzen.
create or replace function public.reset_game (p_game uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_host (p_game, 'ended');
  update public.players
     set role = 'runner', status = 'active', caught_at = null, caught_by = null
   where game_id = p_game;
  delete from public.pings where game_id = p_game;
  delete from public.positions where game_id = p_game;
  delete from public.position_history where game_id = p_game;
  delete from public.player_secrets where game_id = p_game;
  delete from public.player_abilities where game_id = p_game;
  delete from public.checkpoints where game_id = p_game;
  delete from private.runner_state where game_id = p_game;
  delete from public.events where game_id = p_game;
  update public.games
     set status = 'lobby', started_at = null, hunt_starts_at = null, ends_at = null, ended_at = null,
         winner = null, end_reason = null, next_ping_at = null, next_checkpoint_at = null, ping_seq = 0
   where id = p_game;
  insert into public.events (game_id, type, actor_id) values (p_game, 'reset', auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- Neue RPCs
-- ---------------------------------------------------------------------------

-- Host legt fest, welche Fähigkeiten erlaubt sind und ob es tote Briefkästen gibt.
create function public.update_extras (p_game uuid, p_abilities text[], p_checkpoints boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_host (p_game);
  if p_abilities is null or not (p_abilities <@ array['jammer', 'fake_ping', 'radar', 'compass']) then
    raise exception 'invalid_ability';
  end if;
  update public.games
     set abilities = (select coalesce(array_agg(distinct a order by a), '{}') from unnest(p_abilities) as a),
         checkpoints_enabled = coalesce(p_checkpoints, checkpoints_enabled)
   where id = p_game;
end;
$$;

-- Host schickt sichere Orte für Briefkästen (Punkte auf Fußwegen aus OpenStreetMap).
-- Punkte außerhalb des Einsatzgebiets werden verworfen.
create function public.set_checkpoint_spots (p_game uuid, p_points jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  v_n int;
begin
  g := private.require_host (p_game);
  if g.area_geog is null then
    raise exception 'no_area';
  end if;
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 300 then
    raise exception 'invalid_spots';
  end if;
  delete from private.checkpoint_spots where game_id = p_game;
  insert into private.checkpoint_spots (game_id, idx, lat, lng)
  select p_game, t.ord::int, (t.e ->> 'lat')::float8, (t.e ->> 'lng')::float8
    from jsonb_array_elements(p_points) with ordinality as t (e, ord)
   where jsonb_typeof(t.e -> 'lat') = 'number' and jsonb_typeof(t.e -> 'lng') = 'number'
     and extensions.st_covers (
           g.area_geog,
           extensions.st_setsrid (extensions.st_makepoint ((t.e ->> 'lng')::float8, (t.e ->> 'lat')::float8), 4326)::extensions.geography);
  get diagnostics v_n = row_count;
  update public.games set checkpoint_spot_count = v_n where id = p_game;
  return jsonb_build_object('spots', v_n);
end;
$$;

-- Eine Fähigkeit einsetzen.
-- * Störsender / Fake-Ping (Agent): wird scharf geschaltet und wirkt beim nächsten Ping.
--   Geht auch schon im Vorsprung. Nur der Agent selbst erfährt davon.
-- * Radar (Jäger): sofort ein Ping von allen Agenten. Die Agenten werden gewarnt.
-- * Kompass (Jäger): Richtung zum nächsten Agenten, ohne Entfernung. Die App zeigt sie 10 Sekunden.
create function public.use_ability (p_game uuid, p_ability text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  g public.games;
  me public.players;
  ab public.player_abilities;
  v_from public.positions;
  v_target record;
  v_bearing double precision;
  v_count int;
begin
  if p_ability is null or p_ability not in ('jammer', 'fake_ping', 'radar', 'compass') then
    raise exception 'invalid_ability';
  end if;
  g := private.advance (p_game);
  select * into me from public.players where game_id = p_game and user_id = v_user;
  if not found then
    raise exception 'not_member';
  end if;
  if not (g.status = 'hunt' or (g.status = 'headstart' and private.ability_role (p_ability) = 'runner')) then
    raise exception 'not_hunting';
  end if;
  if me.status <> 'active' or me.role <> private.ability_role (p_ability) then
    raise exception 'wrong_role';
  end if;
  if not (p_ability = any (g.abilities)) then
    raise exception 'ability_disabled';
  end if;

  select * into ab from public.player_abilities
   where game_id = p_game and user_id = v_user and ability = p_ability
   for update;
  if not found or ab.charges < 1 then
    raise exception 'no_charges';
  end if;
  if ab.cooldown_until is not null and ab.cooldown_until > now() then
    raise exception 'cooldown';
  end if;
  if ab.armed then
    raise exception 'already_armed';
  end if;

  if p_ability = 'compass' then
    select * into v_from from public.positions
     where game_id = p_game and user_id = v_user and updated_at > now() - interval '60 seconds';
    if not found then
      raise exception 'no_position';
    end if;
    select pos.lat, pos.lng into v_target
      from public.positions pos
      join public.players pl on pl.game_id = pos.game_id and pl.user_id = pos.user_id
     where pos.game_id = p_game and pl.role = 'runner' and pl.status = 'active'
     order by private.dist_m (v_from.lat, v_from.lng, pos.lat, pos.lng)
     limit 1;
    if not found then
      raise exception 'no_target';
    end if;
    v_bearing := degrees (extensions.st_azimuth (
      extensions.st_setsrid (extensions.st_makepoint (v_from.lng, v_from.lat), 4326)::extensions.geography,
      extensions.st_setsrid (extensions.st_makepoint (v_target.lng, v_target.lat), 4326)::extensions.geography));
  end if;

  update public.player_abilities
     set charges = charges - 1,
         cooldown_until = now() + make_interval(secs => private.ability_cooldown_sec (p_ability)),
         armed = p_ability in ('jammer', 'fake_ping')
   where game_id = p_game and user_id = v_user and ability = p_ability;

  if p_ability = 'radar' then
    v_count := private.emit_pings (p_game, private.ping_radius (g), g.ping_seq, 'radar');
    insert into public.events (game_id, type, actor_id, payload)
    values (p_game, 'ability_used', v_user, jsonb_build_object('ability', p_ability, 'targets', v_count));
    return jsonb_build_object('ability', p_ability, 'targets', v_count);
  elsif p_ability = 'compass' then
    insert into public.events (game_id, type, actor_id, payload)
    values (p_game, 'ability_used', v_user, jsonb_build_object('ability', p_ability));
    return jsonb_build_object('ability', p_ability, 'bearing_deg', round(v_bearing::numeric, 1), 'until', now() + interval '10 seconds');
  end if;

  insert into public.events (game_id, type, actor_id, audience, payload)
  values (p_game, 'ability_used', v_user, 'self', jsonb_build_object('ability', p_ability));
  return jsonb_build_object('ability', p_ability, 'armed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

revoke execute on function
  public.update_extras (uuid, text[], boolean),
  public.set_checkpoint_spots (uuid, jsonb),
  public.use_ability (uuid, text)
from public, anon;
grant execute on function
  public.update_extras (uuid, text[], boolean),
  public.set_checkpoint_spots (uuid, jsonb),
  public.use_ability (uuid, text)
to authenticated;

-- Interne Funktionen ruft niemand von außen auf. Nur die Helfer der Zugriffsregeln
-- braucht die Rolle "authenticated".
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_role (uuid), private.my_status (uuid),
  private.role_of (uuid, uuid), private.game_status (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Echtzeit
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.player_abilities, public.checkpoints, public.checkpoint_claims;
