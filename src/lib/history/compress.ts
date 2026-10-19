// 이력 본문 압축: UTF-8 → deflate(fflate) → base64. 한글·이모지는 UTF-8 바이트로 다뤄 그대로 보존된다.
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

export type Enc = 'raw' | 'deflate-b64';

function toB64(bytes: Uint8Array): string {
  let s = '';
  // 인자 개수 한도를 피하려고 조각으로 나눠 변환한다
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function compress(text: string): { content: string; enc: 'deflate-b64' } {
  return { content: toB64(deflateSync(strToU8(text), { level: 6 })), enc: 'deflate-b64' };
}

export function decompress(content: string, enc: Enc): string {
  return enc === 'raw' ? content : strFromU8(inflateSync(fromB64(content)));
}
