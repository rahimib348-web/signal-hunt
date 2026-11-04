const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/** Inhalt des Beitritts-QR-Codes in der Lobby. */
export function joinLink(code: string): string {
  return `signalhunt://join/${code}`;
}

/** Liest einen Einsatz-Code aus einem gescannten QR-Code (Link oder nur Code). */
export function parseJoinCode(data: string): string | null {
  const trimmed = data.trim();
  const match = trimmed.match(/join\/([A-Za-z0-9]{6})\/?$/);
  const candidate = (match ? match[1] : trimmed).toUpperCase();
  return CODE_RE.test(candidate) ? candidate : null;
}

/** Agenten-IDs beginnen mit SH1- (siehe start_game im Backend). */
export function isCatchToken(data: string): boolean {
  return /^SH1-[0-9a-f]{32}$/.test(data.trim());
}
