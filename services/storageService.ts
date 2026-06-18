import { HistoryItem } from '../types';
import { db } from './firebase';
import { capItems, MAX_HISTORY_ITEMS } from './historyUtils';
import {
  collection, doc, getDocs, setDoc, deleteDoc, query, orderBy, limit, writeBatch, getCountFromServer,
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

// Downscale an image to a max dimension before sending it to the recognition model.
// Large phone photos (several MB) upload slowly and the vision model downsamples anyway,
// so ~1024px keeps full accuracy while cutting upload time. Returns stripped base64 + its
// mime type. Falls back to the original bytes on any failure.
export const createScaledImage = async (
  base64Image: string,
  maxDim = 1024,
  quality = 0.85,
): Promise<{ base64: string; mimeType: string }> => {
  return new Promise((resolve) => {
    const origMime = base64Image.match(/^data:([^;]+)/)?.[1] || 'image/jpeg';
    const orig = () => ({ base64: base64Image.replace(/^data:image\/\w+;base64,/, ''), mimeType: origMime });
    const img = new Image();
    img.src = base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`;
    img.onload = () => {
      const longest = Math.max(img.width, img.height);
      const scale = maxDim / longest;
      if (!Number.isFinite(scale) || scale >= 1) { resolve(orig()); return; } // already small enough
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(orig()); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ base64: canvas.toDataURL('image/jpeg', quality).split(',')[1], mimeType: 'image/jpeg' });
    };
    img.onerror = () => resolve(orig());
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

export async function saveHistoryItem(uid: string, item: HistoryItem): Promise<HistoryItem[]> {
  const optimistic = capItems([item, ...readCache(uid)]);
  writeCache(uid, optimistic); // optimistic cache update
  if (!db) return optimistic;
  try {
    await setDoc(doc(historyCol(uid), item.id), item);
    // Evict via COUNT (avoids a full collection read).
    const cnt = (await getCountFromServer(historyCol(uid))).data().count;
    if (cnt > MAX_HISTORY_ITEMS) {
      const overflow = cnt - MAX_HISTORY_ITEMS;
      const oldest = await getDocs(query(historyCol(uid), orderBy('timestamp', 'asc'), limit(overflow)));
      const batch = writeBatch(db);
      oldest.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.error('saveHistoryItem failed (kept in local cache)', e);
  }
  return optimistic;
}

export async function deleteHistoryItem(uid: string, id: string): Promise<HistoryItem[]> {
  const next = readCache(uid).filter(i => i.id !== id);
  writeCache(uid, next); // optimistic cache update
  if (!db) return next;
  try {
    await deleteDoc(doc(historyCol(uid), id));
  } catch (e) {
    console.error('deleteHistoryItem failed (cache already updated)', e);
  }
  return next;
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

const legacyKey = (email: string) => `snaptour_history_${email}`;

export async function migrateLocalHistory(uid: string, email: string): Promise<void> {
  if (!db) return; // guest mode must NOT touch the legacy key
  const raw = localStorage.getItem(legacyKey(email));
  if (!raw) return;
  try {
    const localItems = capItems(JSON.parse(raw) as HistoryItem[]);
    if (localItems.length === 0) return;
    const existing = await getDocs(query(historyCol(uid), limit(1)));
    if (!existing.empty) return; // cloud already has data — don't overwrite
    const batch = writeBatch(db);
    localItems.forEach(it => batch.set(doc(historyCol(uid), it.id), it));
    await batch.commit();
  } catch (e) {
    console.error('migrateLocalHistory failed', e);
  } finally {
    // Remove the legacy email-keyed PII on every db-configured path
    // (success, cloud-already-has-data, or thrown commit).
    localStorage.removeItem(legacyKey(email));
  }
}
