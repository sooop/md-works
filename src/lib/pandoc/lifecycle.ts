/**
 * 워커 init·변환 대기의 수명 관리. Worker 를 인자로 받아 가짜 Worker 로 테스트할 수 있다.
 * 에러·타임아웃이면 대기 Promise 를 reject 하고, 호출자가 워커를 terminate 한다.
 */
import type { PandocWorkerResponse } from './pandoc.worker'

export const INIT_TIMEOUT_MS = 60_000
export const CONVERT_TIMEOUT_MS = 120_000

/** init 에러 중 wasm 자체 문제(워커가 보고한 실패)를 구분하는 표식 — 이때만 캐시를 지운다. */
export class PandocInitError extends Error {}

type WorkerLike = Pick<Worker, 'addEventListener' | 'removeEventListener'>

/** init 응답을 기다린다. error·messageerror·타임아웃이면 reject (워커 정리는 호출자 몫). */
export function waitForInit(w: WorkerLike, start: () => void, timeoutMs = INIT_TIMEOUT_MS): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      w.removeEventListener('message', onMessage as EventListener)
      w.removeEventListener('error', onError as EventListener)
      w.removeEventListener('messageerror', onMsgError as EventListener)
    }
    const onMessage = (e: MessageEvent<PandocWorkerResponse>) => {
      if (e.data.type !== 'init') return
      cleanup()
      if (e.data.ok) resolve()
      else reject(new PandocInitError(e.data.error ?? 'pandoc 초기화에 실패했습니다'))
    }
    const onError = (e: ErrorEvent) => {
      cleanup()
      reject(new Error(e.message || 'pandoc 워커 오류'))
    }
    const onMsgError = () => {
      cleanup()
      reject(new Error('pandoc 워커 메시지를 해석하지 못했습니다'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('pandoc 초기화 시간이 초과되었습니다'))
    }, timeoutMs)
    w.addEventListener('message', onMessage as EventListener)
    w.addEventListener('error', onError as EventListener)
    w.addEventListener('messageerror', onMsgError as EventListener)
    try {
      start()
    } catch (e) {
      cleanup()
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** 변환 요청에 타임아웃을 건다. 초과하면 onTimeout(워커 종료) 후 reject. */
export function withTimeout<T>(p: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new Error('pandoc 변환 시간이 초과되었습니다'))
    }, timeoutMs)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
