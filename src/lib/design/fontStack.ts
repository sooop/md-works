// font-family 문자열 생성: 사용자 입력 폰트 이름을 안전하게 이스케이프하고 시스템 폴백을 붙인다

const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
]);

/** 본문·제목용 폴백 (app.css 의 --font 뒷부분과 같다) */
export const FALLBACK_TEXT = "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
export const FALLBACK_CODE = "Jetendard, Consolas, 'Cascadia Mono', monospace";
/** 입력 최대 길이와 폰트 이름 최대 개수 */
export const FONT_INPUT_MAX = 200;
const MAX_NAMES = 8;

/** 쉼표로 나누되 따옴표 안의 쉼표는 보존 */
function splitNames(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = '';
  for (const ch of input) {
    if (q) { if (ch === q) q = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** 입력에서 폰트 이름 목록을 뽑는다. 제어문자·CSS 구분자·역슬래시·따옴표는 제거해 주입 여지를 없앤다 */
export function parseFontNames(input: string): string[] {
  const names: string[] = [];
  for (const raw of splitNames(String(input ?? '').slice(0, FONT_INPUT_MAX))) {
    const name = raw
      .replace(/[\u0000-\u001f\u007f<>{};\\]/g, '')
      .replace(/["']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (name) names.push(name);
    if (names.length >= MAX_NAMES) break;
  }
  return names;
}

/** 입력 → font-family 값. 입력이 비면 빈 문자열(호출 측이 기본값을 쓴다). 항상 폴백 스택을 뒤에 붙인다 */
export function buildFontFamily(input: string, fallback: string = FALLBACK_TEXT): string {
  const names = parseFontNames(input);
  if (!names.length) return '';
  const parts = names.map((n) => (GENERIC.has(n.toLowerCase()) ? n.toLowerCase() : `"${n}"`));
  return `${parts.join(', ')}, ${fallback}`;
}
