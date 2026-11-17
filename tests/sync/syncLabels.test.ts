import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/lib/sync/protocol';
import { groupKeyInput, isNearLimit, phaseLabel, phaseTone, problemTitle, usageRatio } from '../../src/lib/sync/syncLabels';

describe('phaseLabel', () => {
  it('단계별 문구', () => {
    expect(phaseLabel({ phase: 'idle' })).toContain('최신');
    expect(phaseLabel({ phase: 'syncing' })).toContain('동기화하는 중');
    expect(phaseLabel({ phase: 'offline' })).toContain('오프라인');
  });
  it('오류·멈춤은 문제 제목을 붙인다', () => {
    const lastError = { kind: 'unauthorized' as const, message: 'x' };
    expect(phaseLabel({ phase: 'error', lastError })).toContain('키를 확인하세요');
    expect(phaseLabel({ phase: 'paused', lastError })).toContain('키를 확인하세요');
    expect(phaseLabel({ phase: 'paused' })).toBe('멈춤');
  });
  it('tone', () => {
    expect(phaseTone('idle')).toBe('ok');
    expect(phaseTone('error')).toBe('error');
    expect(phaseTone('paused')).toBe('muted');
  });
});

describe('problemTitle', () => {
  it('모든 종류에 제목이 있다', () => {
    const kinds = ['unauthorized', 'forbidden', 'rate-limited', 'unavailable', 'item-too-large', 'space-full', 'item-limit', 'crypto', 'network', 'mass-delete'] as const;
    for (const kind of kinds) expect(problemTitle({ kind }).length).toBeGreaterThan(0);
  });
});

describe('usageRatio', () => {
  it('없으면 0', () => {
    expect(usageRatio(undefined)).toEqual({ items: 0, bytes: 0, writes: 0 });
  });
  it('비율과 상한 자르기', () => {
    const r = usageRatio({ items: LIMITS.MAX_ITEMS_PER_SPACE / 2, bytes: LIMITS.MAX_SPACE_BYTES * 2, dailyWrites: 0 });
    expect(r.items).toBeCloseTo(0.5);
    expect(r.bytes).toBe(1);
    expect(r.writes).toBe(0);
  });
  it('80% 경계', () => {
    expect(isNearLimit(0.79)).toBe(false);
    expect(isNearLimit(0.8)).toBe(true);
  });
});

describe('groupKeyInput', () => {
  it('공백·하이픈·소문자를 정리해 4자씩 끊는다', () => {
    expect(groupKeyInput('abcd efgh-ijkm')).toBe('ABCD-EFGH-1JKM');
  });
  it('I·L→1, O→0', () => {
    expect(groupKeyInput('ILO0')).toBe('1100');
  });
  it('26자에서 자른다', () => {
    const out = groupKeyInput('A'.repeat(40));
    expect(out.replace(/-/g, '')).toHaveLength(26);
    expect(out.split('-').pop()).toHaveLength(2);
  });
  it('빈 입력', () => {
    expect(groupKeyInput('')).toBe('');
    expect(groupKeyInput('---')).toBe('');
  });
});
