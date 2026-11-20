import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@pwp/core', () => {
  it('is wired into the test runner', () => {
    expect(PACKAGE_NAME).toBe('@pwp/core');
  });
});
