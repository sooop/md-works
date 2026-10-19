/**
 * pandoc-wasm 워커 클라이언트 — 워커 생성·초기화·요청 라우팅을 한 곳에 모은다.
 *
 * `ensurePandoc()`은 wasm 확보(캐시 또는 다운로드)부터 워커 init까지 한 번만 하고 그 뒤로는
 * 같은 프라미스를 재사용한다. 실패하면 워커를 버리고 다음 호출이 처음부터 다시 시도한다.
 */
import PandocWorker from './pandoc.worker?worker&inline'
import type { PandocConvertResult } from 'pandoc-wasm-core'
import type { PandocFiles, PandocWorkerRequest, PandocWorkerResponse } from './pandoc.worker'
import { getPandocWasm, type Progress } from './wasmStore'

interface PendingConvert {
  resolve: (r: PandocConvertResult) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null
let nextId = 1
const pendingConverts = new Map<number, PendingConvert>()

function spawnWorker(): Worker {
  const w = new PandocWorker()
  w.onmessage = (e: MessageEvent<PandocWorkerResponse>) => {
    const msg = e.data
    if (msg.type !== 'convert') return
    const pending = pendingConverts.get(msg.id)
    if (!pending) return
    pendingConverts.delete(msg.id)
    if (msg.ok && msg.result) pending.resolve(msg.result)
    else pending.reject(new Error(msg.error ?? 'pandoc 변환에 실패했습니다'))
  }
  w.onerror = (e: ErrorEvent) => {
    // 워커 자체가 죽으면 대기 중인 요청을 모두 실패시키고 다음 호출이 재시작하게 한다
    for (const pending of pendingConverts.values()) pending.reject(new Error(e.message || 'pandoc 워커 오류'))
    pendingConverts.clear()
    worker = null
    readyPromise = null
  }
  return w
}

/** wasm을 확보하고 워커를 초기화한다. 이미 준비돼 있으면 즉시 resolve. */
export function ensurePandoc(onProgress?: (p: Progress) => void): Promise<void> {
  if (readyPromise) return readyPromise
  const p = (async () => {
    const wasm = await getPandocWasm(onProgress)
    const w = spawnWorker()
    await new Promise<void>((resolve, reject) => {
      const onMessage = (e: MessageEvent<PandocWorkerResponse>) => {
        if (e.data.type !== 'init') return
        w.removeEventListener('message', onMessage)
        if (e.data.ok) resolve()
        else reject(new Error(e.data.error ?? 'pandoc 초기화에 실패했습니다'))
      }
      w.addEventListener('message', onMessage)
      w.postMessage({ type: 'init', wasm } satisfies PandocWorkerRequest, [wasm])
    })
    worker = w
  })()
  readyPromise = p
  p.catch(() => {
    worker?.terminate()
    worker = null
    readyPromise = null
  })
  return p
}

/** pandoc 변환 하나를 실행한다. 필요하면 먼저 `ensurePandoc()`을 기다린다. */
export async function runPandoc(
  options: Record<string, unknown>,
  files: PandocFiles,
  stdin: string | null = null,
): Promise<PandocConvertResult> {
  await ensurePandoc()
  if (!worker) throw new Error('pandoc이 초기화되지 않았습니다')
  const id = nextId++
  const w = worker
  return new Promise((resolve, reject) => {
    pendingConverts.set(id, { resolve, reject })
    w.postMessage({ type: 'convert', id, options, stdin, files } satisfies PandocWorkerRequest)
  })
}
