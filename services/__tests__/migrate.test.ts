import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: null }));

import { migrateLocalHistory } from '../storageService';

describe('migrateLocalHistory (guest mode, db=null)', () => {
  beforeEach(() => localStorage.clear());

  it('is a no-op and resolves when Firestore is unavailable', async () => {
    localStorage.setItem('snaptour_history_a@b.com', JSON.stringify([
      { id: '1', timestamp: 1, thumbnail: '', landmarkName: 'x', summary: '' },
    ]));
    await expect(migrateLocalHistory('uid1', 'a@b.com')).resolves.toBeUndefined();
    // Legacy data is left intact in guest mode (nothing to migrate to).
    expect(localStorage.getItem('snaptour_history_a@b.com')).not.toBeNull();
  });
});
