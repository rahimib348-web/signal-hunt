import { ABILITIES, gainedText } from './abilities';
import type { AbilityId, GameEvent, Ping } from './types';

export type Viewer = 'runner' | 'hunter' | 'spectator';
export type Tone = 'danger' | 'warning' | 'good' | 'info';
export type SoundName = 'ping' | 'alarm' | 'glitch' | 'success' | 'checkpoint';

export type Message = {
  text: string;
  tone: Tone;
  sound?: SoundName;
  /** Kommen mehrere Meldungen gleichzeitig, gewinnt die wichtigste. */
  priority: number;
};

type Names = Record<string, string>;

/** Meldung zu einem neuen Ereignis aus Sicht des Spielers (oder null). */
export function describeEvent(e: GameEvent, names: Names, userId: string | null, viewer: Viewer): Message | null {
  const actor = e.actor_id ? (names[e.actor_id] ?? 'Jemand') : 'Jemand';
  const target = e.target_id ? (names[e.target_id] ?? 'Ein Agent') : 'Ein Agent';
  const self = e.actor_id !== null && e.actor_id === userId;
  const ability = (e.payload?.ability as AbilityId | undefined) ?? undefined;

  switch (e.type) {
    case 'hunt_started':
      return {
        text: viewer === 'hunter' ? 'Die Jagd beginnt! Erster Ping ist da.' : 'Die Jagd beginnt! Der Jäger ist unterwegs.',
        tone: 'danger',
        sound: 'alarm',
        priority: 3,
      };
    case 'ping':
      return viewer === 'runner'
        ? { text: 'Ping! Der Jäger sieht jetzt deinen Kreis.', tone: 'danger', sound: 'ping', priority: 1 }
        : { text: 'Neuer Ping empfangen.', tone: 'warning', sound: 'ping', priority: 1 };
    case 'caught':
      if (e.target_id === userId) {
        return e.payload.mode === 'infection'
          ? { text: 'Du wurdest gefangen! Ab jetzt jagst du mit.', tone: 'danger', sound: 'alarm', priority: 9 }
          : { text: 'Du wurdest gefangen und bist raus.', tone: 'danger', sound: 'alarm', priority: 9 };
      }
      return { text: `${target} wurde von ${actor} gefangen!`, tone: 'danger', sound: 'alarm', priority: 6 };
    case 'left':
      return { text: `${actor} hat den Einsatz verlassen.`, tone: 'info', priority: 1 };
    case 'ability_used':
      if (ability === 'radar') {
        if (viewer === 'runner') return { text: 'Radar! Der Jäger hat gerade alle Agenten geortet.', tone: 'danger', sound: 'alarm', priority: 5 };
        return self ? null : { text: `${actor} hat das Radar benutzt.`, tone: 'info', priority: 2 };
      }
      if (ability === 'compass') {
        if (viewer === 'runner') return { text: 'Achtung: Der Jäger peilt euch mit dem Kompass an!', tone: 'warning', sound: 'alarm', priority: 4 };
        return self ? null : { text: `${actor} hat den Kompass benutzt.`, tone: 'info', priority: 2 };
      }
      if (self && ability === 'jammer') return { text: 'Störsender scharf: Dein nächster Ping fällt aus.', tone: 'good', sound: 'glitch', priority: 4 };
      if (self && ability === 'fake_ping') return { text: 'Fake-Ping scharf: Dein nächster Ping zeigt einen falschen Ort.', tone: 'good', sound: 'glitch', priority: 4 };
      return null;
    case 'ability_gained':
      if (!self || !ability || !ABILITIES[ability]) return null;
      return {
        text: gainedText(ability, e.payload?.source as string | undefined),
        tone: 'good',
        sound: e.payload?.source === 'start' ? undefined : 'success',
        priority: e.payload?.source === 'start' ? 1 : 5,
      };
    case 'fake_ping_sent':
      return self ? { text: 'Fake-Ping gesendet: Der Jäger sieht dich an einem falschen Ort.', tone: 'good', sound: 'glitch', priority: 4 } : null;
    case 'checkpoint':
      return viewer === 'runner'
        ? { text: 'Neuer toter Briefkasten! Wer zuerst dort ist, bekommt eine Fähigkeit.', tone: 'warning', sound: 'checkpoint', priority: 3 }
        : null;
    case 'checkpoint_claimed':
      if (self || viewer !== 'runner') return null;
      return { text: `${actor} hat den toten Briefkasten geleert.`, tone: 'info', priority: 2 };
    default:
      return null;
  }
}

/** Meldung zu einem neuen Ping, der kein normaler Ping ist (Störsender, Strafen). */
export function describePing(p: Ping, names: Names, userId: string | null, viewer: Viewer): Message | null {
  const own = p.target_id === userId;
  const name = names[p.target_id] ?? 'Ein Agent';
  switch (p.kind) {
    case 'jammed':
      if (own) return { text: 'Dein Störsender hat den Ping verschluckt.', tone: 'good', sound: 'glitch', priority: 4 };
      return viewer === 'runner' ? null : { text: `Signal von ${name} gestört!`, tone: 'warning', sound: 'glitch', priority: 3 };
    case 'exposed':
      if (own) return { text: 'Der Jäger sieht deinen genauen Standort! Zurück ins Einsatzgebiet!', tone: 'danger', sound: 'alarm', priority: 7 };
      return viewer === 'runner' ? null : { text: `${name} ist außerhalb: genauer Standort!`, tone: 'danger', sound: 'ping', priority: 4 };
    case 'idle':
      if (own) return { text: 'Extra-Ping: Du hast dich zu lange nicht bewegt.', tone: 'danger', sound: 'alarm', priority: 6 };
      return viewer === 'runner' ? null : { text: `${name} steht still: Extra-Ping!`, tone: 'warning', sound: 'ping', priority: 3 };
    default:
      return null;
  }
}

/** Die wichtigste Meldung; bei Gleichstand die neueste. */
export function pickMessage(messages: (Message | null)[]): Message | null {
  let best: Message | null = null;
  for (const m of messages) {
    if (m && (!best || m.priority >= best.priority)) best = m;
  }
  return best;
}
