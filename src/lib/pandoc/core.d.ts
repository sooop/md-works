/**
 * pandoc-wasm의 `exports` 필드는 하위 경로 import를 막는다. vite.config.ts의 alias로
 * `pandoc-wasm-core` → `node_modules/pandoc-wasm/src/core.js`를 직접 가져오므로, 그 파일의
 * 최소 타입만 여기 선언한다. (실제 구현은 pandoc-wasm 저장소의 src/core.js 참고)
 */
declare module 'pandoc-wasm-core' {
  export interface PandocConvertResult {
    stdout: string
    stderr: string
    warnings: unknown[]
    /** 입력 + 출력 + 추출된 미디어 전부 */
    files: Record<string, Blob>
    /** extract-media로 새로 뽑힌 파일만 */
    mediaFiles: Record<string, Blob>
  }

  export interface PandocInstance {
    convert(
      options: Record<string, unknown>,
      stdin: string | null,
      files: Record<string, string | Blob>,
    ): Promise<PandocConvertResult>
    query(options: Record<string, unknown>): Promise<unknown>
  }

  export function createPandocInstance(wasmBinary: ArrayBuffer | Uint8Array): Promise<PandocInstance>
}

/**
 * pandoc-wasm 패키지 자체에도 타입 선언이 없다. `tests/pandoc.test.ts`가 Node 진입점
 * (`index.node.js` — 로컬 `pandoc.wasm`을 파일로 읽는다)의 `convert`/`query`를 직접 쓰기
 * 위한 최소 타입.
 */
declare module 'pandoc-wasm' {
  import type { PandocConvertResult } from 'pandoc-wasm-core'

  export function convert(
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, string | Blob>,
  ): Promise<PandocConvertResult>
  export function query(options: Record<string, unknown>): Promise<unknown>
}
