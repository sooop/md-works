import { describe, it, expect } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { history, undo } from '@milkdown/kit/prose/history';
import { makePlugin, searchKey, replaceAllTr, replaceCurrentTr } from '../../src/lib/search/pmSearch';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    code_block: { group: 'block', content: 'text*', code: true },
    hardbreak: { group: 'inline', inline: true, selectable: false },
    text: { group: 'inline' },
  },
  marks: { strong: {}, em: {} },
});
const n = schema.nodes;
const t = (s: string, ...marks: string[]) => schema.text(s, marks.map((m) => schema.marks[m].create()));
const p = (...c: ReturnType<typeof t>[]) => n.paragraph.create(null, c);

function open(docNode: ReturnType<typeof n.doc.create>, query: string, opts = {}) {
  const base = EditorState.create({ doc: docNode, plugins: [history(), makePlugin(() => {})] });
  return base.apply(base.tr.setMeta(searchKey, { query, opts, current: 0 }));
}
const text = (s: EditorState) => s.doc.textBetween(0, s.doc.content.size, '|', '￼');
const state = (s: EditorState) => searchKey.getState(s)!;

describe('문서 안 바꾸기', () => {
  it('모두 바꾸기는 트랜잭션 하나라 실행 취소 한 번에 되돌아간다', () => {
    const s0 = open(n.doc.create(null, [p(t('a b a')), p(t('a')), p(t('끝 a'))]), 'a');
    expect(state(s0).hits).toHaveLength(4);
    const r = replaceAllTr(s0, 'XY')!;
    expect(r.count).toBe(4);
    expect(r.partial).toBe(false);
    const s1 = s0.apply(r.tr);
    expect(text(s1)).toBe('XY b XY|XY|끝 XY');
    expect(state(s1).hits).toHaveLength(0);
    let undone: EditorState | null = null;
    undo(s1, (tr) => { undone = s1.apply(tr); });
    expect(text(undone!)).toBe('a b a|a|끝 a'); // 한 번으로 전부
  });

  it('마크 경계에 걸친 일치: 시작 위치의 마크를 물려받고 문서가 깨지지 않는다', () => {
    // 'ab' 가 굵게(a) + 보통(b) 두 텍스트 노드에 걸친다
    const s0 = open(n.doc.create(null, [p(t('x '), t('a', 'strong'), t('b c'))]), 'ab');
    expect(state(s0).hits).toHaveLength(1);
    const s1 = s0.apply(replaceAllTr(s0, 'Z')!.tr);
    s1.doc.check();
    expect(text(s1)).toBe('x Z c');
    const z = s1.doc.firstChild!.child(1);
    expect(z.text).toBe('Z');
    expect(z.marks.map((m) => m.type.name)).toEqual(['strong']);
  });

  it('같은 문단의 여러 일치도 뒤에서 앞으로 적용해 위치가 밀리지 않는다(길이가 다른 대체)', () => {
    const s0 = open(n.doc.create(null, [p(t('aa ', 'em'), t('a a a'))]), 'a');
    const s1 = s0.apply(replaceAllTr(s0, 'LONGER')!.tr);
    s1.doc.check();
    expect(text(s1)).toBe('LONGERLONGER LONGER LONGER LONGER');
  });

  it('정규식 모드: $1 $& 캡처 참조, 일반 모드: 글자 그대로', () => {
    const d = () => n.doc.create(null, [p(t('이름: 홍길동, 이름: 김철수'))]);
    const re = open(d(), '이름: (\\S+?)(,|$)', { regex: true });
    expect(text(re.apply(replaceAllTr(re, '[$1]$2')!.tr))).toBe('[홍길동], [김철수]');
    const re2 = open(d(), '홍길동', { regex: true });
    expect(text(re2.apply(replaceAllTr(re2, '<$&>')!.tr))).toBe('이름: <홍길동>, 이름: 김철수');
    const plain = open(n.doc.create(null, [p(t('a.c'))]), 'a.c');
    expect(text(plain.apply(replaceAllTr(plain, '$&$1')!.tr))).toBe('$&$1');
  });

  it('대소문자 옵션을 따른다', () => {
    const s = open(n.doc.create(null, [p(t('Foo foo'))]), 'foo', { caseSensitive: true });
    expect(text(s.apply(replaceAllTr(s, 'x')!.tr))).toBe('Foo x');
  });

  it('빈 바꿀 말은 지운다. 코드 블록 안 일치도 바꾼다', () => {
    const s0 = open(n.doc.create(null, [p(t('a-b')), n.code_block.create(null, schema.text('a-b'))]), '-');
    expect(text(s0.apply(replaceAllTr(s0, '')!.tr))).toBe('ab|ab');
  });

  it('바꿀 말의 줄바꿈은 문단 안에서는 하드 브레이크가 된다', () => {
    const s0 = open(n.doc.create(null, [p(t('a-b'))]), '-');
    const s1 = s0.apply(replaceAllTr(s0, '\n')!.tr);
    s1.doc.check();
    expect(text(s1)).toBe('a￼b');
  });

  it('바꾸기(현재 하나): 그 일치만 바꾸고 바꾼 자리 다음 일치가 현재가 된다', () => {
    const s0 = open(n.doc.create(null, [p(t('a a a'))]), 'a');
    const s1 = s0.apply(replaceCurrentTr(s0, 'aa')!); // 새 텍스트도 검색어와 일치하지만 건너뛴다
    expect(text(s1)).toBe('aa a a');
    expect(state(s1).hits.length).toBe(4);
    expect(state(s1).hits[state(s1).current].from).toBe(4); // 바꾼 'aa'(1~3) 다음의 둘째 a
    const s2 = s1.apply(replaceCurrentTr(s1, 'X')!);
    expect(text(s2)).toBe('aa X a');
  });

  it('마지막 일치를 바꾸면 처음으로 돌아간다', () => {
    const s0 = open(n.doc.create(null, [p(t('a b a'))]), 'a');
    const s1 = s0.apply(s0.tr.setMeta(searchKey, { current: 1 }));
    const s2 = s1.apply(replaceCurrentTr(s1, 'X')!);
    expect(text(s2)).toBe('a b X');
    expect(state(s2).current).toBe(0);
  });

  it('일치가 없으면 null', () => {
    const s = open(n.doc.create(null, [p(t('abc'))]), 'zzz');
    expect(replaceAllTr(s, 'x')).toBeNull();
    expect(replaceCurrentTr(s, 'x')).toBeNull();
  });
});
