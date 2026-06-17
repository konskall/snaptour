import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('isFirebaseConfigured', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FIREBASE_API_KEY = '';
    process.env.FIREBASE_PROJECT_ID = '';
    process.env.FIREBASE_APP_ID = '';
  });

  it('returns false when required env vars are empty', async () => {
    const { isFirebaseConfigured } = await import('../firebase');
    expect(isFirebaseConfigured()).toBe(false);
  });
});
