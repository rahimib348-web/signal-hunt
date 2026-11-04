import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { Button, Loading, Screen, T } from '@/components/ui';
import { Lobby } from '@/features/lobby';
import { Play } from '@/features/play';
import { Results } from '@/features/results';
import { useGame } from '@/hooks/use-game';
import { stopTracking } from '@/lib/location';
import { storage } from '@/lib/storage';

// Ein Bildschirm pro Spiel; was angezeigt wird, hängt vom Spielabschnitt ab.
export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useGame(id);
  const status = data.game?.status;

  // Nach dem Spiel sofort aufhören, den Standort zu senden.
  useEffect(() => {
    if (status === 'ended' || data.notFound) void stopTracking();
  }, [status, data.notFound]);

  useEffect(() => {
    if (data.notFound) void storage.setLastGame(null);
  }, [data.notFound]);

  if (data.notFound) {
    return (
      <Screen>
        <T variant="heading">Einsatz nicht gefunden</T>
        <T variant="muted">Der Einsatz wurde beendet oder gelöscht.</T>
        <Button title="Zum Start" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (data.loading || !data.game) {
    if (data.error) {
      return (
        <Screen>
          <T variant="heading">Keine Verbindung</T>
          <T variant="muted">{data.error}</T>
          <Button title="Erneut versuchen" onPress={() => void data.refresh()} />
          <Button title="Zum Start" kind="ghost" onPress={() => router.replace('/')} />
        </Screen>
      );
    }
    return <Loading />;
  }

  if (!data.me) {
    return (
      <Screen>
        <T variant="heading">Du bist nicht in diesem Einsatz</T>
        <Button title="Zum Start" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (status === 'lobby') return <Lobby data={data} />;
  if (status === 'ended') return <Results data={data} />;
  return <Play data={data} />;
}
