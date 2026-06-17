import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs and has jsdom localStorage', () => {
    localStorage.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
  });
});
