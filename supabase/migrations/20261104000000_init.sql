-- Signal Hunt: Grundgerüst des Backends
--
-- Wichtigste Regel: Der Jäger bekommt nie die echten Standorte der Agenten.
-- Alle Spielregeln laufen hier auf dem Server. Die App liest nur, was die
-- Zugriffsregeln (RLS) erlauben, und schreibt ausschließlich über die
-- Funktionen (RPCs) weiter unten.

create extension if not exists postgis with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby'
    check (status in ('lobby', 'headstart', 'hunt', 'ended')),
  mode text not null default 'infection'
    check (mode in ('infection', 'elimination')),
  headstart_sec int not null default 300 check (headstart_sec between 0 and 1800),
  duration_sec int not null default 2700 check (duration_sec between 300 and 10800),
  -- Ein Wert pro Drittel der Jagd: am Anfang selten und grob, am Ende oft und genau.
  ping_intervals_sec int[] not null default '{300,240,180}',
  ping_radii_m int[] not null default '{250,150,75}',
  area jsonb,
  area_geog extensions.geography (polygon, 4326),
  started_at timestamptz,
  hunt_starts_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  winner text check (winner in ('hunters', 'runners')),
  end_reason text,
  next_ping_at timestamptz,
  ping_seq int not null default 0,
  created_at timestamptz not null default now()
);

create table public.players (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  role text not null default 'runner' check (role in ('runner', 'hunter')),
  status text not null default 'active' check (status in ('active', 'out')),
  joined_at timestamptz not null default now(),
  caught_at timestamptz,
  caught_by uuid,
  primary key (game_id, user_id)
);

-- Die Agenten-ID (Inhalt des QR-Codes). Nur der Spieler selbst darf sie lesen.
create table public.player_secrets (
  game_id uuid not null,
  user_id uuid not null,
  catch_token text not null unique,
  primary key (game_id, user_id),
  foreign key (game_id, user_id) references public.players (game_id, user_id) on delete cascade
);

-- Letzter bekannter Standort pro Spieler.
create table public.positions (
  game_id uuid not null,
  user_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m real,
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id),
  foreign key (game_id, user_id) references public.players (game_id, user_id) on delete cascade
);

-- Verlauf für die Auswertung nach der Runde.
create table public.position_history (
  id bigint generated always as identity primary key,
  game_id uuid not null,
  user_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now(),
  foreign key (game_id, user_id) references public.players (game_id, user_id) on delete cascade
);
create index position_history_game_user_idx on public.position_history (game_id, user_id, recorded_at);

-- Ein Ping = ein Kreis, in dem sich der Agent befindet (nicht in der Mitte).
create table public.pings (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  target_id uuid not null,
  seq int not null,
  kind text not null default 'regular',
  lat double precision not null,
  lng double precision not null,
  radius_m int not null,
  created_at timestamptz not null default now()
);
create index pings_game_idx on public.pings (game_id, created_at);

-- Spielereignisse für Meldungen in der App ("Agent X wurde gefangen").
create table public.events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  type text not null,
  actor_id uuid,
  target_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_game_idx on public.events (game_id, created_at);

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen für die Zugriffsregeln
-- ---------------------------------------------------------------------------

create function private.my_role (p_game uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select role from public.players where game_id = p_game and user_id = auth.uid()
$$;

create function private.my_status (p_game uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select status from public.players where game_id = p_game and user_id = auth.uid()
$$;

create function private.role_of (p_game uuid, p_user uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select role from public.players where game_id = p_game and user_id = p_user
$$;

create function private.game_status (p_game uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select status from public.games where id = p_game
$$;

grant usage on schema private to authenticated;
grant execute on function private.my_role (uuid), private.my_status (uuid),
  private.role_of (uuid, uuid), private.game_status (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Zugriffsregeln (RLS). Schreiben direkt in Tabellen ist für die App verboten.
-- ---------------------------------------------------------------------------

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.player_secrets enable row level security;
alter table public.positions enable row level security;
alter table public.position_history enable row level security;
alter table public.pings enable row level security;
alter table public.events enable row level security;

revoke insert, update, delete, truncate on public.games, public.players, public.player_secrets,
  public.positions, public.position_history, public.pings, public.events from anon, authenticated;
revoke all on public.games, public.players, public.player_secrets, public.positions,
  public.position_history, public.pings, public.events from anon;

create policy "Mitglieder sehen ihr Spiel" on public.games
  for select to authenticated using (private.my_role (id) is not null);

create policy "Mitglieder sehen die Mitspieler" on public.players
  for select to authenticated using (private.my_role (game_id) is not null);

create policy "Nur die eigene Agenten-ID" on public.player_secrets
  for select to authenticated using (user_id = auth.uid());

-- Standorte: der eigene immer. In der Lobby und nach dem Spiel alle.
-- Ausgeschiedene (Zuschauer) sehen alle. Jäger sehen nur andere Jäger,
-- niemals Agenten.
create policy "Standorte nach Rolle" on public.positions
  for select to authenticated using (
    user_id = auth.uid()
    or (
      private.my_role (game_id) is not null
      and (
        private.game_status (game_id) in ('lobby', 'ended')
        or private.my_status (game_id) = 'out'
        or (private.my_role (game_id) = 'hunter' and private.role_of (game_id, user_id) = 'hunter')
      )
    )
  );

create policy "Verlauf nach dem Spiel" on public.position_history
  for select to authenticated using (
    user_id = auth.uid()
    or (private.my_role (game_id) is not null and private.game_status (game_id) = 'ended')
  );

-- Pings sehen: Jäger, der betroffene Agent selbst, Zuschauer, nach dem Spiel alle.
create policy "Pings nach Rolle" on public.pings
  for select to authenticated using (
    target_id = auth.uid()
    or private.my_role (game_id) = 'hunter'
    or (
      private.my_role (game_id) is not null
      and (private.my_status (game_id) = 'out' or private.game_status (game_id) = 'ended')
    )
  );

create policy "Mitglieder sehen Ereignisse" on public.events
  for select to authenticated using (private.my_role (game_id) is not null);

-- ---------------------------------------------------------------------------
-- Interne Spiellogik (nicht von der App aufrufbar)
-- ---------------------------------------------------------------------------

create function private.require_user ()
returns uuid language plpgsql stable set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  return auth.uid();
end;
$$;

create function private.require_host (p_game uuid, p_status text default 'lobby')
returns public.games language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if g.host_id is distinct from auth.uid() then
    raise exception 'not_host';
  end if;
  if p_status is not null and g.status <> p_status then
    raise exception 'wrong_status';
  end if;
  return g;
end;
$$;

create function private.finish (p_game uuid, p_winner text, p_reason text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.games
     set status = 'ended', ended_at = now(), winner = p_winner, end_reason = p_reason, next_ping_at = null
   where id = p_game and status <> 'ended';
  if found then
    insert into public.events (game_id, type, actor_id, payload)
    values (p_game, 'ended', p_actor, jsonb_build_object('winner', p_winner, 'reason', p_reason));
    delete from public.player_secrets where game_id = p_game;
  end if;
end;
$$;

-- Erzeugt einen Ping für jeden freien Agenten mit bekanntem Standort.
-- Der Kreismittelpunkt wird zufällig verschoben, damit der Agent nie genau
-- in der Mitte steht, aber immer innerhalb des Kreises liegt.
create function private.emit_pings (p_game uuid, p_radius int, p_seq int, p_kind text)
returns int language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  insert into public.pings (game_id, target_id, seq, kind, lat, lng, radius_m)
  select p_game, pos.user_id, p_seq, p_kind,
         extensions.st_y (c.center::extensions.geometry),
         extensions.st_x (c.center::extensions.geometry),
         p_radius
    from public.players pl
    join public.positions pos on pos.game_id = pl.game_id and pos.user_id = pl.user_id
    cross join lateral (
      select extensions.st_project (
               extensions.st_setsrid (extensions.st_makepoint (pos.lng, pos.lat), 4326)::extensions.geography,
               p_radius * 0.85 * sqrt(random()),
               random() * 2 * pi()
             ) as center
    ) c
   where pl.game_id = p_game and pl.role = 'runner' and pl.status = 'active';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Bringt den Spielzustand auf den aktuellen Stand: Vorsprung vorbei? Ping fällig?
-- Zeit abgelaufen? Wird bei jedem Standort-Update und von tick() aufgerufen.
create function private.advance (p_game uuid)
returns public.games language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
  v_phase int;
  v_interval int;
  v_radius int;
  v_count int;
begin
  select * into g from public.games where id = p_game for update;
  if not found then
    raise exception 'game_not_found';
  end if;

  if g.status = 'headstart' and now() >= g.hunt_starts_at then
    update public.games set status = 'hunt' where id = p_game returning * into g;
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
      v_radius := coalesce(g.ping_radii_m[v_phase + 1], g.ping_radii_m[array_length(g.ping_radii_m, 1)], 75);
      v_count := private.emit_pings (p_game, v_radius, g.ping_seq + 1, 'regular');
      update public.games
         set ping_seq = g.ping_seq + 1,
             next_ping_at = now() + make_interval(secs => v_interval)
       where id = p_game
       returning * into g;
      insert into public.events (game_id, type, payload)
      values (p_game, 'ping', jsonb_build_object('seq', g.ping_seq, 'radius_m', v_radius, 'targets', v_count, 'phase', v_phase + 1));
    end if;
  end if;

  return g;
end;
$$;

create function private.random_code ()
returns text language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v text := '';
begin
  for i in 1..6 loop
    v := v || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return v;
end;
$$;

create function private.clean_name (p_name text)
returns text language plpgsql immutable set search_path = ''
as $$
declare
  v text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) < 1 or char_length(v) > 24 then
    raise exception 'invalid_name';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Öffentliche Funktionen (RPCs) für die App
-- ---------------------------------------------------------------------------

create function public.create_game (p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  v_game uuid;
  v_code text;
begin
  loop
    v_code := private.random_code ();
    exit when not exists (select 1 from public.games where code = v_code);
  end loop;
  insert into public.games (code, host_id) values (v_code, v_user) returning id into v_game;
  insert into public.players (game_id, user_id, name) values (v_game, v_user, private.clean_name (p_name));
  insert into public.events (game_id, type, actor_id) values (v_game, 'created', v_user);
  return v_game;
end;
$$;

create function public.join_game (p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  g public.games;
begin
  select * into g from public.games where code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if exists (select 1 from public.players where game_id = g.id and user_id = v_user) then
    update public.players set name = private.clean_name (p_name) where game_id = g.id and user_id = v_user;
    return g.id;
  end if;
  if g.status <> 'lobby' then
    raise exception 'game_already_started';
  end if;
  if (select count(*) from public.players where game_id = g.id) >= 20 then
    raise exception 'game_full';
  end if;
  insert into public.players (game_id, user_id, name) values (g.id, v_user, private.clean_name (p_name));
  insert into public.events (game_id, type, actor_id) values (g.id, 'joined', v_user);
  return g.id;
end;
$$;

create function public.leave_game (p_game uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  g public.games;
  v_next uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found or not exists (select 1 from public.players where game_id = p_game and user_id = v_user) then
    return;
  end if;

  if g.status = 'lobby' then
    delete from public.players where game_id = p_game and user_id = v_user;
    if g.host_id = v_user then
      select user_id into v_next from public.players where game_id = p_game order by joined_at limit 1;
      if v_next is null then
        delete from public.games where id = p_game;
        return;
      end if;
      update public.games set host_id = v_next where id = p_game;
    end if;
    insert into public.events (game_id, type, actor_id) values (p_game, 'left', v_user);
  elsif g.status in ('headstart', 'hunt') then
    update public.players set status = 'out' where game_id = p_game and user_id = v_user;
    insert into public.events (game_id, type, actor_id) values (p_game, 'left', v_user);
    if not exists (select 1 from public.players where game_id = p_game and role = 'runner' and status = 'active') then
      perform private.finish (p_game, 'hunters', 'all_caught');
    elsif not exists (select 1 from public.players where game_id = p_game and role = 'hunter' and status = 'active') then
      perform private.finish (p_game, 'runners', 'no_hunters');
    end if;
  end if;
end;
$$;

create function public.update_settings (p_game uuid, p_mode text, p_headstart_sec int, p_duration_sec int)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_host (p_game);
  if p_mode not in ('infection', 'elimination') then
    raise exception 'invalid_mode';
  end if;
  update public.games
     set mode = p_mode, headstart_sec = p_headstart_sec, duration_sec = p_duration_sec
   where id = p_game;
end;
$$;

create function public.set_role (p_game uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_host (p_game);
  if p_role not in ('runner', 'hunter') then
    raise exception 'invalid_role';
  end if;
  update public.players set role = p_role where game_id = p_game and user_id = p_user;
  if not found then
    raise exception 'player_not_found';
  end if;
end;
$$;

-- Verteilt die Rollen zufällig: p_hunters Jäger, der Rest Agenten.
create function public.shuffle_roles (p_game uuid, p_hunters int default 1)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_host (p_game);
  with ranked as (
    select user_id, row_number() over (order by random()) as rn
      from public.players where game_id = p_game
  )
  update public.players pl
     set role = case when r.rn <= greatest(1, p_hunters) then 'hunter' else 'runner' end
    from ranked r
   where pl.game_id = p_game and pl.user_id = r.user_id;
end;
$$;

-- Spielfeld als Vieleck: [{"lat": 52.5, "lng": 13.4}, ...] (3 bis 30 Punkte).
create function public.set_area (p_game uuid, p_points jsonb)
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

  update public.games set area = p_points, area_geog = v_geom::extensions.geography where id = p_game;
  return jsonb_build_object('area_m2', round(v_area));
end;
$$;

create function public.start_game (p_game uuid)
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

  update public.games
     set status = 'headstart',
         started_at = now(),
         hunt_starts_at = now() + make_interval(secs => headstart_sec),
         ends_at = now() + make_interval(secs => headstart_sec + duration_sec),
         next_ping_at = now() + make_interval(secs => headstart_sec),
         ping_seq = 0,
         winner = null,
         end_reason = null,
         ended_at = null
   where id = p_game;
  insert into public.events (game_id, type, actor_id) values (p_game, 'started', v_user);
end;
$$;

-- Wird von der App alle paar Sekunden aufgerufen. Gibt den aktuellen
-- Spielzustand und die Serverzeit zurück (gegen falsch gehende Handyuhren).
create function public.tick (p_game uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
begin
  perform private.require_user ();
  if private.my_role (p_game) is null then
    raise exception 'not_member';
  end if;
  g := private.advance (p_game);
  return jsonb_build_object(
    'status', g.status,
    'server_now', now(),
    'hunt_starts_at', g.hunt_starts_at,
    'ends_at', g.ends_at,
    'next_ping_at', g.next_ping_at,
    'ping_seq', g.ping_seq
  );
end;
$$;

create function public.update_position (p_game uuid, p_lat double precision, p_lng double precision, p_accuracy real default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  g public.games;
  v_inside boolean;
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

  return jsonb_build_object('status', g.status, 'inside', v_inside);
end;
$$;

-- Der Jäger scannt die Agenten-ID. Erst dieser Scan zählt als Fang.
create function public.catch_runner (p_game uuid, p_token text)
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

  insert into public.events (game_id, type, actor_id, target_id, payload)
  values (p_game, 'caught', v_user, v_target, jsonb_build_object('mode', g.mode));

  if not exists (select 1 from public.players where game_id = p_game and role = 'runner' and status = 'active') then
    perform private.finish (p_game, 'hunters', 'all_caught', v_user);
  end if;

  return jsonb_build_object('target_id', v_target, 'name', v_target_name, 'mode', g.mode);
end;
$$;

-- Notfall-Knopf: Jeder Mitspieler kann die Runde sofort für alle beenden.
create function public.abort_game (p_game uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
begin
  if private.my_role (p_game) is null then
    raise exception 'not_member';
  end if;
  perform 1 from public.games where id = p_game for update;
  perform private.finish (p_game, null, 'aborted', v_user);
end;
$$;

-- Nur angemeldete Nutzer dürfen die RPCs aufrufen; interne Funktionen gar niemand von außen.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_game (text),
  public.join_game (text, text),
  public.leave_game (uuid),
  public.update_settings (uuid, text, int, int),
  public.set_role (uuid, uuid, text),
  public.shuffle_roles (uuid, int),
  public.set_area (uuid, jsonb),
  public.start_game (uuid),
  public.tick (uuid),
  public.update_position (uuid, double precision, double precision, real),
  public.catch_runner (uuid, text),
  public.abort_game (uuid)
to authenticated;

revoke execute on function private.require_user (), private.require_host (uuid, text),
  private.finish (uuid, text, text, uuid), private.emit_pings (uuid, int, int, text),
  private.advance (uuid), private.random_code (), private.clean_name (text)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Echtzeit: Änderungen an diesen Tabellen gehen sofort an alle Handys
-- (gefiltert durch die Zugriffsregeln oben).
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.games, public.players, public.positions, public.pings, public.events;
