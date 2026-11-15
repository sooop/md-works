// 내보낸 HTML 에서 스크립트 실행으로 이어질 수 있는 요소를 걷어내는 순수 함수(DOM 불필요, 테스트 가능).
// pandoc 은 글 속 raw HTML 을 그대로 내보내므로(`<script>`, `onerror=` …) 파일로 만들기 전에 반드시 거친다.
// 정규식 한 번으로 태그를 지우면 변형된 마크업에 뚫리므로, `<` 마다 태그인지 확인해 가며 한 글자씩 다시 쓴다.
// 한계: 허용 목록이 아니라 차단 목록이다. 마지막 방어선으로 문서에 CSP(`script-src` 없음 = 스크립트 차단)도 함께 넣는다(html.ts).

/** 내용까지 통째로 지우는 요소 */
const BLOCK_TAGS = ['script', 'style', 'iframe', 'frameset', 'object', 'applet', 'noscript', 'template', 'title', 'textarea', 'select'];
/** 태그만 지우고 안의 글은 남기는 요소 (닫는 태그가 없는 요소 포함) */
const DROP_TAGS = new Set(['link', 'meta', 'base', 'embed', 'frame', 'param', 'source', 'track', 'form', 'button', 'option', 'optgroup', 'html', 'head', 'body']);
/** 값이 주소인 속성 */
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'data', 'cite', 'longdesc', 'srcset']);
const NAMED_ENTITIES: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** 주소 판별을 속이는 공백·제어·보이지 않는 문자 */
const INVISIBLE = new RegExp('[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]', 'g');
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/y;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** 속성 값의 문자 참조를 풀고 공백·제어 문자를 지워, `java&#x09;script:` 같은 우회를 한 모양으로 만든다 */
function normalizeUrl(v: string): string {
  const decoded = v.replace(/&#x([0-9a-f]+);?|&#(\d+);?|&([a-z]+);?/gi, (m, hex, dec, name) => {
    if (hex || dec) {
      const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return NAMED_ENTITIES[String(name).toLowerCase()] ?? m;
  });
  return decoded.replace(INVISIBLE, '').toLowerCase();
}

const escAttr = (v: string) => v.replace(/&(?!#?\w+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function urlAllowed(tag: string, attr: string, value: string): boolean {
  const u = normalizeUrl(value);
  if (attr === 'srcset') return !/(javascript|vbscript|data):/.test(u);
  if (/^(javascript|vbscript|livescript|mocha):/.test(u)) return false;
  if (u.startsWith('data:')) return attr === 'src' && (tag === 'img' || tag === 'source') && u.startsWith('data:image/');
  return true;
}

function cleanTag(closing: string, name: string, rest: string): string {
  const tag = name.toLowerCase();
  if (DROP_TAGS.has(tag)) return '';
  if (closing) return tag === 'input' ? '' : `</${name}>`;
  const attrs: Record<string, string | null> = {};
  const order: string[] = [];
  for (const m of rest.matchAll(ATTR)) {
    const k = m[1].toLowerCase();
    if (k in attrs) continue;
    attrs[k] = m[2] ?? m[3] ?? m[4] ?? null; // null = 값 없는 속성(checked 등)
    order.push(k);
  }
  // 입력 칸은 체크박스(할 일 목록)만 남기고 조작은 막는다
  if (tag === 'input') {
    if ((attrs.type ?? '').trim().toLowerCase() !== 'checkbox') return '';
    return `<input type="checkbox"${'checked' in attrs ? ' checked' : ''} disabled>`;
  }
  const out: string[] = [];
  for (const k of order) {
    const v = attrs[k];
    if (v === null) { if (!k.startsWith('on')) out.push(k); continue; }
    if (k.startsWith('on') || k === 'srcdoc' || k === 'formaction' || k === 'is') continue;
    if (URL_ATTRS.has(k) && !urlAllowed(tag, k, v)) continue;
    // 스타일 속성의 url()·expression() 은 외부 요청·스크립트 통로가 된다
    if (k === 'style' && /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i.test(normalizeUrlKeepParens(v))) continue;
    out.push(`${k}="${escAttr(v)}"`);
  }
  const selfClose = /\/\s*$/.test(rest) ? ' /' : '';
  return `<${name}${out.length ? ' ' + out.join(' ') : ''}${selfClose}>`;
}

/** 스타일 값 검사용: 공백만 줄이고 문자 참조는 푼다(괄호는 남긴다) */
function normalizeUrlKeepParens(v: string): string {
  return v.replace(/&#x([0-9a-f]+);?|&#(\d+);?/gi, (_m, hex, dec) => {
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  }).replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16) || 32)).replace(/[\u0000-\u001f]/g, '');
}

/** 스크립트·이벤트 속성·위험한 URL 을 지운 HTML 조각을 돌려준다 */
export function sanitizeExportHtml(html: string): string {
  let src = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<![^>]*>/g, '').replace(/<\?[\s\S]*?(?:\?>|>|$)/g, '');
  // 내용째 지울 요소: 닫는 태그가 없으면 끝까지 지운다. 중첩·변형이 사라질 때까지 반복
  const block = new RegExp(`<(${BLOCK_TAGS.join('|')})(?![a-zA-Z0-9:-])(?:"[^"]*"|'[^']*'|[^'">])*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)`, 'gi');
  for (let prev = ''; prev !== src; ) { prev = src; src = src.replace(block, ''); }
  let out = '';
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { out += src.slice(i); break; }
    out += src.slice(i, lt);
    TAG.lastIndex = lt;
    const m = TAG.exec(src);
    if (m) {
      out += cleanTag(m[1], m[2], m[3]);
      i = TAG.lastIndex;
    } else {
      out += '&lt;'; // 태그가 아닌 `<` (닫히지 않은 태그 포함)는 글자로 만든다
      i = lt + 1;
    }
  }
  return out;
}

/** 결과물 검사용: 남아 있으면 안 되는 것이 있는가 (테스트·방어적 확인) */
export function findDangerousHtml(html: string): string[] {
  const found: string[] = [];
  if (/<script\b/i.test(html)) found.push('script');
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) found.push('on* 속성');
  if (/\b(?:href|src|action|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript):/i.test(html)) found.push('javascript: URL');
  return found;
}
