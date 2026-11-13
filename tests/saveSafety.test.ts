import { describe, it, expect } from 'vitest';
import {
  backoffMs, fitsKeepalive, KEEPALIVE_LIMIT, classifySaveError, conflictAction, goneAction, leaveAction,
  versionLabel, isStaleGen, saveBody,
} from '../src/lib/saveSafety';

describe('backoffMs', () => {
  it('2초에서 시작해 두 배씩 늘고 60초에서 멈춘다', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });
  it('비정상 입력도 2초 이상 60초 이하', () => {
    expect(backoffMs(0)).toBe(2000);
    expect(backoffMs(-3)).toBe(2000);
    expect(backoffMs(NaN)).toBe(2000);
    expect(backoffMs(1000)).toBe(60000);
  });
});

describe('fitsKeepalive', () => {
  it('작은 본문은 통과, 한도를 넘으면 실패', () => {
    expect(fitsKeepalive('a'.repeat(100))).toBe(true);
    expect(fitsKeepalive('a'.repeat(KEEPALIVE_LIMIT))).toBe(true);
    expect(fitsKeepalive('a'.repeat(KEEPALIVE_LIMIT + 1))).toBe(false);
  });
  it('한글은 바이트로 센다', () => {
    expect(fitsKeepalive('가'.repeat(KEEPALIVE_LIMIT / 3))).toBe(true);
    expect(fitsKeepalive('가'.repeat(KEEPALIVE_LIMIT / 3 + 1))).toBe(false);
  });
});

describe('classifySaveError', () => {
  it('409 conflict 는 mtime 을 싣는다', () => {
    expect(classifySaveError({ status: 409, body: { error: 'conflict', mtime: 123, message: 'm' } })).toEqual({ kind: 'conflict', mtime: 123, message: 'm' });
  });
  it('409 gone', () => {
    expect(classifySaveError({ status: 409, body: { error: 'gone', message: 'x' } })).toEqual({ kind: 'gone', message: 'x' });
  });
  it('다른 상태·본문은 other', () => {
    expect(classifySaveError({ status: 500, body: { error: 'conflict' } })).toEqual({ kind: 'other' });
    expect(classifySaveError({ status: 409, body: { error: 'exists' } })).toEqual({ kind: 'other' });
    expect(classifySaveError({ status: 409, body: null })).toEqual({ kind: 'other' });
    expect(classifySaveError(undefined)).toEqual({ kind: 'other' });
    expect(classifySaveError({})).toEqual({ kind: 'other' });
  });
  it('mtime 이 숫자가 아니면 버린다', () => {
    expect(classifySaveError({ status: 409, body: { error: 'conflict', mtime: '1' as never } })).toEqual({ kind: 'conflict', mtime: undefined, message: '' });
  });
});

describe('선택 결과 해석', () => {
  it('충돌', () => {
    expect([0, 1, 2, -1, 9].map(conflictAction)).toEqual(['overwrite', 'reload', 'cancel', 'cancel', 'cancel']);
  });
  it('사라짐', () => {
    expect([0, 1, 2, -1].map(goneAction)).toEqual(['recreate', 'close', 'cancel', 'cancel']);
  });
  it('이동', () => {
    expect([0, 1, 2, -1].map(leaveAction)).toEqual(['leave', 'copy', 'cancel', 'cancel']);
  });
});

describe('그 밖', () => {
  it('버전 이름', () => {
    const d = new Date(2026, 0, 2, 3, 4);
    expect(versionLabel('external', d)).toBe('외부 수정본 (2026-01-02 03:04)');
    expect(versionLabel('mine', d)).toContain('내 편집본');
    expect(versionLabel('gone', d)).toContain('삭제된 글');
    expect(versionLabel('tab', d)).toBe('다른 탭 수정본 (2026-01-02 03:04)');
  });
  it('세대 번호', () => {
    expect(isStaleGen(3, 3)).toBe(false);
    expect(isStaleGen(3, 4)).toBe(true);
  });
  it('저장 본문', () => {
    expect(saveBody('a', 5, false)).toEqual({ content: 'a', baseMtime: 5 });
    expect(saveBody('a', undefined, false)).toEqual({ content: 'a' });
    expect(saveBody('a', 5, true)).toEqual({ content: 'a', force: true });
  });
});
