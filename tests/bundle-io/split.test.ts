import { describe, it, expect, vi } from 'vitest';
import { encryptBundle, decryptBundle } from '../../src/lib/bundle/crypto';
import {
  CHUNK_LIMIT, MAX_PARTS, splitBytes, partFileName, partCaption, parsePartName, planImport, concatBytes,
} from '../../src/lib/bundle/backupLogic';
import { sendBundle, sha256Prefix12, TelegramError } from '../../src/lib/bundle/telegram';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const cfg = { token: TOKEN, chatId: '-100123' };
const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
const fail = (status: number, description: string) => new Response(JSON.stringify({ ok: false, description }), { status });
const asFetch = (f: unknown) => f as typeof fetch;

describe('splitBytes', () => {
  it('정확히 한도는 1개, 한도+1 은 2개', () => {
    expect(splitBytes(new Uint8Array(10), 10).map((c) => c.length)).toEqual([10]);
    expect(splitBytes(new Uint8Array(11), 10).map((c) => c.length)).toEqual([10, 1]);
    expect(splitBytes(new Uint8Array(20), 10).map((c) => c.length)).toEqual([10, 10]);
  });
  it('0바이트 거부, 조각 수 상한 초과 거부', () => {
    expect(() => splitBytes(new Uint8Array(0), 10)).toThrow(/빈 번들/);
    expect(() => splitBytes(new Uint8Array(10 * MAX_PARTS), 10)).not.toThrow();
    expect(() => splitBytes(new Uint8Array(10 * MAX_PARTS + 1), 10)).toThrow(/상한 20개/);
  });
  it('기본 한도는 45MB', () => {
    expect(CHUNK_LIMIT).toBe(45 * 1024 * 1024);
  });
  it('이어 붙이면 원본과 바이트 동일', () => {
    const src = Uint8Array.from({ length: 1003 }, (_, i) => (i * 31) & 255);
    expect(concatBytes(splitBytes(src, 100))).toEqual(src);
  });
});

describe('파일명·caption', () => {
  it('3자리 번호', () => {
    expect(partFileName('md-works-20260101-0930.mwb', 1)).toBe('md-works-20260101-0930.mwb.001');
    expect(partFileName('a.mwb', 12)).toBe('a.mwb.012');
    expect(parsePartName('a.mwb.012')).toEqual({ stem: 'a.mwb', index: 12 });
    expect(parsePartName('a.mwb')).toBeNull();
    expect(parsePartName('a.mwb.000')).toBeNull();
    expect(parsePartName('a.zip.001')).toBeNull();
  });
  it('caption 에 i/n·전체 크기·해시', () => {
    expect(partCaption('백업', 2, 3, 100 * 1024 * 1024, 'abcdef012345')).toBe('백업 · 2/3 · 전체 100.0MB · SHA-256 abcdef012345');
  });
});

describe('planImport', () => {
  const f = (...names: string[]) => names.map((name) => ({ name }));
  const S = 'md-works-20260101-0930.mwb';
  it('단일 파일은 그대로', () => {
    expect(planImport(f('a.mwb'))).toEqual({ ok: true, kind: 'single', file: { name: 'a.mwb' } });
    expect(planImport(f('a.zip')).ok).toBe(true);
  });
  it('순서가 뒤섞여도 번호순', () => {
    const p = planImport(f(`${S}.003`, `${S}.001`, `${S}.002`));
    expect(p.ok && p.kind === 'parts' && p.parts.map((x) => x.name)).toEqual([`${S}.001`, `${S}.002`, `${S}.003`]);
  });
  it('누락·중복·stem 불일치·하나뿐·혼합 오류', () => {
    const miss = planImport(f(`${S}.001`, `${S}.003`));
    expect(!miss.ok && miss.error).toMatch(/002/);
    const dup = planImport(f(`${S}.001`, `${S}.002`, `${S}.002`));
    expect(!dup.ok && dup.error).toMatch(/중복.*002/);
    const stem = planImport(f(`${S}.001`, 'other.mwb.002'));
    expect(!stem.ok && stem.error).toMatch(/섞여/);
    const one = planImport(f(`${S}.001`));
    expect(!one.ok && one.error).toMatch(/하나뿐/);
    const first = planImport(f(`${S}.002`));
    expect(!first.ok && first.error).toMatch(/001/);
    expect(planImport(f(`${S}.001`, `${S}.002`, 'a.mwb')).ok).toBe(false);
    expect(planImport(f('a.mwb', 'b.mwb')).ok).toBe(false);
  });
});

describe('암호화 번들 분할·조립 왕복', () => {
  it('조립한 바이트가 원본과 같고 복호화된다', async () => {
    const plain = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
    const enc = await encryptBundle(plain, 'k');
    const chunks = splitBytes(enc, 1000);
    const names = chunks.map((_, i) => ({ name: partFileName('x.mwb', i + 1), bytes: chunks[i] })).reverse();
    const plan = planImport(names);
    if (!plan.ok || plan.kind !== 'parts') throw new Error('plan');
    const joined = concatBytes(plan.parts.map((p) => p.bytes));
    expect(joined).toEqual(enc);
    expect(await decryptBundle(joined, 'k')).toEqual(plain);
  });
});

describe('sendBundle', () => {
  async function enc(n: number) { return encryptBundle(new Uint8Array(n).fill(9), 'k'); }
  const fileOf = (call: unknown[]) => ((call[1] as RequestInit).body as FormData);

  it('한도 이하는 단일 파일 한 번', async () => {
    const bytes = await enc(100);
    const f = vi.fn(async () => ok());
    const r = await sendBundle(cfg, bytes, { filename: 'a.mwb', limit: bytes.length }, asFetch(f));
    expect(r).toEqual({ filenames: ['a.mwb'], size: bytes.length, parts: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    expect((fileOf(f.mock.calls[0] as unknown[]).get('document') as File).name).toBe('a.mwb');
  });

  it('한도 초과는 순서대로 조각 업로드, 이름·caption·진행', async () => {
    const bytes = await enc(2500);
    const limit = 1000;
    const f = vi.fn(async () => ok());
    const prog: string[] = [];
    const r = await sendBundle(cfg, bytes, { filename: 'a.mwb', caption: '백업', limit, onProgress: (d, t) => prog.push(`${d}/${t}`) }, asFetch(f));
    const n = Math.ceil(bytes.length / limit);
    expect(r.parts).toBe(n);
    expect(r.filenames).toEqual(Array.from({ length: n }, (_, i) => `a.mwb.00${i + 1}`));
    const sha = await sha256Prefix12(bytes);
    const sent: Uint8Array[] = [];
    f.mock.calls.forEach((c, i) => {
      const form = fileOf(c as unknown[]);
      expect((form.get('document') as File).name).toBe(`a.mwb.00${i + 1}`);
      expect(form.get('caption')).toContain(`${i + 1}/${n}`);
      expect(form.get('caption')).toContain(sha);
    });
    for (const c of f.mock.calls) sent.push(new Uint8Array(await ((fileOf(c as unknown[]).get('document') as File).arrayBuffer())));
    expect(concatBytes(sent)).toEqual(bytes);
    expect(prog[0]).toBe(`0/${n}`);
    expect(prog.at(-1)).toBe(`${n}/${n}`);
  });

  it('조각 실패는 1회 재시도 후 성공하면 계속', async () => {
    const bytes = await enc(1500);
    let n = 0;
    const f = vi.fn(async () => (++n === 2 ? fail(500, 'boom') : ok()));
    const r = await sendBundle(cfg, bytes, { filename: 'a.mwb', limit: 1000, retryDelayMs: 0 }, asFetch(f));
    expect(r.parts).toBe(2);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('재시도도 실패하면 중단하고 어디까지 올라갔는지 알린다(토큰 마스킹)', async () => {
    const bytes = await enc(2500);
    let n = 0;
    const f = vi.fn(async () => (++n >= 2 ? fail(502, `bad gateway bot${TOKEN}`) : ok()));
    const e = (await sendBundle(cfg, bytes, { filename: 'a.mwb', limit: 1000, retryDelayMs: 0 }, asFetch(f)).catch((x) => x)) as TelegramError;
    expect(e).toBeInstanceOf(TelegramError);
    expect(e.kind).toBe('api');
    expect(e.message).toMatch(/조각 2\/3/);
    expect(e.message).toMatch(/1\/3개 조각/);
    expect(e.message).toContain('a.mwb.001');
    expect(e.message).not.toContain(TOKEN);
    expect(f).toHaveBeenCalledTimes(3); // 1번 성공 + 2번 실패 2회
  });

  it('첫 조각 실패, 상한 초과, 평문 거부', async () => {
    const f = vi.fn(async () => fail(500, 'x'));
    const bytes = await enc(1500);
    const e1 = (await sendBundle(cfg, bytes, { limit: 1000, retryDelayMs: 0 }, asFetch(f)).catch((x) => x)) as TelegramError;
    expect(e1.message).toMatch(/첫 조각부터/);
    const e2 = (await sendBundle(cfg, bytes, { limit: 10 }, asFetch(f)).catch((x) => x)) as TelegramError;
    expect(e2.kind).toBe('too-large');
    const e3 = (await sendBundle(cfg, new Uint8Array(2000), { limit: 1000 }, asFetch(f)).catch((x) => x)) as TelegramError;
    expect(e3.kind).toBe('plaintext');
  });
});
