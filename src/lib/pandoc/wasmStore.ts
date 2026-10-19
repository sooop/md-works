/**
 * pandoc.wasm(원본 58.6MB, gzip 전송 약 16MB) 캐시.
 *
 * 앱의 다른 IndexedDB 와는 별도인 `works-pandoc` DB를 쓴다 —
 * 메인 DB의 `onupgradeneeded`는 다른 탭이 열려 있으면 막힐 수 있는데, wasm 캐시는 그 지연을
 * 겪을 이유가 없다. `req`/`normalizeError`는 그대로 재사용한다.
 *
 * 실패 규약은 `lib/util/cdn.ts`와 같다: 네트워크 실패로 reject되면 프라미스 캐시를 비워서,
 * 온라인이 된 다음 호출이 처음부터 다시 시도할 수 있게 한다. IndexedDB 저장 실패(quota 등)는
 * 변환 자체를 막지 않고 조용히 무시한다 — 다음 호출이 다시 받으면 그만이다.
 */

function normalizeError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(normalizeError(r.error))
  })
}

export const PANDOC_VERSION = '1.1.0'
// 서버 버전은 로컬 서버가 node_modules 의 wasm 을 직접 제공한다(외부 요청 없음).
// 스탠드얼론은 첫 사용 때만 unpkg 에서 받아 IndexedDB 에 캐시한다.
const WASM_URL =
  __MODE__ === 'server' ? '/api/pandoc.wasm' : `https://unpkg.com/pandoc-wasm@${PANDOC_VERSION}/src/pandoc.wasm`
// gzip 전송이라 Content-Length를 믿을 수 없다 — 진행률 분모로 쓰는 원본(비압축) 크기 실측값
export const WASM_BYTES_HINT = 58_617_582

const DB_NAME = 'works-pandoc'
const DB_VERSION = 1
const STORE = 'wasm'

export interface Progress {
  loaded: number
  total: number
}

interface WasmRecord {
  version: string
  bytes: ArrayBuffer
}

function openWasmDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest
    try {
      r = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(normalizeError(e))
      return
    }
    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'version' })
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(normalizeError(r.error))
  })
}

async function readCached(version: string): Promise<ArrayBuffer | null> {
  if (__MODE__ === 'server') return null
  try {
    const db = await openWasmDb()
    const tx = db.transaction(STORE, 'readonly')
    const rec = await req<WasmRecord | undefined>(tx.objectStore(STORE).get(version))
    return rec?.bytes ?? null
  } catch {
    return null
  }
}

async function writeCached(version: string, bytes: ArrayBuffer): Promise<void> {
  if (__MODE__ === 'server') return
  try {
    const db = await openWasmDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      // 스토어에는 한 버전만 유지한다 — 이전 버전 캐시가 남아 있을 이유가 없다
      tx.objectStore(STORE).clear()
      tx.objectStore(STORE).put({ version, bytes } satisfies WasmRecord)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(normalizeError(tx.error))
      tx.onabort = () => reject(normalizeError(tx.error ?? new Error('transaction aborted')))
    })
  } catch {
    // 저장 실패는 값으로 삼키고 호출자에게 알리지 않는다 — 변환은 이미 받은 바이트로 계속된다
  }
}

async function downloadWasm(onProgress?: (p: Progress) => void): Promise<ArrayBuffer> {
  const res = await fetch(WASM_URL)
  if (!res.ok || !res.body) {
    throw new Error(`pandoc 엔진을 내려받지 못했습니다: HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.({ loaded, total: WASM_BYTES_HINT })
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out.buffer
}

let wasmPromise: Promise<ArrayBuffer> | null = null

/** 캐시된 pandoc.wasm을 지운다. 다음 사용 때 다시 내려받는다(이미 초기화된 워커는 이번 세션 동안 유지). */
export async function clearPandocCache(): Promise<boolean> {
  wasmPromise = null
  try {
    const db = await openWasmDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(normalizeError(tx.error))
      tx.onabort = () => reject(normalizeError(tx.error ?? new Error('transaction aborted')))
    })
    return true
  } catch {
    return false
  }
}

/** pandoc.wasm 바이트를 확보한다: 캐시 적중 시 즉시, 아니면 내려받고 캐시에 남긴다. */
export function getPandocWasm(onProgress?: (p: Progress) => void): Promise<ArrayBuffer> {
  if (wasmPromise) return wasmPromise
  const p = (async () => {
    const cached = await readCached(PANDOC_VERSION)
    if (cached) return cached
    const bytes = await downloadWasm(onProgress)
    await writeCached(PANDOC_VERSION, bytes)
    return bytes
  })()
  wasmPromise = p
  p.catch(() => {
    wasmPromise = null
  })
  return p
}
