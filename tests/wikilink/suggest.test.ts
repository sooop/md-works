import { describe, it, expect } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { suggestCandidates, findTrigger } from '../../src/lib/wikilink/suggest';

const docs = (...p: string[]) => p.map((path) => ({ path }));

describe('suggestCandidates', () => {
  const d = docs('회의록', '회사 소개', 'a/기획', 'b/기획', '한글/가나다', 'Notes');

  it('빈 글자면 이름순으로 모두(현재 글은 뺀다)', () => {
    const r = suggestCandidates('', d, { current: '회의록' });
    expect(r.map((c) => c.path)).not.toContain('회의록');
    expect(r.length).toBe(5);
  });

  it('부분 문자열로 거르고 앞부분 일치를 먼저 둔다', () => {
    expect(suggestCandidates('회', d).map((c) => c.name)).toEqual(['회사 소개', '회의록']);
    expect(suggestCandidates('의록', d).map((c) => c.name)).toEqual(['회의록']);
    expect(suggestCandidates('NOTE', d).map((c) => c.name)).toEqual(['Notes']);
  });

  it('한글 초성으로도 찾는다', () => {
    expect(suggestCandidates('ㅎㅇㄹ', d).map((c) => c.name)).toEqual(['회의록']);
    expect(suggestCandidates('ㄱㄴㄷ', d).map((c) => c.path)).toEqual(['한글/가나다']);
  });

  it('폴더 이름으로도 찾지만 이름 일치보다 뒤에 둔다', () => {
    expect(suggestCandidates('한글', docs('한글/가나다', '한글책')).map((c) => c.path)).toEqual(['한글책', '한글/가나다']);
  });

  it('같은 이름이 여러 폴더에 있으면 경로 형태로 넣고 폴더를 함께 준다', () => {
    const r = suggestCandidates('기획', d);
    expect(r.map((c) => [c.insert, c.folder])).toEqual([['a/기획', 'a'], ['b/기획', 'b']]);
    expect(suggestCandidates('가나다', d)[0].insert).toBe('가나다');
  });

  it('상한을 넘기지 않는다', () => {
    const many = docs(...Array.from({ length: 40 }, (_, i) => `글 ${i}`));
    expect(suggestCandidates('글', many).length).toBe(12);
    expect(suggestCandidates('글', many, { limit: 5 }).length).toBe(5);
  });
});

describe('findTrigger', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      code_block: { group: 'block', content: 'text*', code: true },
      text: { group: 'inline' },
    },
    marks: { inlineCode: { code: true } },
  });
  const at = (doc: ReturnType<typeof schema.nodes.doc.create>, pos: number) =>
    EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
  const para = (...c: ReturnType<typeof schema.text>[]) => schema.nodes.paragraph.create(null, c);

  it('커서 앞에 열린 [[ 가 있으면 그 범위와 입력한 글자', () => {
    const doc = schema.nodes.doc.create(null, [para(schema.text('앞 [[회의'))]);
    expect(findTrigger(at(doc, doc.content.size - 1))).toEqual({ from: 3, to: doc.content.size - 1, query: '회의' });
  });

  it('바로 뒤에 ]] 가 있으면 함께 바꾼다', () => {
    const doc = schema.nodes.doc.create(null, [para(schema.text('[[회]]'))]);
    const t = findTrigger(at(doc, 4))!; // [[회 | ]]
    expect(t.query).toBe('회');
    expect(t.to).toBe(6);
  });

  it('닫힌 링크 뒤·| 뒤·대괄호가 섞이면 뜨지 않는다', () => {
    const closed = schema.nodes.doc.create(null, [para(schema.text('[[a]] 뒤'))]);
    expect(findTrigger(at(closed, closed.content.size - 1))).toBeNull();
    const alias = schema.nodes.doc.create(null, [para(schema.text('[[a|표'))]);
    expect(findTrigger(at(alias, alias.content.size - 1))).toBeNull();
    const inner = schema.nodes.doc.create(null, [para(schema.text('[[a[b'))]);
    expect(findTrigger(at(inner, inner.content.size - 1))).toBeNull();
  });

  it('코드 블록·인라인 코드 안에서는 뜨지 않는다', () => {
    const block = schema.nodes.doc.create(null, [schema.nodes.code_block.create(null, schema.text('[[a'))]);
    expect(findTrigger(at(block, block.content.size - 1))).toBeNull();
    const inline = schema.nodes.doc.create(null, [para(schema.text('[[a', [schema.marks.inlineCode.create()]))]);
    expect(findTrigger(at(inline, inline.content.size - 1))).toBeNull();
  });

  it('선택 영역이 있으면 뜨지 않는다', () => {
    const doc = schema.nodes.doc.create(null, [para(schema.text('[[abc'))]);
    expect(findTrigger(EditorState.create({ doc, selection: TextSelection.create(doc, 3, 5) }))).toBeNull();
  });
});
