import { splitFrontmatter } from './frontmatter';
export const dirname = (p: string) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const stripExt = (n: string) => n.replace(/\.[^./]+$/, '');

// 슬래시 경로 결합 + '.', '..' 정규화
export function joinPath(...parts: string[]): string {
  const out: string[] = [];
  for (const seg of parts.join('/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('파일을 읽지 못했습니다'));
    r.readAsDataURL(file);
  });
}

export function imageExt(file: Blob & { name?: string }): string {
  const t = file.type.replace('image/', '').replace('+xml', '').replace('jpeg', 'jpg');
  if (t && /^[a-z0-9]+$/.test(t)) return t;
  const m = /\.([a-z0-9]+)$/i.exec(file.name ?? '');
  return m ? m[1].toLowerCase() : 'png';
}

// 마크다운 이미지 문법: ![alt](src "title") / ![alt](<src>)
export const IMAGE_RE = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?)\)/g;

export function isExternalSrc(src: string): boolean {
  return /^(https?:|data:|blob:|\/)/i.test(src);
}

// 이미지 참조를 비동기로 치환한다. fn 이 null 을 주면 그대로 둔다.
export async function replaceImages(
  md: string,
  fn: (src: string) => Promise<string | null>,
): Promise<{ text: string; count: number }> {
  const matches = [...md.matchAll(IMAGE_RE)];
  let count = 0;
  const results = await Promise.all(
    matches.map(async (m) => {
      const raw = m[2];
      const src = raw.startsWith('<') ? raw.slice(1, -1) : raw;
      const next = await fn(src);
      return next === null ? null : { m, next };
    }),
  );
  let text = '';
  let last = 0;
  for (const r of results) {
    if (!r) continue;
    const { m, next } = r;
    const idx = m.index ?? 0;
    const wrapped = /\s/.test(next) ? `<${next}>` : next;
    text += md.slice(last, idx) + `![${m[1]}](${wrapped}${m[3]})`;
    last = idx + m[0].length;
    count++;
  }
  return { text: text + md.slice(last), count };
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadText = (name: string, text: string) =>
  downloadBlob(name, new Blob([text], { type: 'text/markdown;charset=utf-8' }));

// 클립보드에 텍스트 복사 (권한/보안 컨텍스트 문제 시 execCommand 로 대체)
export async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('클립보드에 복사하지 못했습니다');
  }
}

// 파일명으로 쓸 수 없는 문자를 걷어낸다
export function sanitizeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
}

// 본문 첫 줄(제목 문법 제거)에서 문서 이름 후보를 뽑는다. frontmatter 와 빈 줄·구분선(---, ***, ___)은 건너뛴다.
export function guessTitle(text: string): string {
  const { body } = splitFrontmatter(text);
  const line = body.split(/\r?\n/).find((l) => l.trim() && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) ?? '';
  const plain = line
    .replace(/^\s*(#{1,6}\s+|[-*+>]\s+|\d+\.\s+)/, '')
    .replace(/[*_`~[\]()!]/g, '');
  return sanitizeName(plain).slice(0, 40).trim();
}

// '방금 전' / '12분 전' / '3시간 전' / '10월 5일 14:30' 형태의 상대 시각
export function relTime(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return new Date(ts).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 'YYYY. M. D. 오후 3:04' 처럼 날짜·시각을 한 줄로 */
export const fmtDateTime = (ts: number): string =>
  new Date(ts).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
