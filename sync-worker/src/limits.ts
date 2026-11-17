// 한도. 기본값은 src/lib/sync/protocol.ts 의 LIMITS 와 같다(test/contract.test.ts 가 대조한다).
export interface Limits {
  MAX_ITEM_BYTES: number;
  MAX_ITEMS_PER_SPACE: number;
  MAX_SPACE_BYTES: number;
  MAX_SPACES: number;
  MAX_DAILY_WRITES: number;
  TOMBSTONE_DAYS: number;
  MAX_BODY_BYTES: number;
  MAX_PUSH_ITEMS: number;
  PULL_MAX_ITEMS: number;
  PULL_MAX_BYTES: number;
}

export const DEFAULT_LIMITS: Limits = {
  MAX_ITEM_BYTES: 262_144,
  MAX_ITEMS_PER_SPACE: 1000,
  MAX_SPACE_BYTES: 5_242_880,
  MAX_SPACES: 60,
  MAX_DAILY_WRITES: 300,
  TOMBSTONE_DAYS: 30,
  MAX_BODY_BYTES: 524_288,
  MAX_PUSH_ITEMS: 20,
  PULL_MAX_ITEMS: 50,
  PULL_MAX_BYTES: 262_144,
};

export function readLimits(env: Record<string, unknown>): Limits {
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(out) as (keyof Limits)[]) {
    const raw = env[k];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
  }
  return out;
}
