// sync-kit 전환 호환성 고정: 값은 전환 전 md-works 자체 구현으로 계산해 고정했다. 하나라도 달라지면 배포된 기기의 데이터와 어긋난다.
import { describe, expect, it } from 'vitest';
import { contentHash as appContentHash } from '../../src/lib/bundle/merge';
import { contentHash as kitContentHash, deriveKeys, hashItem } from 'sync-kit';
import { createSyncAdapter, docItemId, kindOfId, snippetItemId, threadItemId } from '../../src/lib/sync/adapter';
import { standaloneDevice } from '../bundle/helpers';

function pseudoRandomStrings(n: number): string[] {
  let x = 123456789;
  const next = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x; };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = next() % 200;
    let s = '';
    for (let j = 0; j < len; j++) s += String.fromCharCode(next() % 0xd800);
    out.push(s);
  }
  return out;
}

describe('contentHash: md-works 와 sync-kit 이 항상 같다', () => {
  const inputs: [string, string][] = [
    ['빈 문자열', ''],
    ['ASCII', 'Hello, World! 0123456789'],
    ['한글', '새 글 — 가나다라마바사 폴더/글'],
    ['이모지', '😀👨‍👩‍👧‍👦🎉 emoji'],
    ['5만 자', 'abc가😀'.repeat(10_000).slice(0, 50_000)],
    ['lone surrogate(high)', 'a\ud800b'],
    ['lone surrogate(low)', 'a\udc00b'],
    ['끝 lone surrogate', 'x\ud83d'],
  ];
  for (const [name, s] of inputs) it(name, () => expect(kitContentHash(s)).toBe(appContentHash(s)));
  it('의사 난수 문자열 100개', () => {
    for (const s of pseudoRandomStrings(100)) expect(kitContentHash(s)).toBe(appContentHash(s));
  });
});

describe('키 파생(전환 전 값 고정)', () => {
  it("deriveKeys(고정 키, 'md-works')", async () => {
    const k = await deriveKeys('0123456789ABCDEFGHJKMNPQRS', 'md-works');
    expect(k.spaceId).toBe('a953126f06a3774bd7aac60e51b2b17b40131c6c0ac01e9279b97d0683eaab32');
    expect(k.authToken).toBe('6f2d6602ee725dc5d65502452e7ba28f35ebf4b3f20d103f3802b96d226eca38');
  });
});

describe('항목 id(전환 전 값 고정)', () => {
  const long = 'x'.repeat(70);
  it('글', () => {
    expect(docItemId('새 글')).toBe('dd7c6467a94d3e3f6a6ad0e3a22');
    expect(docItemId('폴더/글A.md')).toBe('dd3d1a8a1a0cf489b6d2de121ee');
    expect(docItemId('Hello World')).toBe('dd15d101453ab94170a68864e2e');
    expect(docItemId('😀 이모지')).toBe('d52a8324c3eb695ccf7943f476c');
    expect(docItemId('A'.repeat(200))).toBe('d8e86dd2dfb9f866a54d9d951b1');
  });
  it('글감·스레드(긴 id 는 해시로 줄임)', () => {
    expect(snippetItemId('abc')).toBe('s-abc');
    expect(snippetItemId(long)).toBe('s-2d01c5846ac8970cd4441b28ac');
    expect(threadItemId('xyz')).toBe('t-xyz');
    expect(threadItemId(long)).toBe('t-2d01c5846ac8970cd4441b28ac');
  });
});

describe('hashItem 단일 사본 보증(전환 전 엔진의 해시 고정)', () => {
  it('글·글감·스레드·삭제·빈 본문', () => {
    expect(hashItem({ deleted: false, data: { name: '폴더/글', content: '# 제목\n본문' } })).toBe('3429050eac6b98331e29f38702');
    expect(hashItem({ deleted: false, data: { body: '글감 😀', color: 'yellow', createdAt: 1, attachedDocNames: ['a'], ordersByName: { a: 1 } } })).toBe('47d565c203a158d4d5d99e25f6');
    expect(hashItem({ deleted: false, data: { docName: 'a', anchor: { quote: 'q', prefix: 'p', suffix: 's' }, messages: [{ id: 'm1', text: 't', ts: 1 }], resolved: false, createdAt: 2 } })).toBe('585c44438e160bde5c8582e551');
    expect(hashItem({ deleted: true, data: null })).toBe('bdc4e92deb45a3ca1376b15ba5');
    expect(hashItem({ deleted: false, data: { name: 'x', content: '' } })).toBe('e6681bac8199b11601c7547f94');
  });
});

describe('kindOfId: 예전 엔진의 id 접두 추정과 같다', () => {
  it('접두 규칙', () => {
    expect(kindOfId('s-abc')).toBe('snippet');
    expect(kindOfId('t-xyz')).toBe('thread');
    expect(kindOfId('dd7c6467a94d3e3f6a6ad0e3a22')).toBe('doc');
    expect(kindOfId('x')).toBe('doc');
    expect(kindOfId('s')).toBe('doc');
    expect(kindOfId('sx-1')).toBe('doc');
  });
  it('해시로 줄인 긴 id 도 접두로 판정', () => {
    const long = 'x'.repeat(70);
    expect(kindOfId(snippetItemId(long))).toBe('snippet');
    expect(kindOfId(threadItemId(long))).toBe('thread');
    expect(kindOfId(docItemId(long))).toBe('doc');
  });
  it('createSyncAdapter 가 kindOfId 를 노출한다', () => {
    const dev = standaloneDevice();
    const adapter = createSyncAdapter({ host: dev.host, dbName: dev.dbName });
    expect(adapter.kindOfId?.('s-1')).toBe('snippet');
    expect(adapter.kindOfId?.('t-1')).toBe('thread');
    expect(adapter.kindOfId?.(docItemId('새 글'))).toBe('doc');
  });
});
