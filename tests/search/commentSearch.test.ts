import { describe, it, expect } from 'vitest';
import { searchComments } from '../../src/lib/search/commentSearch';
import type { Thread } from '../../src/lib/works/types';

const T = (id: string, docKey: string, texts: string[], over: Partial<Thread> = {}): Thread => ({
  id, docKey, anchor: { quote: 'q', prefix: '', suffix: '' },
  messages: texts.map((text, i) => ({ id: `${id}-${i}`, text, ts: i })), resolved: false, createdAt: 1, updatedAt: 1, ...over,
});

/** 파티션별 메모리 저장소 */
const fake = (data: Record<string, Thread[]>) => ({
  list: (async (_c: string, part?: string) => data[part ?? ''] ?? []) as never,
  parts: (async () => Object.keys(data).filter((k) => data[k].length)) as never,
});
const O = { caseSensitive: false, regex: false };
const docs = [{ id: 'a', label: '가' }, { id: 'b', label: '나' }];

describe('searchComments', () => {
  it('일치한 메시지를 문서·스레드와 함께 돌려주고 구간을 표시한다', async () => {
    const s = fake({ a: [T('t1', 'a', ['처음', '여기 Hello 있음'])], b: [T('t2', 'b', ['없음'])] });
    const r = await searchComments(s, docs, 'hello', O);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ docId: 'a', label: '가', threadId: 't1', resolved: false });
    const [[a, b]] = r[0].ranges;
    expect(r[0].snippet.slice(a, b)).toBe('Hello');
  });
  it('대소문자 구분 옵션', async () => {
    const s = fake({ a: [T('t1', 'a', ['Hello'])] });
    expect(await searchComments(s, docs, 'hello', { ...O, caseSensitive: true })).toHaveLength(0);
    expect(await searchComments(s, docs, 'Hello', { ...O, caseSensitive: true })).toHaveLength(1);
  });
  it('정규식 옵션과 오류', async () => {
    const s = fake({ a: [T('t1', 'a', ['abc123'])] });
    expect(await searchComments(s, docs, '[0-9]+', { ...O, regex: true })).toHaveLength(1);
    expect(await searchComments(s, docs, '[0-9]+', O)).toHaveLength(0);
    await expect(searchComments(s, docs, '(', { ...O, regex: true })).rejects.toThrow('정규식 오류');
    await expect(searchComments(s, docs, '', O)).rejects.toThrow();
  });
  it('스레드당 한 건, 해결됨 표시, 삭제된 스레드 제외', async () => {
    const s = fake({ a: [
      T('t1', 'a', ['x 하나', 'x 둘'], { resolved: true }),
      T('t2', 'a', ['x'], { deletedAt: 5 }),
    ] });
    const r = await searchComments(s, docs, 'x', O);
    expect(r.map((h) => h.threadId)).toEqual(['t1']);
    expect(r[0].resolved).toBe(true);
  });
  it('상한에서 멈춘다', async () => {
    const many = Array.from({ length: 10 }, (_, i) => T(`t${i}`, 'a', ['x']));
    const s = fake({ a: many, b: [T('tb', 'b', ['x'])] });
    expect(await searchComments(s, docs, 'x', O, 3)).toHaveLength(3);
  });
  it('스레드가 없는 문서는 읽지 않고, 결과는 문서 순서를 지키며, 동시에 6개까지만 읽는다', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => 'd' + i);
    const data: Record<string, Thread[]> = {};
    for (const id of ids) if (id !== 'd3') data[id] = [T('t-' + id, id, ['x'])];
    let active = 0, peak = 0;
    const read: string[] = [];
    const s = {
      parts: (async () => Object.keys(data)) as never,
      // 뒤쪽 문서일수록 먼저 끝나게 해 순서가 읽기 완료 순서에 따라 흔들리지 않는지 본다
      list: (async (_c: string, part?: string) => {
        read.push(part!); active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20 - Number(part!.slice(1))));
        active--; return data[part!];
      }) as never,
    };
    const all = [...ids.map((id) => ({ id, label: id })), { id: 'none', label: 'none' }];
    const r = await searchComments(s, all, 'x', O);
    expect(r.map((h) => h.docId)).toEqual(ids.filter((id) => id !== 'd3'));
    expect(read).not.toContain('d3');
    expect(read).not.toContain('none');
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });
});
