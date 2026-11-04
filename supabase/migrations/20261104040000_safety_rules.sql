-- Sicherheitsregeln: Vor jeder Runde bestätigt jeder Spieler kurz die Regeln
-- (nicht auf Straßen, Gleise oder Privatgelände, auf den Verkehr achten).
-- Erst wenn alle bestätigt haben, kann der Host starten.

alter table public.players add column rules_accepted_at timestamptz;

create function public.accept_rules (p_game uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
begin
  if private.game_status (p_game) is distinct from 'lobby' then
    raise exception 'wrong_status';
  end if;
  update public.players set rules_accepted_at = now() where game_id = p_game and user_id = v_user;
  if not found then
    raise exception 'not_member';
  end if;
end;
$$;

revoke execute on function public.accept_rules (uuid) from public, anon;
grant execute on function public.accept_rules (uuid) to authenticated;

-- Start: zusätzlich müssen alle die Sicherheitsregeln bestätigt haben.
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
  if exists (select 1 from public.players where game_id = p_game and rules_accepted_at is null) then
    raise exception 'rules_not_accepted';
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

-- Neue Runde: Die Regeln werden vor jeder Runde neu bestätigt.
create or replace function public.reset_game (p_game uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_host (p_game, 'ended');
  update public.players
     set role = 'runner', status = 'active', caught_at = null, caught_by = null, rules_accepted_at = null
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
