import { describe, it, expect, beforeEach, vi } from 'vitest';

// Force guest mode: no Firestore. Exercises the localStorage cache paths.
vi.mock('../firebase', () => ({ db: null }));

import { getHistory, saveHistoryItem, clearHistory } from '../storageService';
import type { HistoryItem } from '../../types';

const mk = (id: string, ts: number): HistoryItem => ({
  id, timestamp: ts, thumbnail: '', landmarkName: id, summary: '',
});

describe('storageService (guest / cache mode, db=null)', () => {
  beforeEach(() => localStorage.clear());

  it('getHistory returns [] when nothing stored', async () => {
    expect(await getHistory('u1')).toEqual([]);
  });

  it('saveHistoryItem writes to the uid cache, newest first', async () => {
    await saveHistoryItem('u1', mk('a', 1));
    await saveHistoryItem('u1', mk('b', 2));
    const out = await getHistory('u1');
    expect(out.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('saveHistoryItem caps the cache at 50 newest', async () => {
    for (let i = 0; i < 55; i++) await saveHistoryItem('u1', mk(`id${i}`, i));
    const out = await getHistory('u1');
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('id54');
  });

  it('clearHistory empties the uid cache', async () => {
    await saveHistoryItem('u1', mk('a', 1));
    await clearHistory('u1');
    expect(await getHistory('u1')).toEqual([]);
  });

  it('history is isolated per uid', async () => {
    await saveHistoryItem('u1', mk('a', 1));
    expect(await getHistory('u2')).toEqual([]);
  });
});
