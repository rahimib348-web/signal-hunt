/** "04:59" oder "1:02:03" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "gerade eben", "vor 45 s", "vor 3 Min." */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'gerade eben';
  if (s < 60) return `vor ${s} s`;
  return `vor ${Math.floor(s / 60)} Min.`;
}

/** "45 Min." oder "1 Std. 30 Min." */
export function formatMinutes(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} Std.` : `${h} Std. ${rest} Min.`;
}

/**
 * Handyuhren gehen oft ein paar Sekunden falsch. Wir merken uns den Abstand
 * zur Serverzeit und rechnen alle Countdowns damit.
 */
export function clockOffset(serverNowIso: string, requestStartedAt: number, responseAt: number): number {
  const midpoint = (requestStartedAt + responseAt) / 2;
  return Date.parse(serverNowIso) - midpoint;
}
