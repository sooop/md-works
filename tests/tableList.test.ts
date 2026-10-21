import { describe, it, expect } from 'vitest';
import { importToGrid, exportListText, parseTableText, parseMdList, jsonTextToGrid, detectListFormat, headBody } from '../src/lib/tableList';
import { toAscii, toMarkdown } from '../src/lib/tableFormats';
import { toTsv } from '../src/lib/tableCsv';

const G = [['송장번호', '수취인', '중량'], ['TX1', '김민수', '1.2'], ['TX2', 'Tan, Wei', '0.9']];
const IMP = { infer: true, unflat: true, arr: 'cols' as const, headerMode: 'auto' as const };
const EXP = { infer: true, unflat: true, inclHeader: true };

describe('표 입력', () => {
  it('CSV: 따옴표 안의 쉼표를 보존한다', () => {
    const r = parseTableText('송장번호,수취인,중량\nTX1,김민수,1.2\nTX2,"Tan, Wei",0.9');
    expect(r).toEqual({ grid: G, fmt: 'CSV' });
  });
  it('아스키·GFM·TSV 출력을 되읽으면 원래 표다', () => {
    expect(parseTableText(toAscii(G))).toEqual({ grid: G, fmt: 'ASCII' });
    expect(parseTableText(toMarkdown(G))).toEqual({ grid: G, fmt: 'GFM' });
    expect(parseTableText(toTsv(G))).toEqual({ grid: G, fmt: 'TSV' });
  });
  it('박스 표의 여러 줄 셀을 \n 으로 합친다', () => {
    const box = ['┌───┬────┐', '│ a │ b  │', '├───┼────┤', '│ x │ y1 │', '│   │ y2 │', '├───┼────┤', '│ z │ w  │', '└───┴────┘'].join('\n');
    expect(parseTableText(box)!.grid).toEqual([['a', 'b'], ['x', 'y1\ny2'], ['z', 'w']]);
  });
});

describe('JSON·YAML', () => {
  it('값 추론을 켜면 숫자가 되고 되돌린 표는 같다', () => {
    const json = exportListText(G, 'json', EXP);
    expect(JSON.parse(json)[0]['중량']).toBe(1.2);
    expect(jsonTextToGrid(json, IMP)).toEqual(G);
  });
  it('YAML 왕복', () => {
    const y = exportListText(G, 'yaml', EXP);
    expect(importToGrid(y, 'auto', IMP)).toMatchObject({ grid: G, label: 'YAML' });
  });
  it('중첩 객체·배열은 cols/rows 모드로 편다', () => {
    const t = '[{"id":1,"addr":{"city":"서울"},"items":[{"sku":"A"},{"sku":"B"}]}]';
    expect(jsonTextToGrid(t, { ...IMP, arr: 'cols' })[0]).toEqual(['id', 'addr.city', 'items[0].sku', 'items[1].sku']);
    expect(jsonTextToGrid(t, { ...IMP, arr: 'rows' })).toHaveLength(3);
  });
  it('점·[n] 헤더는 중첩으로 복원한다', () => {
    const j = JSON.parse(exportListText([['id', 'addr.city', 'items[0].sku'], ['1', '서울', 'A']], 'json', EXP));
    expect(j).toEqual([{ id: 1, addr: { city: '서울' }, items: [{ sku: 'A' }] }]);
  });
});

describe('마크다운 목록', () => {
  it('3가지 스타일이 왕복한다', () => {
    for (const [s, kind] of [['md-record', 'record'], ['md-tree', 'path'], ['md-line', 'line']] as const) {
      const r = importToGrid(exportListText(G, s, EXP), 'auto', IMP);
      expect(r.grid, s).toEqual(G);
      expect(r.mdKind).toBe(kind);
    }
  });
  it('계층 목록은 path', () => {
    expect(parseMdList('- 과일\n  - 사과\n  - 배\n- 채소\n  - 당근', IMP)!.grid)
      .toEqual([['1단계', '2단계'], ['과일', '사과'], ['과일', '배'], ['채소', '당근']]);
  });
  it('일반 줄 헤더 · last 모드', () => {
    expect(parseMdList('이름 | 수량\n- 사과 | 3\n- 배 | 5', IMP)!.grid[0]).toEqual(['이름', '수량']);
    expect(parseMdList('- 사과 | 3\n- 배 | 5\n- 이름 | 수량', { ...IMP, headerMode: 'last' })!.grid[0]).toEqual(['이름', '수량']);
  });
  it('record · kv', () => {
    expect(parseMdList('- name: A\n  - price: 1\n- name: B\n  - price: 2', IMP)).toMatchObject({ kind: 'record', grid: [['name', 'price'], ['A', '1'], ['B', '2']] });
    expect(parseMdList('- a: 1\n- b: 2', IMP)).toMatchObject({ kind: 'kv', grid: [['키', '값'], ['a', '1'], ['b', '2']] });
  });
});

describe('형식 자동 감지', () => {
  it('목록', () => {
    expect(detectListFormat('[1]')).toBe('json');
    expect(detectListFormat('- a\n- b')).toBe('md');
    expect(detectListFormat('a: 1\nb: 2')).toBe('yaml');
  });
  it('세미콜론 CSV 는 표로 본다', () => {
    expect(importToGrid('a;b\n1;2', 'auto', IMP)).toMatchObject({ grid: [['a', 'b'], ['1', '2']], label: 'CSV (;)' });
  });
  it('빈 입력·깨진 JSON 은 오류', () => {
    expect(() => importToGrid(' ', 'auto', IMP)).toThrow();
    expect(() => importToGrid('[{', 'json', IMP)).toThrow();
  });
  it('빈 머리글은 열 N', () => {
    expect(headBody([['a', ''], ['1', '2']]).head).toEqual(['a', '열 2']);
  });
});
