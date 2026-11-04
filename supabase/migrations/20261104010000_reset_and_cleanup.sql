-- Neue Runde mit derselben Gruppe und automatisches Aufräumen alter Spiele.

-- Host setzt ein beendetes Spiel zurück in die Lobby. Spieler, Einsatzgebiet und
-- Einstellungen bleiben, alle Standorte und Pings der alten Runde werden gelöscht.
create function public.reset_game (p_game uuid)
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
  delete from public.events where game_id = p_game;
  update public.games
     set status = 'lobby', started_at = null, hunt_starts_at = null, ends_at = null, ended_at = null,
         winner = null, end_reason = null, next_ping_at = null, ping_seq = 0
   where id = p_game;
  insert into public.events (game_id, type, actor_id) values (p_game, 'reset', auth.uid());
end;
$$;

revoke execute on function public.reset_game (uuid) from public, anon;
grant execute on function public.reset_game (uuid) to authenticated;

-- Datenschutz: Spiele (mit allen Standorten) werden 24 Stunden nach dem
-- Erstellen gelöscht, beendete Spiele schon 6 Stunden nach dem Ende.
create function private.cleanup_old_games ()
returns int language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  delete from public.games
   where created_at < now() - interval '24 hours'
      or (status = 'ended' and ended_at < now() - interval '6 hours');
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function private.cleanup_old_games () from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule ('signal-hunt-cleanup', '17 * * * *', $$select private.cleanup_old_games ()$$);
