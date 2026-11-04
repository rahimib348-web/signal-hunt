import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Card, Screen, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { hasPlaceholders, IMPRESSUM, PRIVACY, type LegalBlock, type LegalSection } from '@/lib/legal-texts';
import { stopTracking } from '@/lib/location';
import { OSM_ATTRIBUTION } from '@/lib/osm';
import { storage } from '@/lib/storage';
import { currentUserId, supabase } from '@/lib/supabase';
import { colors, mono, space } from '@/lib/theme';

export default function Legal() {
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void currentUserId().then(setUserId);
  }, []);

  const deleteAll = () =>
    Alert.alert(
      'Alle deine Daten löschen?',
      'Du verlässt laufende Einsätze, und dein anonymes Konto wird mit allen Standorten und Spielständen gelöscht. Das lässt sich nicht rückgängig machen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Endgültig löschen',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await stopTracking();
              await api.deleteMyData();
              await supabase.auth.signOut({ scope: 'local' });
              await storage.setLastGame(null);
              setUserId(null);
              Alert.alert('Erledigt', 'Deine Daten sind gelöscht. Beim nächsten Spiel bekommst du eine neue anonyme Nutzer-ID.');
              router.replace('/');
            } catch (e) {
              Alert.alert('Löschen hat nicht geklappt', errorMessage(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <T variant="label" color={colors.signal}>
          Rechtliches
        </T>
        <T variant="title">Datenschutz und Impressum</T>
      </View>

      {hasPlaceholders() ? (
        <Banner text="Testversion: Name, Anschrift und Kontakt werden vor der Veröffentlichung eingetragen." />
      ) : null}

      <Card>
        <T variant="heading">Deine Daten</T>
        <T variant="muted">Deine anonyme Nutzer-ID. Gib sie an, wenn du uns wegen deiner Daten schreibst.</T>
        <Text selectable style={styles.id}>
          {userId ?? 'Noch keine – du bekommst sie beim ersten Spiel.'}
        </Text>
        <Button title="Meine Daten löschen" kind="danger" onPress={deleteAll} loading={busy} disabled={!userId || busy} />
      </Card>

      <SectionCard section={IMPRESSUM} />

      <T variant="heading">Datenschutzerklärung</T>
      {PRIVACY.map((section) => (
        <SectionCard key={section.title} section={section} />
      ))}

      <T variant="muted" center>
        Karten: Apple Maps bzw. Google Maps · {OSM_ATTRIBUTION}
      </T>
      <Button title="Zurück" kind="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

function SectionCard({ section }: { section: LegalSection }) {
  return (
    <Card>
      <T variant="heading">{section.title}</T>
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </Card>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'text') return <T variant="muted">{block.text}</T>;
  if (block.kind === 'bullets') {
    return (
      <View style={{ gap: space.xs }}>
        {block.items.map((item) => (
          <T key={item} variant="muted">
            • {item}
          </T>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: space.md }}>
      {block.rows.map((row) => (
        <View key={row.what} style={styles.dataRow}>
          <T>{row.what}</T>
          <T variant="muted">Wofür: {row.why}</T>
          <T variant="muted">Wer sie sieht: {row.who}</T>
          <T variant="muted">Gelöscht: {row.until}</T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  id: { color: colors.text, fontFamily: mono, fontSize: 13 },
  dataRow: { gap: 2, borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: space.md },
});
