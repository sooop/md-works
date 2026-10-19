// 본문 검색 핵심: 서버(워커 스레드)와 스탠드얼론(브라우저)이 같이 쓴다. 외부 의존성 없음.
export const MAX_QUERY = 300;

// 이미지 데이터는 검색 대상이 아니다: Base64 data URI 와 스탠드얼론의 idb: 참조는 같은 길이의 공백으로 가린다
const MASK = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*|idb:[0-9a-f-]{36}/gi;
const mask = (line) => (line.includes('data:image/') || line.includes('idb:') ? line.replace(MASK, (m) => ' '.repeat(m.length)) : line);

// 검색어와 옵션으로 정규식을 만든다. 실패하면 { error }.
export function buildMatcher(query, { caseSensitive = false, regex = false } = {}) {
  if (!query) return { error: '검색어가 비어 있습니다' };
  if (query.length > MAX_QUERY) return { error: `검색어는 ${MAX_QUERY}자까지 입력할 수 있습니다` };
  const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return { re: new RegExp(source, caseSensitive ? 'g' : 'gi') };
  } catch (e) {
    return { error: `정규식 오류: ${e.message.replace(/^Invalid regular expression: /, '').replace(/^\/.*\/[a-z]*: /, '')}` };
  }
}

// 줄 단위로 찾는다. nth 는 문서 안에서 몇 번째 일치인지(0부터)로, 문서 내 검색 바가 그 위치로 이동하는 데 쓴다.
// 반환: { matches: [{ line, text, ranges: [[start, end], …], nth }], truncated }
export function searchText(text, re, { maxMatches = 50, window = 160 } = {}) {
  const matches = [];
  let nth = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = mask(lines[i]);
    const found = [];
    for (const m of line.matchAll(re)) {
      if (m[0]) found.push([m.index, m.index + m[0].length]); // 빈 일치는 무시
    }
    if (!found.length) continue;
    if (matches.length >= maxMatches) return { matches, truncated: true };
    // 긴 줄은 첫 일치 주변만 보여 준다
    const start = Math.max(0, Math.min(found[0][0] - 40, line.length - window));
    const end = Math.min(line.length, start + window);
    const pad = start > 0 ? 1 : 0; // 앞에 붙이는 '…' 만큼 밀린다
    matches.push({
      line: i + 1,
      text: (pad ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : ''),
      ranges: found.filter(([s, e]) => s >= start && e <= end).map(([s, e]) => [s - start + pad, e - start + pad]),
      nth,
    });
    nth += found.length;
  }
  return { matches, truncated: false };
}
