/**
 * pandoc-wasm 실행 워커.
 *
 * wasm 인스턴스화(58MB)와 변환 자체가 무겁기 때문에 메인 스레드 밖에서 돈다. `?worker&inline`로
 * 불러써 단일 HTML(file://)에서도 그대로 동작한다(`json-preprocess.worker.ts` 선례와 같은 방식).
 */
import { createPandocInstance, type PandocConvertResult, type PandocInstance } from 'pandoc-wasm-core'

export type PandocFiles = Record<string, string | Blob>

interface InitRequest {
  type: 'init'
  wasm: ArrayBuffer
}

interface ConvertRequest {
  type: 'convert'
  id: number
  options: Record<string, unknown>
  stdin: string | null
  files: PandocFiles
}

export type PandocWorkerRequest = InitRequest | ConvertRequest

interface InitResponse {
  type: 'init'
  ok: boolean
  error?: string
}

interface ConvertResponse {
  type: 'convert'
  id: number
  ok: boolean
  result?: PandocConvertResult
  error?: string
}

export type PandocWorkerResponse = InitResponse | ConvertResponse

let instance: PandocInstance | null = null

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

self.onmessage = async (e: MessageEvent<PandocWorkerRequest>) => {
  const msg = e.data

  if (msg.type === 'init') {
    try {
      instance = await createPandocInstance(msg.wasm)
      postMessage({ type: 'init', ok: true } satisfies InitResponse)
    } catch (err) {
      postMessage({ type: 'init', ok: false, error: errMsg(err) } satisfies InitResponse)
    }
    return
  }

  // convert
  if (!instance) {
    postMessage({ type: 'convert', id: msg.id, ok: false, error: 'pandoc이 초기화되지 않았습니다' } satisfies ConvertResponse)
    return
  }
  try {
    const result = await instance.convert(msg.options, msg.stdin, msg.files)
    postMessage({ type: 'convert', id: msg.id, ok: true, result } satisfies ConvertResponse)
  } catch (err) {
    postMessage({ type: 'convert', id: msg.id, ok: false, error: errMsg(err) } satisfies ConvertResponse)
  }
}
