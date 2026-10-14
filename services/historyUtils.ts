import type { HistoryItem } from '../types';

export const MAX_HISTORY_ITEMS = 50;

export function sortByNewest(items: HistoryItem[]): HistoryItem[] {
  return [...items].sort((a, b) => b.timestamp - a.timestamp);
}

export function capItems(items: HistoryItem[]): HistoryItem[] {
  return sortByNewest(items).slice(0, MAX_HISTORY_ITEMS);
}
