import { describe, expect, it } from 'vitest';

import { isCatchToken, joinLink, parseJoinCode } from '../links';
import { huntPhase, latestPingPerTarget } from '../rules';
import { clockOffset, formatAgo, formatCountdown, formatMinutes } from '../time';
import type { Ping } from '../types';

describe('Zeit', () => {
  it('formatiert Countdowns', () => {
    expect(formatCountdown(299_100)).toBe('05:00');
    expect(formatCountdown(61_000)).toBe('01:01');
    expect(formatCountdown(3_723_000)).toBe('1:02:03');
    expect(formatCountdown(-5000)).toBe('00:00');
  });

  it('formatiert "vor X"', () => {
    expect(formatAgo(3000)).toBe('gerade eben');
    expect(formatAgo(45_000)).toBe('vor 45 s');
    expect(formatAgo(185_000)).toBe('vor 3 Min.');
  });

  it('formatiert Minuten', () => {
    expect(formatMinutes(300)).toBe('5 Min.');
    expect(formatMinutes(3600)).toBe('1 Std.');
    expect(formatMinutes(5400)).toBe('1 Std. 30 Min.');
  });

  it('gleicht die Handyuhr mit der Serverzeit ab', () => {
    const offset = clockOffset(new Date(10_500).toISOString(), 1000, 2000);
    expect(offset).toBe(9000);
  });
});

describe('Links', () => {
  it('liest Einsatz-Codes aus QR-Codes', () => {
    expect(parseJoinCode(joinLink('ABC234'))).toBe('ABC234');
    expect(parseJoinCode('abc234')).toBe('ABC234');
    expect(parseJoinCode('signalhunt://join/abc234/')).toBe('ABC234');
    expect(parseJoinCode('ABC10O')).toBeNull(); // 0, 1 und O kommen in Codes nicht vor
    expect(parseJoinCode('https://example.com')).toBeNull();
  });

  it('erkennt Agenten-IDs', () => {
    expect(isCatchToken('SH1-0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isCatchToken('SH1-falsch')).toBe(false);
    expect(isCatchToken('signalhunt://join/ABC234')).toBe(false);
  });
});

describe('Regeln', () => {
  it('teilt die Jagd in drei Phasen', () => {
    const game = { hunt_starts_at: new Date(0).toISOString(), duration_sec: 2700 };
    expect(huntPhase(game, 0)).toBe(1);
    expect(huntPhase(game, 899_000)).toBe(1);
    expect(huntPhase(game, 900_000)).toBe(2);
    expect(huntPhase(game, 1_800_000)).toBe(3);
    expect(huntPhase(game, 9_999_999)).toBe(3);
  });

  it('nimmt pro Agent den neuesten Ping', () => {
    const ping = (id: number, target: string): Ping => ({
      id,
      target_id: target,
      game_id: 'g',
      seq: id,
      kind: 'regular',
      lat: 0,
      lng: 0,
      radius_m: 100,
      created_at: '',
    });
    const latest = latestPingPerTarget([ping(1, 'a'), ping(2, 'b'), ping(3, 'a')]);
    expect(latest.get('a')?.id).toBe(3);
    expect(latest.get('b')?.id).toBe(2);
  });
});
