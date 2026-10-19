// 글자 수 계산 (순수 함수). 마크다운 문법 기호가 아니라 렌더된 본문 기준에 가깝게 센다.
// 제외: 프론트매터, 코드 블록(펜스 포함 내용 전체), 이미지, 링크 URL, HTML 태그, 서식 기호.
// 줄바꿈은 공백 포함 여부와 무관하게 세지 않는다. 한글·이모지(서로게이트 페어, ZWJ 시퀀스)는 1자.

export interface CountOptions {
  /** true: 공백(스페이스·탭 등) 포함, false: 모든 공백 제외 */
  spaces: boolean;
}

/** 마크다운 원문에서 문법 구문을 걷어낸 본문 텍스트 */
export function stripMarkdown(md: string): string {
  let s = md.replace(/\r\n?/g, '\n');
  s = s.replace(/^﻿/, '');
  s = s.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, ''); // 프론트매터
  s = s.replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\1[`~]*[ \t]*(?=\n|(?![\s\S]))|(?![\s\S]))/gm, ''); // 펜스 코드 블록(닫히지 않으면 끝까지)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // 이미지
  s = s.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // [글](url) → 글
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  s = s.replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S.*$/gm, ''); // 링크 참조 정의
  s = s.replace(/<(?:https?:\/\/|mailto:)[^>\s]*>/g, ''); // 자동 링크
  s = s.replace(/<\/?[A-Za-z][^>\n]*>/g, ''); // HTML 태그
  s = s.replace(/^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm, ''); // 수평선
  s = s.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, ''); // 표 구분 행
  s = s.replace(/^[ \t]*\|/gm, '').replace(/\|[ \t]*$/gm, '').replace(/[ \t]*\|[ \t]*/g, ' '); // 표 파이프
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // 제목
  s = s.replace(/^[ \t]*(?:>[ \t]?)+/gm, ''); // 인용
  s = s.replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, ''); // 목록·체크박스
  s = s.replace(/`+/g, ''); // 인라인 코드 기호 (내용은 센다)
  s = s.replace(/(\*{1,3}|_{1,3}|~{2})(?=\S)/g, ''); // 강조·취소선 기호
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, '$1'); // 이스케이프
  return s;
}

const NEEDS_SEGMENTER = /[\ud800-\udfff‍️̀-ͯᅠ-ᇿ]/;
type Seg = { segment(s: string): Iterable<unknown> };
let segmenter: Seg | null | undefined;

/** 사용자가 보는 글자(자소 클러스터) 수. 서로게이트 페어·ZWJ 이모지·조합 문자를 1자로 센다. */
function countGraphemes(s: string): number {
  if (!NEEDS_SEGMENTER.test(s)) return s.length;
  if (segmenter === undefined) {
    const I = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => Seg }).Segmenter;
    segmenter = I ? new I(undefined, { granularity: 'grapheme' }) : null;
  }
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(s)) n++;
    return n;
  }
  return Array.from(s).length; // Segmenter 가 없으면 코드 포인트 단위
}

/** 이미 렌더된 본문(선택 영역 등)의 글자 수. 마크다운 구문 제거는 하지 않는다. */
export function countText(text: string, { spaces }: CountOptions): number {
  const t = text.replace(/[\r\n]/g, '');
  return countGraphemes(spaces ? t : t.replace(/\s+/g, ''));
}

/** 마크다운 원문의 본문 글자 수 */
export function countChars(md: string, opts: CountOptions): number {
  return countText(stripMarkdown(md), opts);
}
