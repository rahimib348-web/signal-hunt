import type { LatLng } from './types';

// Sonnenauf- und -untergang nach den üblichen astronomischen Näherungsformeln
// (Genauigkeit etwa eine Minute), damit die App vor einer Runde im Dunkeln warnt.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
/** Sonnenmittelpunkt 0,833° unter dem Horizont: Lichtbrechung und Sonnenradius. */
const HORIZON = RAD * -0.833;

const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);

export type SunTimes = {
  /** null, wenn die Sonne an diesem Tag nicht aufgeht (Polarnacht) oder nicht untergeht (Polartag). */
  sunrise: Date | null;
  sunset: Date | null;
  /** true: Polartag, false: Polarnacht, null: normaler Tag. */
  alwaysUp: boolean | null;
};

/** Sonnenauf- und -untergang am Tag von `when` für einen Ort. */
export function sunTimes(when: Date | number, where: LatLng): SunTimes {
  const lw = RAD * -where.lng;
  const phi = RAD * where.lat;
  const d = toDays(typeof when === 'number' ? when : when.getTime());

  const cycle = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const approxNoon = 0.0009 + lw / (2 * Math.PI) + cycle;
  const anomaly = RAD * (357.5291 + 0.98560028 * approxNoon);
  const center = RAD * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  const eclipticLng = anomaly + center + RAD * 102.9372 + Math.PI;
  const declination = Math.asin(Math.sin(OBLIQUITY) * Math.sin(eclipticLng));
  const transit = (days: number) => J2000 + days + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * eclipticLng);

  const cosHourAngle = (Math.sin(HORIZON) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination));
  if (cosHourAngle < -1) return { sunrise: null, sunset: null, alwaysUp: true };
  if (cosHourAngle > 1) return { sunrise: null, sunset: null, alwaysUp: false };

  const hourAngle = Math.acos(cosHourAngle);
  const noon = transit(approxNoon);
  const set = transit(0.0009 + (hourAngle + lw) / (2 * Math.PI) + cycle);
  return { sunrise: fromJulian(noon - (set - noon)), sunset: fromJulian(set), alwaysUp: null };
}

/** Ist es zu diesem Zeitpunkt am Ort dunkel (Sonne unter dem Horizont)? */
export function isDark(at: number, where: LatLng): boolean {
  const t = sunTimes(at, where);
  if (t.alwaysUp !== null) return !t.alwaysUp;
  return at < t.sunrise!.getTime() || at > t.sunset!.getTime();
}

export type NightNotice = { kind: 'dark' } | { kind: 'sunset_during_round'; sunset: Date } | null;

/** Hinweis für eine Runde von `start` bis `end`: Ist es dunkel oder wird es während der Runde dunkel? */
export function nightNotice(start: number, end: number, where: LatLng): NightNotice {
  if (isDark(start, where)) return { kind: 'dark' };
  const { sunset } = sunTimes(start, where);
  if (sunset && sunset.getTime() > start && sunset.getTime() < end) return { kind: 'sunset_during_round', sunset };
  return null;
}

/** "16:42" in der Ortszeit des Handys. */
export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
