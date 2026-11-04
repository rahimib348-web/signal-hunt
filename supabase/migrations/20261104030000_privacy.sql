-- Datenschutz: eigene Daten sofort löschen und anonyme Nutzer nach 30 Tagen
-- ohne Nutzung automatisch entfernen (siehe Datenschutzerklärung).

-- Löscht alles, was zu dir gehört, und das anonyme Konto selbst. Einsätze der
-- anderen laufen weiter: In der Lobby verlässt du den Einsatz, in einer
-- laufenden Runde scheidest du aus, und wer Host ist, gibt den Host ab.
create function public.delete_my_data ()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_user ();
  r record;
  v_host uuid;
  v_next uuid;
begin
  for r in
    select pl.game_id from public.players pl where pl.user_id = v_user
  loop
    perform public.leave_game (r.game_id);
    select host_id into v_host from public.games where id = r.game_id for update;
    if found and v_host = v_user then
      select user_id into v_next
        from public.players
       where game_id = r.game_id and user_id <> v_user
       order by (status = 'active') desc, joined_at
       limit 1;
      if v_next is null then
        delete from public.games where id = r.game_id;
      else
        update public.games set host_id = v_next where id = r.game_id;
      end if;
    end if;
  end loop;

  -- Was nicht über einen Fremdschlüssel am Spieler hängt.
  delete from public.pings where target_id = v_user;
  delete from public.checkpoint_claims where user_id = v_user;
  delete from public.events where actor_id = v_user or target_id = v_user;

  -- Das anonyme Konto. Spielerzeilen, Standorte, Wege, Fähigkeiten, Agenten-ID
  -- und die Anmeldesitzungen hängen daran und verschwinden mit.
  delete from auth.users where id = v_user;
end;
$$;

revoke execute on function public.delete_my_data () from public, anon;
grant execute on function public.delete_my_data () to authenticated;

-- Anonyme Nutzer, die 30 Tage lang weder gespielt noch die App geöffnet haben,
-- werden gelöscht, samt ihrer Anmeldesitzungen (in denen Supabase auch IP-Adresse
-- und Gerätetyp speichert). Wer gerade in einem Einsatz ist, bleibt.
create function private.cleanup_inactive_users ()
returns int language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  delete from auth.users u
   where u.is_anonymous
     and not exists (select 1 from public.players pl where pl.user_id = u.id)
     and greatest(
           u.created_at,
           u.last_sign_in_at,
           u.updated_at,
           (select max(greatest(s.updated_at, s.refreshed_at at time zone 'utc'))
              from auth.sessions s
             where s.user_id = u.id)
         ) < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function private.cleanup_inactive_users () from public, anon, authenticated;

select cron.schedule ('signal-hunt-inactive-users', '43 3 * * *', $$select private.cleanup_inactive_users ()$$);
