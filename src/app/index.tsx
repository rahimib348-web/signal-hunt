import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Card, Field, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { randomCodename } from '@/lib/codenames';
import { errorMessage } from '@/lib/errors';
import { storage } from '@/lib/storage';
import { ensureSignedIn, supabase } from '@/lib/supabase';
import { colors, mono, space } from '@/lib/theme';

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const saved = await storage.getName();
        if (active && saved) setName((current) => current || saved);
        // Läuft noch ein Einsatz von vorhin?
        const last = await storage.getLastGame();
        if (!last) return;
        try {
          await ensureSignedIn();
          const { data } = await supabase.from('games').select('id, status').eq('id', last).maybeSingle();
          if (active) setResumeId(data && data.status !== 'ended' ? data.id : null);
        } catch {
          // Offline: kein Hinweis.
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const cleanName = name.trim();
  const cleanCode = code.trim().toUpperCase();

  async function create() {
    if (!cleanName) return Alert.alert('Agentenname fehlt', 'Gib zuerst deinen Namen ein.');
    setBusy('create');
    try {
      await ensureSignedIn();
      await storage.setName(cleanName);
      const gameId = await api.createGame(cleanName);
      await storage.setLastGame(gameId);
      router.push(`/game/${gameId}`);
    } catch (e) {
      Alert.alert('Einsatz konnte nicht erstellt werden', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    if (!cleanName) return Alert.alert('Agentenname fehlt', 'Gib zuerst deinen Namen ein.');
    if (cleanCode.length !== 6) return Alert.alert('Code prüfen', 'Der Einsatz-Code hat 6 Zeichen.');
    setBusy('join');
    try {
      await ensureSignedIn();
      await storage.setName(cleanName);
      const gameId = await api.joinGame(cleanCode, cleanName);
      await storage.setLastGame(gameId);
      setCode('');
      router.push(`/game/${gameId}`);
    } catch (e) {
      Alert.alert('Beitritt fehlgeschlagen', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <View style={styles.logo}>
        <T variant="label" color={colors.signal}>
          ● Signal erfasst
        </T>
        <T variant="title" style={styles.logoText}>
          SIGNAL HUNT
        </T>
        <T variant="muted">Agenten fliehen. Der Jäger folgt ihrem Signal.</T>
      </View>

      {resumeId ? (
        <Card accent={colors.signal}>
          <T variant="heading">Dein Einsatz läuft noch</T>
          <Button title="Zurück zum Einsatz" onPress={() => router.push(`/game/${resumeId}`)} />
        </Card>
      ) : null}

      <Field
        label="Dein Agentenname"
        value={name}
        onChangeText={setName}
        placeholder="z. B. Falke"
        maxLength={24}
        autoCorrect={false}
        returnKeyType="done"
      />
      <Button title="Decknamen würfeln" kind="ghost" onPress={() => setName(randomCodename())} />

      <Card>
        <T variant="heading">Neuer Einsatz</T>
        <T variant="muted">Du wirst Host: Du legst das Einsatzgebiet fest und startest die Runde.</T>
        <Button title="Einsatz erstellen" onPress={create} loading={busy === 'create'} disabled={busy !== null} />
      </Card>

      <Card>
        <T variant="heading">Einsatz beitreten</T>
        <Field
          label="Einsatz-Code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6))}
          placeholder="ABC123"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          style={styles.codeInput}
        />
        <Button title="Beitreten" onPress={join} loading={busy === 'join'} disabled={busy !== null} />
        <Button title="QR-Code scannen" kind="secondary" onPress={() => router.push('/scan-join')} disabled={busy !== null} />
      </Card>

      <Card>
        <T variant="label">So läuft eine Runde</T>
        <T variant="muted">1. Der Host zeichnet das Einsatzgebiet auf die Karte.</T>
        <T variant="muted">2. Die Agenten bekommen Vorsprung, der Jäger sieht so lange nichts.</T>
        <T variant="muted">3. Danach sieht der Jäger regelmäßig Pings: Kreise, in denen ein Agent steckt.</T>
        <T variant="muted">4. Agenten holen sich an toten Briefkästen Störsender und Fake-Pings. Jäger haben Radar und Kompass.</T>
        <T variant="muted">5. Wer zu lange stillsteht oder das Gebiet verlässt, wird für den Jäger sichtbar.</T>
        <T variant="muted">6. Gefangen ist, wessen Agenten-ID der Jäger scannt.</T>
      </Card>

      <Button title="Datenschutz und Impressum" kind="ghost" onPress={() => router.push('/legal')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { gap: space.xs, paddingTop: space.xl, paddingBottom: space.sm },
  logoText: { fontFamily: mono, fontSize: 36, letterSpacing: 4 },
  codeInput: { fontFamily: mono, letterSpacing: 6, fontSize: 24, textAlign: 'center' },
});
