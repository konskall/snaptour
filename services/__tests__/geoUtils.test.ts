import { describe, it, expect } from 'vitest';
import { getContinent, itemCoords, buildPassport, haversineMeters, bearingDeg, cardinal8 } from '../geoUtils';
import type { HistoryItem, LandmarkMeta } from '../../types';

const meta = (over: Partial<LandmarkMeta>): LandmarkMeta => ({
  country: '', countryCode: '', city: '', category: '',
  lat: null, lng: null, openingHours: '', ticket: '', bestTime: '', website: '',
  ...over,
});

const mk = (id: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
  id, timestamp: Number(id) || 0, thumbnail: '', landmarkName: id, summary: '', ...over,
});

describe('getContinent', () => {
  it('maps known codes (case-insensitive) to continents', () => {
    expect(getContinent('fr')).toBe('Europe');
    expect(getContinent('GR')).toBe('Europe');
    expect(getContinent('jp')).toBe('Asia');
    expect(getContinent('eg')).toBe('Africa');
    expect(getContinent('us')).toBe('North America');
    expect(getContinent('br')).toBe('South America');
    expect(getContinent('au')).toBe('Oceania');
  });
  it('returns null for unknown/empty', () => {
    expect(getContinent('zz')).toBeNull();
    expect(getContinent('')).toBeNull();
    expect(getContinent(undefined)).toBeNull();
  });
});

describe('itemCoords', () => {
  it('prefers stored scan coords over the metadata estimate', () => {
    const item = mk('1', { lat: 1, lng: 2, info: meta({ lat: 9, lng: 9 }) });
    expect(itemCoords(item)).toEqual({ lat: 1, lng: 2 });
  });
  it('falls back to metadata coords', () => {
    expect(itemCoords(mk('1', { info: meta({ lat: 48.8, lng: 2.3 }) }))).toEqual({ lat: 48.8, lng: 2.3 });
  });
  it('returns null when no coords are available', () => {
    expect(itemCoords(mk('1'))).toBeNull();
    expect(itemCoords(mk('1', { info: meta({}) }))).toBeNull();
  });
});

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters({ lat: 48.8584, lng: 2.2945 }, { lat: 48.8584, lng: 2.2945 })).toBeCloseTo(0, 5);
  });
  it('matches the known Paris→London great-circle distance (~344 km)', () => {
    const d = haversineMeters({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 });
    expect(d / 1000).toBeGreaterThan(340);
    expect(d / 1000).toBeLessThan(348);
  });
  it('computes a short distance reasonably (~111 m per 0.001° of latitude)', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 });
    expect(d).toBeGreaterThan(108);
    expect(d).toBeLessThan(114);
  });
});

describe('bearingDeg', () => {
  it('points due East / North / South / West', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90, 1);   // E
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(0, 1);    // N
    expect(bearingDeg({ lat: 1, lng: 0 }, { lat: 0, lng: 0 })).toBeCloseTo(180, 1);  // S
    expect(bearingDeg({ lat: 0, lng: 1 }, { lat: 0, lng: 0 })).toBeCloseTo(270, 1);  // W
  });
});

describe('cardinal8', () => {
  it('maps bearings to the 8-point index (0=N … 7=NW), wrapping near 360', () => {
    expect(cardinal8(0)).toBe(0);    // N
    expect(cardinal8(45)).toBe(1);   // NE
    expect(cardinal8(90)).toBe(2);   // E
    expect(cardinal8(200)).toBe(4);  // ~S
    expect(cardinal8(350)).toBe(0);  // wraps back to N
    expect(cardinal8(315)).toBe(7);  // NW
  });
});

describe('buildPassport', () => {
  it('counts landmarks, dedupes countries by code, and collects continents', () => {
    const items = [
      mk('3', { info: meta({ countryCode: 'fr', country: 'France' }) }),
      mk('2', { info: meta({ countryCode: 'fr', country: 'France' }) }),
      mk('1', { info: meta({ countryCode: 'jp', country: 'Japan' }) }),
    ];
    const p = buildPassport(items);
    expect(p.landmarks).toBe(3);
    expect(p.countries).toHaveLength(2);
    expect(p.countries[0]).toEqual({ code: 'fr', name: 'France', count: 2 }); // most-visited first
    expect(p.continents.sort()).toEqual(['Asia', 'Europe']);
  });

  it('still counts landmarks with no geography, but not as stamps', () => {
    const items = [mk('1'), mk('2', { info: meta({ countryCode: 'it', country: 'Italy' }) })];
    const p = buildPassport(items);
    expect(p.landmarks).toBe(2);
    expect(p.countries).toHaveLength(1);
  });
});
