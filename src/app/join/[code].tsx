import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, Card, Field, Loading, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { parseJoinCode } from '@/lib/links';
import { storage } from '@/lib/storage';
import { ensureSignedIn } from '@/lib/supabase';
import { colors } from '@/lib/theme';

// Wird über den Beitritts-Link signalhunt://join/CODE oder den QR-Scanner geöffnet.
export default function JoinByLink() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = parseJoinCode(params.code ?? '');
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(withName: string) {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await ensureSignedIn();
      await storage.setName(withName);
      const gameId = await api.joinGame(code, withName);
      await storage.setLastGame(gameId);
      router.replace(`/game/${gameId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const saved = await storage.getName();
      if (saved) {
        setName(saved);
        await join(saved);
      }
      setReady(true);
    })();
    // Nur einmal beim Öffnen automatisch beitreten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!code) {
    return (
      <Screen>
        <T variant="heading">Ungültiger Link</T>
        <T variant="muted">Dieser Link enthält keinen gültigen Einsatz-Code.</T>
        <Button title="Zum Start" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (!ready || (busy && !error)) return <Loading text={`Trete Einsatz ${code} bei …`} />;

  return (
    <Screen>
      <T variant="title">Einsatz {code}</T>
      {error ? (
        <Card accent={colors.hunter}>
          <T color={colors.hunter}>{error}</T>
        </Card>
      ) : null}
      <Field label="Dein Agentenname" value={name} onChangeText={setName} maxLength={24} placeholder="z. B. Falke" />
      <Button title="Beitreten" onPress={() => void join(name.trim())} disabled={!name.trim()} loading={busy} />
      <Button title="Zum Start" kind="ghost" onPress={() => router.replace('/')} />
    </Screen>
  );
}
