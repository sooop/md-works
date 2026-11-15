/**
 * pandoc.wasm 무결성 검증 — 빌드 시점에 node_modules 의 실제 파일에서 계산한 SHA-256 과 대조한다.
 * 기대 해시가 비어 있으면(파일을 못 찾은 빌드, 테스트 환경) 검증을 건너뛴다.
 */

/** vite define 으로 주입되는 기대 해시. 정의되지 않은 환경(vitest 등)에서는 빈 문자열. */
export function expectedWasmSha256(): string {
  return typeof __PANDOC_WASM_SHA256__ === 'string' ? __PANDOC_WASM_SHA256__ : ''
}

/** 해시 비교(순수 함수). 기대값이 비어 있으면 검증하지 않고 통과, 대소문자는 구분하지 않는다. */
export function hashMatches(actualHex: string, expectedHex: string): boolean {
  if (!expectedHex) return true
  return actualHex.toLowerCase() === expectedHex.trim().toLowerCase()
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 바이트가 기대 해시와 일치하는지. 기대값이 비어 있으면 해시 계산도 생략한다. */
export async function verifyWasm(bytes: ArrayBuffer, expectedHex = expectedWasmSha256()): Promise<boolean> {
  if (!expectedHex) return true
  return hashMatches(await sha256Hex(bytes), expectedHex)
}
