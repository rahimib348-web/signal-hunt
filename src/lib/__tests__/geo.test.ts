import { describe, expect, it } from 'vitest';

import {
  distanceM,
  formatArea,
  offset,
  pointInPolygon,
  polygonAreaM2,
  regionFor,
  regularPolygon,
  selfIntersects,
  suggestedAreaM2,
} from '../geo';

const center = { lat: 52.5128, lng: 13.3559 };
const square = [
  offset(center, 250, -250),
  offset(center, 250, 250),
  offset(center, -250, 250),
  offset(center, -250, -250),
];

describe('geo', () => {
  it('misst Entfernungen in Metern', () => {
    expect(distanceM(center, offset(center, 100, 0))).toBeCloseTo(100, 0);
    expect(distanceM(center, offset(center, 0, 300))).toBeCloseTo(300, 0);
  });

  it('berechnet die Fläche eines Quadrats (500 m x 500 m)', () => {
    expect(polygonAreaM2(square)).toBeCloseTo(250_000, -3);
    expect(polygonAreaM2(square.slice(0, 2))).toBe(0);
  });

  it('erkennt, ob ein Punkt im Spielfeld liegt', () => {
    expect(pointInPolygon(center, square)).toBe(true);
    expect(pointInPolygon(offset(center, 400, 0), square)).toBe(false);
  });

  it('erkennt sich kreuzende Linien', () => {
    expect(selfIntersects(square)).toBe(false);
    expect(selfIntersects([square[0], square[2], square[1], square[3]])).toBe(true);
  });

  it('baut ein Achteck mit der gewünschten Fläche', () => {
    const octagon = regularPolygon(center, 600_000, 8);
    expect(octagon).toHaveLength(8);
    expect(polygonAreaM2(octagon)).toBeCloseTo(600_000, -4);
    expect(pointInPolygon(center, octagon)).toBe(true);
  });

  it('empfiehlt eine Spielfeldgröße passend zur Spielerzahl', () => {
    expect(suggestedAreaM2(2)).toBe(400_000);
    expect(suggestedAreaM2(6)).toBe(900_000);
    expect(suggestedAreaM2(50)).toBe(3_000_000);
  });

  it('findet einen Kartenausschnitt für alle Punkte', () => {
    const r = regionFor(square)!;
    expect(r.latitude).toBeCloseTo(center.lat, 4);
    expect(r.longitude).toBeCloseTo(center.lng, 4);
    expect(regionFor([])).toBeNull();
  });

  it('formatiert Flächen auf Deutsch', () => {
    expect(formatArea(250_000)).toBe('0,25 km²');
    expect(formatArea(12_340)).toBe('12300 m²');
  });
});
