import { describe, it, expect } from 'vitest';
import { sortByNewest, capItems, MAX_HISTORY_ITEMS } from '../historyUtils';
import type { HistoryItem } from '../../types';

const mk = (id: string, ts: number): HistoryItem => ({
  id, timestamp: ts, thumbnail: '', landmarkName: id, summary: '',
});

describe('historyUtils', () => {
  it('MAX_HISTORY_ITEMS is 50', () => {
    expect(MAX_HISTORY_ITEMS).toBe(50);
  });

  it('sortByNewest orders by timestamp descending without mutating input', () => {
    const input = [mk('a', 1), mk('b', 3), mk('c', 2)];
    const out = sortByNewest(input);
    expect(out.map(i => i.id)).toEqual(['b', 'c', 'a']);
    expect(input.map(i => i.id)).toEqual(['a', 'b', 'c']); // unchanged
  });

  it('capItems keeps only the newest MAX_HISTORY_ITEMS', () => {
    const items = Array.from({ length: 55 }, (_, i) => mk(`id${i}`, i));
    const out = capItems(items);
    expect(out).toHaveLength(50);
    expect(out[0].id).toBe('id54'); // newest first
    expect(out[out.length - 1].id).toBe('id5');
  });
});
