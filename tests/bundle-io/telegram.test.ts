import { describe, it, expect, vi } from 'vitest';
import { encryptBundle } from '../../src/lib/bundle/crypto';
import {
  sendDocument, sendMessage, getMe, bundleFileName, maskSecrets, loadTelegram, saveTelegram, TelegramError, TG_UPLOAD_LIMIT, defaultTelegram,
} from '../../src/lib/bundle/telegram';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const cfg = { token: TOKEN, chatId: '-100123' };

const ok = (result: unknown = {}) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const fail = (status: number, description: string, extra: object = {}) =>
  new Response(JSON.stringify({ ok: false, error_code: status, description, ...extra }), { status });
const mockFetch = (res: Response | Error) =>
  vi.fn(async (..._a: unknown[]) => { if (res instanceof Error) throw res; return res; });
const asFetch = (f: ReturnType<typeof mockFetch>) => f as unknown as typeof fetch;

async function mwb(n = 100) { return encryptBundle(new Uint8Array(n).fill(7), 'k'); }

describe('telegram', () => {
  it('sendDocument: URL·multipart 필드·파일명', async () => {
    const f = mockFetch(ok());
    const bytes = await mwb();
    const r = await sendDocument(cfg, bytes, { filename: 'md-works-20260101-0930.mwb', caption: '캡션' }, asFetch(f));
    expect(r).toEqual({ filename: 'md-works-20260101-0930.mwb', size: bytes.length });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendDocument`);
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('-100123');
    expect(form.get('caption')).toBe('캡션');
    const doc = form.get('document') as File;
    expect(doc.name).toBe('md-works-20260101-0930.mwb');
    expect(doc.size).toBe(bytes.length);
  });

  it('파일명 형식 md-works-YYYYMMDD-HHmm.mwb', () => {
    expect(bundleFileName(new Date(2026, 0, 5, 9, 7))).toBe('md-works-20260105-0907.mwb');
    expect(bundleFileName(new Date(2026, 11, 31, 23, 59), 'zip')).toBe('md-works-20261231-2359.zip');
  });

  it('50MB 초과는 요청 전에 거부하고 크기를 알린다', async () => {
    const f = mockFetch(ok());
    const big = new Uint8Array(TG_UPLOAD_LIMIT + 1);
    big.set([0x4d, 0x57, 0x42, 0x31]); // 매직만 맞춘 가짜 암호화 바이트
    const e = await sendDocument(cfg, big, {}, asFetch(f)).catch((x) => x);
    expect(e).toBeInstanceOf(TelegramError);
    expect(e.kind).toBe('too-large');
    expect(e.message).toMatch(/50\.0MB/);
    expect(f.mock.calls.length).toBe(0);
  });

  it('평문(암호화되지 않은) 바이트는 올리지 않는다', async () => {
    const f = mockFetch(ok());
    const e = await sendDocument(cfg, new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), {}, asFetch(f)).catch((x) => x);
    expect(e.kind).toBe('plaintext');
    expect(f.mock.calls.length).toBe(0);
  });

  it('토큰·chat_id 가 비면 config 오류', async () => {
    const f = asFetch(mockFetch(ok()));
    expect((await sendMessage({ token: '', chatId: '1' }, 'x', f).catch((x) => x)).kind).toBe('config');
    expect((await sendMessage({ token: TOKEN, chatId: ' ' }, 'x', f).catch((x) => x)).kind).toBe('config');
    expect((await getMe({ token: '' }, f).catch((x) => x)).kind).toBe('config');
  });

  it('getMe / sendMessage 요청 구성', async () => {
    const f1 = mockFetch(ok({ id: 1, username: 'mybot' }));
    expect((await getMe(cfg, asFetch(f1))).username).toBe('mybot');
    expect(f1.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    const f2 = mockFetch(ok());
    await sendMessage(cfg, '연결 테스트', asFetch(f2));
    const form = (f2.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.get('text')).toBe('연결 테스트');
    expect(form.get('chat_id')).toBe('-100123');
  });

  it('오류 매핑: 401/403/429/chat not found/기타', async () => {
    const m = async (res: Response) => (await getMe(cfg, asFetch(mockFetch(res))).catch((x) => x)) as TelegramError;
    expect((await m(fail(401, 'Unauthorized'))).message).toMatch(/토큰이 올바르지/);
    expect((await m(fail(403, 'Forbidden: bot was blocked'))).message).toMatch(/차단/);
    expect((await m(fail(429, 'Too Many Requests', { parameters: { retry_after: 7 } }))).message).toMatch(/7초/);
    expect((await m(fail(400, 'Bad Request: chat not found'))).message).toMatch(/chat_id/);
    const other = await m(fail(500, 'boom'));
    expect(other.kind).toBe('api');
    expect(other.status).toBe(500);
    expect(other.message).toMatch(/boom/);
  });

  it('네트워크 오류는 network 로 매핑하고 메시지의 토큰을 가린다', async () => {
    const f = mockFetch(new TypeError(`Failed to fetch https://api.telegram.org/bot${TOKEN}/sendMessage`));
    const e = (await sendMessage(cfg, 'x', asFetch(f)).catch((x) => x)) as TelegramError;
    expect(e.kind).toBe('network');
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain('AAHdqTcv');
    expect(e.message).toMatch(/CORS/);
  });

  it('API 설명에 토큰이 섞여도 가린다', async () => {
    const e = (await getMe(cfg, asFetch(mockFetch(fail(502, `bad gateway for bot${TOKEN}`)))).catch((x) => x)) as TelegramError;
    expect(e.message).not.toContain(TOKEN);
  });

  it('maskSecrets', () => {
    expect(maskSecrets(`GET /bot${TOKEN}/x`)).toBe('GET /bot***/x');
    expect(maskSecrets(`token=${TOKEN}`, TOKEN)).not.toContain(TOKEN);
    expect(maskSecrets('plain')).toBe('plain');
  });

  it('설정 저장: works.telegram 에 토큰·chat_id·자동 설정만, 간격은 최소 5분', () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadTelegram(st)).toEqual(defaultTelegram());
    expect(defaultTelegram().intervalMin).toBe(30);
    saveTelegram({ token: 't', chatId: 'c', auto: true, intervalMin: 45 }, st);
    expect([...store.keys()]).toEqual(['works.telegram']);
    expect(loadTelegram(st)).toEqual({ token: 't', chatId: 'c', auto: true, intervalMin: 45 });
    store.set('works.telegram', JSON.stringify({ token: 't', intervalMin: 2 }));
    expect(loadTelegram(st).intervalMin).toBe(30);
  });
});
