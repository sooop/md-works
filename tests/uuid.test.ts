import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from '../src/lib/utils';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('crypto.randomUUID 가 있으면 그 값을 쓴다', () => {
    expect(uuid()).toMatch(V4);
  });

  it('crypto.randomUUID 가 없어도(iOS 15.4 미만·비보안 컨텍스트) v4 형식이고 서로 다르다', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const ids = new Set(Array.from({ length: 500 }, () => uuid()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(V4);
  });
});
