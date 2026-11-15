/**
 * pandoc-wasm 워커 클라이언트 — 워커 생성·초기화·요청 라우팅을 한 곳에 모은다.
 *
 * `ensurePandoc()`은 wasm 확보(캐시 또는 다운로드)부터 워커 init까지 한 번만 하고 그 뒤로는
 * 같은 프라미스를 재사용한다. 실패하면 워커를 버리고 다음 호출이 처음부터 다시 시도한다.
 */
import PandocWorker from './pandoc.worker?worker&inline'
import type { PandocConvertResult } from 'pandoc-wasm-core'
import type { PandocFiles, PandocWorkerRequest, PandocWorkerResponse } from './pandoc.worker'
import { clearPandocCache, getPandocWasm, type Progress } from './wasmStore'
import { CONVERT_TIMEOUT_MS, PandocInitError, waitForInit, withTimeout } from './lifecycle'

interface PendingConvert {
  resolve: (r: PandocConvertResult) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null
let nextId = 1
const pendingConverts = new Map<number, PendingConvert>()

/** 죽었거나 시간 초과한 워커를 종료하고 다음 호출이 새로 띄우게 한다. 이미 교체된 워커면 건드리지 않는다. */
function discardWorker(w: Worker) {
  w.terminate()
  if (worker === w) {
    worker = null
    readyPromise = null
  }
}

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
    discardWorker(w)
  }
  return w
}

/** wasm을 확보하고 워커를 초기화한다. 이미 준비돼 있으면 즉시 resolve. */
export function ensurePandoc(onProgress?: (p: Progress) => void): Promise<void> {
  if (readyPromise) return readyPromise
  const p = (async () => {
    const wasm = await getPandocWasm(onProgress)
    const w = spawnWorker()
    try {
      await waitForInit(w, () => w.postMessage({ type: 'init', wasm } satisfies PandocWorkerRequest, [wasm]))
    } catch (e) {
      w.terminate()
      // wasm 자체가 거부된 경우(손상된 캐시 레코드 등)만 캐시를 지운다 — 타임아웃·크래시는 캐시 탓이 아닐 수 있다
      if (e instanceof PandocInitError) await clearPandocCache()
      throw e
    }
    worker = w
  })()
  readyPromise = p
  p.catch(() => {
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
  const job = new Promise<PandocConvertResult>((resolve, reject) => {
    pendingConverts.set(id, { resolve, reject })
    w.postMessage({ type: 'convert', id, options, stdin, files } satisfies PandocWorkerRequest)
  })
  // 응답이 없는 워커는 종료하고 대기 중인 나머지 요청도 함께 실패시킨다
  return withTimeout(job, CONVERT_TIMEOUT_MS, () => {
    for (const pending of pendingConverts.values()) pending.reject(new Error('pandoc 워커를 종료했습니다'))
    pendingConverts.clear()
    discardWorker(w)
  })
}
