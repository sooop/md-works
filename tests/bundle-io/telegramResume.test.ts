// 텔레그램 재시도 정책(429·5xx·네트워크만)과 이어 올리기. fetch·sleep 을 주입해 느려지지 않게 한다.
import { describe, it, expect, vi } from 'vitest';
import { encryptBundle } from '../../src/lib/bundle/crypto';
import {
  MAX_RETRY_AFTER_S, RETRY_DELAY_MS, TelegramError, retryWaitMs, sendBundle, sendDocument, sha256Hex, sha256Prefix12,
} from '../../src/lib/bundle/telegram';
import {
  MAX_BACKOFF_MS, MIN_MS, afterFailure, backoffMs, checkResumeMatch, isUploadDue, remainingParts, resumeMissesChanges,
  concatBytes, type ResumeInfo, type UploadProgress,
} from '../../src/lib/bundle/backupLogic';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const cfg = { token: TOKEN, chatId: '-100123' };
const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
const fail = (status: number, extra: object = {}) => new Response(JSON.stringify({ ok: false, description: `err ${status}`, ...extra }), { status });
const asFetch = (f: unknown) => f as typeof fetch;
const enc = (n: number) => encryptBundle(new Uint8Array(n).fill(5), 'k');
const formOf = (call: unknown[]) => (call[1] as RequestInit).body as FormData;
/** 응답을 차례로 돌려주고, 다 쓰면 마지막 것을 계속 돌려주는 fetch */
const seq = (...rs: (() => Response | Promise<never>)[]) => {
  let i = 0;
  return vi.fn(async () => rs[Math.min(i++, rs.length - 1)]());
};
const netErr = () => Promise.reject(new TypeError('Failed to fetch'));

describe('retryWaitMs: 무엇을 얼마나 기다렸다 재시도하는가', () => {
  const api = (status: number, retryAfter?: number) => new TelegramError('api', 'x', status, retryAfter);
  it('401·403·404·413·400 은 재시도하지 않는다', () => {
    for (const s of [400, 401, 403, 404, 413]) expect(retryWaitMs(api(s), 1500)).toBeNull();
  });
  it('5xx·네트워크는 기본 간격, 429 는 retry_after(초, 상한 60)', () => {
    expect(retryWaitMs(api(500), 1500)).toBe(1500);
    expect(retryWaitMs(api(503), 10)).toBe(10);
    expect(retryWaitMs(new TelegramError('network', 'x'), 1500)).toBe(1500);
    expect(retryWaitMs(api(429, 7))).toBe(7000);
    expect(retryWaitMs(api(429, 9999))).toBe(MAX_RETRY_AFTER_S * 1000);
    expect(retryWaitMs(api(429))).toBe(RETRY_DELAY_MS); // retry_after 가 없으면 기본 간격
  });
  it('설정·평문·크기 오류와 알 수 없는 예외는 재시도하지 않는다', () => {
    expect(retryWaitMs(new TelegramError('config', 'x'))).toBeNull();
    expect(retryWaitMs(new TelegramError('plaintext', 'x'))).toBeNull();
    expect(retryWaitMs(new TelegramError('too-large', 'x'))).toBeNull();
    expect(retryWaitMs(new Error('boom'))).toBeNull();
  });
});

describe('단일 파일(sendDocument) 재시도', () => {
  it.each([401, 403, 413])('%i 는 한 번만 부르고 기다리지 않는다', async (status) => {
    const f = seq(() => fail(status));
    const sleep = vi.fn(async () => {});
    const e = (await sendDocument(cfg, await enc(50), { sleep }, asFetch(f)).catch((x) => x)) as TelegramError;
    expect(e.status).toBe(status);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429 는 retry_after 만큼 기다린 뒤 1회 재시도해 성공한다', async () => {
    const f = seq(() => fail(429, { parameters: { retry_after: 7 } }), ok);
    const sleep = vi.fn(async () => {});
    await sendDocument(cfg, await enc(50), { sleep }, asFetch(f));
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('retry_after 가 아주 크면 60초까지만 기다린다', async () => {
    const f = seq(() => fail(429, { parameters: { retry_after: 3600 } }), ok);
    const sleep = vi.fn(async () => {});
    await sendDocument(cfg, await enc(50), { sleep }, asFetch(f));
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('5xx·네트워크 오류는 1회만 재시도하고, 또 실패하면 던진다', async () => {
    const sleep = vi.fn(async () => {});
    const f1 = seq(() => fail(502), ok);
    await sendDocument(cfg, await enc(50), { sleep, retryDelayMs: 25 }, asFetch(f1));
    expect(sleep).toHaveBeenCalledWith(25);
    const f2 = seq(netErr, netErr, ok);
    const e = (await sendDocument(cfg, await enc(50), { sleep }, asFetch(f2)).catch((x) => x)) as TelegramError;
    expect(e.kind).toBe('network');
    expect(f2).toHaveBeenCalledTimes(2);
  });

  it('sendBundle 단일 경로도 같은 정책을 쓴다', async () => {
    const bytes = await enc(50);
    const sleep = vi.fn(async () => {});
    const f = seq(() => fail(429, { parameters: { retry_after: 2 } }), ok);
    const r = await sendBundle(cfg, bytes, { filename: 'a.mwb', sleep }, asFetch(f));
    expect(r.parts).toBe(1);
    expect(sleep).toHaveBeenCalledWith(2000);
    const g = seq(() => fail(401));
    await expect(sendBundle(cfg, bytes, { filename: 'a.mwb', sleep }, asFetch(g))).rejects.toMatchObject({ status: 401 });
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe('조각 업로드 재시도', () => {
  it('401 이면 재시도 없이 바로 중단한다', async () => {
    const bytes = await enc(2500);
    const sleep = vi.fn(async () => {});
    const f = seq(() => fail(401));
    const e = (await sendBundle(cfg, bytes, { filename: 'a.mwb', limit: 1000, sleep }, asFetch(f)).catch((x) => x)) as TelegramError;
    expect(e.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(e.resume).toBeUndefined(); // 한 조각도 못 올렸으면 이어 올릴 것이 없다
  });

  it('429 는 retry_after 를 기다린 뒤 같은 조각을 다시 보낸다', async () => {
    const bytes = await enc(1500);
    const sleep = vi.fn(async () => {});
    const f = seq(ok, () => fail(429, { parameters: { retry_after: 11 } }), ok);
    const r = await sendBundle(cfg, bytes, { filename: 'a.mwb', limit: 1000, sleep }, asFetch(f));
    expect(r.parts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(11_000);
    expect((formOf(f.mock.calls[2] as unknown[]).get('document') as File).name).toBe('a.mwb.002');
  });

  it('403·413 은 도중에도 재시도하지 않는다', async () => {
    for (const status of [403, 413]) {
      const sleep = vi.fn(async () => {});
      const f = seq(ok, () => fail(status));
      const e = (await sendBundle(cfg, await enc(2500), { filename: 'a.mwb', limit: 1000, sleep }, asFetch(f)).catch((x) => x)) as TelegramError;
      expect(e.status).toBe(status);
      expect(f).toHaveBeenCalledTimes(2);
      expect(sleep).not.toHaveBeenCalled();
    }
  });
});

describe('이어 올리기 (sendBundle resume)', () => {
  const limit = 1000;

  async function failAtThird() {
    const bytes = await enc(2500); // 3조각
    const sent: [string, string | null][] = [];
    const f = vi.fn(async (...a: unknown[]) => {
      const form = formOf(a as unknown[] as [string, RequestInit]);
      const name = (form.get('document') as File).name;
      if (name.endsWith('.003')) return fail(500);
      sent.push([name, form.get('caption') as string | null]);
      return ok();
    });
    const e = (await sendBundle(cfg, bytes, { filename: 'a.mwb', caption: '백업', limit, sleep: async () => {} }, asFetch(f)).catch((x) => x)) as TelegramError;
    return { bytes, e, sent };
  }

  it('실패 오류가 어떤 번들(SHA-256)의 몇 조각까지 올랐는지 알려 준다', async () => {
    const { bytes, e } = await failAtThird();
    expect(e.resume).toEqual({ sha256: await sha256Hex(bytes), filename: 'a.mwb', size: bytes.length, total: 3, done: 2 });
    expect(e.message).toContain('조각 3/3');
  });

  it('남은 조각만 올리고, 이름·caption 형식은 처음과 같다', async () => {
    const { bytes, e, sent } = await failAtThird();
    const f = vi.fn(async () => ok());
    const prog: string[] = [];
    const r = await sendBundle(cfg, bytes, { caption: '백업', limit, resume: e.resume, onProgress: (d, t) => prog.push(`${d}/${t}`) }, asFetch(f));
    expect(f).toHaveBeenCalledTimes(1);
    const form = formOf(f.mock.calls[0] as unknown[]);
    expect((form.get('document') as File).name).toBe('a.mwb.003');
    const sha12 = await sha256Prefix12(bytes);
    expect(form.get('caption')).toBe(`백업 · 3/3 · 전체 ${(bytes.length / 1024 / 1024).toFixed(1)}MB · SHA-256 ${sha12}`);
    // 첫 시도에서 보낸 조각의 caption 과 같은 틀(번호만 다르다)
    expect(sent[0][1]).toBe(`백업 · 1/3 · 전체 ${(bytes.length / 1024 / 1024).toFixed(1)}MB · SHA-256 ${sha12}`);
    expect(r).toEqual({ filenames: ['a.mwb.001', 'a.mwb.002', 'a.mwb.003'], size: bytes.length, parts: 3 });
    expect(prog).toEqual(['2/3', '3/3']);
  });

  it('올라간 조각 + 이어 올린 조각을 이으면 원본 바이트다', async () => {
    const { bytes, e } = await failAtThird();
    const parts: Uint8Array[] = [];
    const first = vi.fn(async (...a: unknown[]) => { parts.push(new Uint8Array(await ((formOf(a as never).get('document') as File).arrayBuffer()))); return ok(); });
    // 앞 두 조각은 첫 시도에서 이미 올라갔다고 보고 같은 분할을 직접 만든다
    parts.push(bytes.slice(0, limit), bytes.slice(limit, 2 * limit));
    await sendBundle(cfg, bytes, { limit, resume: e.resume }, asFetch(first));
    expect(concatBytes(parts)).toEqual(bytes);
  });

  it('이어 올리다 또 실패하면 그 시점의 진행을 새로 알린다', async () => {
    const bytes = await enc(3500); // 4조각
    const f1 = vi.fn(async (...a: unknown[]) => ((formOf(a as never).get('document') as File).name.endsWith('.002') ? fail(403) : ok()));
    const e1 = (await sendBundle(cfg, bytes, { filename: 'a.mwb', limit }, asFetch(f1)).catch((x) => x)) as TelegramError;
    expect(e1.resume?.done).toBe(1);
    const f2 = vi.fn(async (...a: unknown[]) => ((formOf(a as never).get('document') as File).name.endsWith('.004') ? fail(403) : ok()));
    const e2 = (await sendBundle(cfg, bytes, { limit, resume: e1.resume }, asFetch(f2)).catch((x) => x)) as TelegramError;
    expect(e2.resume).toMatchObject({ done: 3, total: 4, filename: 'a.mwb' });
    expect(f2).toHaveBeenCalledTimes(3); // 2·3·4번만
  });

  it('다른 바이트(다시 암호화한 번들)로는 이어 올리지 않는다 — 요청 0건', async () => {
    const { e } = await failAtThird();
    const other = await enc(2500); // 같은 평문이라도 IV 가 달라 바이트가 다르다
    const f = vi.fn(async () => ok());
    const err = (await sendBundle(cfg, other, { limit, resume: e.resume }, asFetch(f)).catch((x) => x)) as TelegramError;
    expect(err.kind).toBe('config');
    expect(err.message).toMatch(/다른 바이트/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('이어 올리기·백오프 순수 로직', () => {
  const p: UploadProgress = { sha256: 'a'.repeat(64), filename: 'a.mwb', size: 100, total: 5, done: 2 };

  it('remainingParts: 남은 조각 번호(1부터)', () => {
    expect(remainingParts(5, 2)).toEqual([3, 4, 5]);
    expect(remainingParts(3, 0)).toEqual([1, 2, 3]);
    expect(remainingParts(3, 3)).toEqual([]);
    expect(remainingParts(3, 9)).toEqual([]);
  });

  it('checkResumeMatch: 같은 번들만 통과', () => {
    const same = { sha256: p.sha256, size: 100, total: 5 };
    expect(checkResumeMatch(p, same)).toBeNull();
    expect(checkResumeMatch(p, { ...same, sha256: 'b'.repeat(64) })).toMatch(/다른 바이트/);
    expect(checkResumeMatch(p, { ...same, size: 101 })).toMatch(/다른 바이트/);
    expect(checkResumeMatch(p, { ...same, total: 6 })).toMatch(/조각 수/);
    expect(checkResumeMatch({ ...p, done: 5 }, same)).toMatch(/이어 올릴 조각이 없/);
    expect(checkResumeMatch({ ...p, done: 0 }, same)).toMatch(/이어 올릴 조각이 없/);
  });

  it('afterFailure: 진행이 있으면 저장, 없으면 있던 값 유지, 줄어들지 않는다', () => {
    const r = afterFailure(null, p, '캡션', 1234)!;
    expect(r).toEqual({ ...p, caption: '캡션', startedAt: 1234 });
    expect(afterFailure(r, undefined, 'x', 9)).toBe(r);
    expect(afterFailure(null, undefined, 'x', 9)).toBeNull();
    expect(afterFailure(r, { ...p, done: 4 }, '캡션', 1234)!.done).toBe(4);
    expect(afterFailure(r, { ...p, done: 1 }, '캡션', 1234)).toBe(r);
    // 다른 번들의 실패는 새 정보로 바뀐다
    expect(afterFailure(r, { ...p, sha256: 'c'.repeat(64), done: 1 }, 'n', 5)).toMatchObject({ sha256: 'c'.repeat(64), done: 1, startedAt: 5 });
  });

  it('resumeMissesChanges: 번들을 만든 뒤 변경이 있을 때만 안내', () => {
    const r: ResumeInfo = { ...p, caption: '', startedAt: 1000 };
    expect(resumeMissesChanges(r, 1000)).toBe(false);
    expect(resumeMissesChanges(r, 1001)).toBe(true);
    expect(resumeMissesChanges(r, 0)).toBe(false);
  });

  it('backoffMs: 간격 × 2, 4, 8 … 최대 6시간, 설정 간격이 더 길면 그 간격', () => {
    const base = 30 * MIN_MS;
    expect(backoffMs(30, 0)).toBe(base);
    expect(backoffMs(30, 1)).toBe(2 * base);
    expect(backoffMs(30, 2)).toBe(4 * base);
    expect(backoffMs(30, 3)).toBe(8 * base);
    expect(backoffMs(30, 4)).toBe(MAX_BACKOFF_MS); // 16배 = 8시간 → 6시간
    expect(backoffMs(30, 99)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(600, 3)).toBe(600 * MIN_MS); // 설정 간격(10시간)이 상한보다 길면 줄이지 않는다
  });

  it('isUploadDue: 연속 실패면 늘어난 간격이 지나야 다시 시도한다, 성공(0)이면 원래 간격', () => {
    const NOW = 10 * 3600_000;
    const base = { now: NOW, lastChange: NOW - 1000, lastSuccess: 1, lastAttempt: NOW - 45 * MIN_MS, intervalMin: 30 };
    expect(isUploadDue(base)).toBe(true);
    expect(isUploadDue({ ...base, failures: 0 })).toBe(true);
    expect(isUploadDue({ ...base, failures: 1 })).toBe(false); // 60분 필요
    expect(isUploadDue({ ...base, failures: 1, lastAttempt: NOW - 61 * MIN_MS })).toBe(true);
    expect(isUploadDue({ ...base, failures: 3, lastAttempt: NOW - 61 * MIN_MS })).toBe(false); // 240분 필요
  });
});
