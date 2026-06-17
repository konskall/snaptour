import { HistoryItem } from '../types';
import { db } from './firebase';
import { capItems, idsToEvict } from './historyUtils';
import {
  collection, doc, getDocs, setDoc, query, orderBy, writeBatch,
} from 'firebase/firestore';

// Helper to resize image for thumbnail storage
export const createThumbnail = async (base64Image: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    // Ensure data URI prefix exists for loading
    img.src = base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`;

    img.onload = () => {
      // Increased to 500px for better resolution on high-DPI screens
      const MAX_WIDTH = 500;
      const scale = MAX_WIDTH / img.width;

      if (scale >= 1) {
        // Image is already small enough, just return stripped base64
        resolve(base64Image.replace(/^data:image\/\w+;base64,/, ""));
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = MAX_WIDTH;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Image.replace(/^data:image\/\w+;base64,/, ""));
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Quality 0.7 for better visual fidelity while managing storage size
      const resized = canvas.toDataURL('image/jpeg', 0.7);
      resolve(resized.split(',')[1]);
    };

    img.onerror = () => {
       // Fallback to original if loading fails
       resolve(base64Image.replace(/^data:image\/\w+;base64,/, ""));
    };
  });
};

// ---- localStorage cache (also the sole store in guest mode) ----
const cacheKey = (uid: string) => `snaptour_history_${uid}`;

function readCache(uid: string): HistoryItem[] {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    return raw ? capItems(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeCache(uid: string, items: HistoryItem[]): void {
  const capped = capItems(items);
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify(capped));
  } catch (e: any) {
    // Quota: drop oldest until it fits.
    const shrinking = [...capped];
    while (shrinking.length > 1) {
      shrinking.pop();
      try { localStorage.setItem(cacheKey(uid), JSON.stringify(shrinking)); return; }
      catch { /* keep shrinking */ }
    }
    console.error('Failed to write history cache', e);
  }
}

// ---- Firestore ----
const historyCol = (uid: string) => collection(db!, 'users', uid, 'history');

export async function getHistory(uid: string): Promise<HistoryItem[]> {
  if (!db) return readCache(uid);
  try {
    const snap = await getDocs(query(historyCol(uid), orderBy('timestamp', 'desc')));
    const items = capItems(snap.docs.map(d => d.data() as HistoryItem));
    writeCache(uid, items);
    return items;
  } catch (e) {
    console.error('getHistory failed; using cache', e);
    return readCache(uid);
  }
}

export async function saveHistoryItem(uid: string, item: HistoryItem): Promise<void> {
  writeCache(uid, [item, ...readCache(uid)]); // optimistic cache update
  if (!db) return;
  try {
    await setDoc(doc(historyCol(uid), item.id), item);
    const snap = await getDocs(query(historyCol(uid), orderBy('timestamp', 'desc')));
    const evict = idsToEvict(snap.docs.map(d => d.data() as HistoryItem));
    if (evict.length) {
      const batch = writeBatch(db);
      evict.forEach(id => batch.delete(doc(historyCol(uid), id)));
      await batch.commit();
    }
  } catch (e) {
    console.error('saveHistoryItem failed (kept in local cache)', e);
  }
}

export async function clearHistory(uid: string): Promise<void> {
  localStorage.removeItem(cacheKey(uid));
  if (!db) return;
  try {
    const snap = await getDocs(historyCol(uid));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (e) {
    console.error('clearHistory failed', e);
  }
}
