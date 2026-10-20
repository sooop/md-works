// 서체 후보와 설치 여부 확인. 웹 폰트를 내려받지 않고 '이 컴퓨터에 설치된 글꼴'만 쓴다.

export type FontKind = 'text' | 'code';

export const TEXT_FONTS = [
  'Pretendard Variable', 'Pretendard', 'Noto Sans KR', 'Noto Serif KR', 'Nanum Gothic', 'Nanum Myeongjo', 'Nanum Barun Gothic', 'KoPub Batang',
  'Malgun Gothic', 'Batang', 'Gulim', 'Apple SD Gothic Neo', 'Segoe UI', 'Georgia', 'Times New Roman', 'Inter', 'Source Sans 3',
] as const;

export const CODE_FONTS = [
  'Jetendard', 'Geist Mono', 'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', 'D2Coding', 'Fira Code', 'Source Code Pro', 'Consolas', 'Menlo', 'Monaco', 'Courier New',
] as const;

export const candidatesFor = (kind: FontKind): readonly string[] => (kind === 'code' ? CODE_FONTS : TEXT_FONTS);

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, boolean>();
const PROBE = 'mmmmmmmmmmlliWÀ가나다라마바사0123456789';

/** 글꼴이 설치돼 있는지: 기준 글꼴(monospace·serif·sans-serif)로만 그릴 때와 폭이 다르면 설치된 것으로 본다 */
export function isFontInstalled(name: string): boolean {
  const key = name.trim();
  if (!key) return false;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') return false;
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const width = (family: string) => { ctx!.font = `72px ${family}`; return ctx!.measureText(PROBE).width; };
  const bases = ['monospace', 'serif', 'sans-serif'];
  const ok = bases.some((b) => width(`"${key.replace(/"/g, '')}", ${b}`) !== width(b));
  cache.set(key, ok);
  return ok;
}

/** 입력(쉼표로 구분한 글꼴 목록)의 첫 글꼴 이름 */
export function firstFont(input: string): string {
  const m = input.split(',')[0] ?? '';
  return m.replace(/["']/g, '').trim();
}
