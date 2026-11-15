import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashMatches, sha256Hex, verifyWasm } from '../../src/lib/pandoc/integrity'
import { waitForInit, withTimeout } from '../../src/lib/pandoc/lifecycle'

describe('wasm 해시 검증', () => {
  it('일치하면 true, 대소문자 무시', () => {
    expect(hashMatches('abc123', 'ABC123')).toBe(true)
  })
  it('불일치하면 false', () => {
    expect(hashMatches('abc123', 'abc124')).toBe(false)
  })
  it('기대값이 비어 있으면 검증을 건너뛴다', () => {
    expect(hashMatches('abc123', '')).toBe(true)
  })
  it('verifyWasm: 실제 SHA-256 으로 대조', async () => {
    const bytes = new TextEncoder().encode('abc').buffer as ArrayBuffer
    const h = await sha256Hex(bytes)
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await verifyWasm(bytes, h)).toBe(true)
    expect(await verifyWasm(bytes, '00')).toBe(false)
    expect(await verifyWasm(bytes, '')).toBe(true)
  })
})

class FakeWorker extends EventTarget {}

describe('워커 수명', () => {
  afterEach(() => vi.useRealTimers())

  it('init 중 error 이벤트면 reject', async () => {
    const w = new FakeWorker()
    const p = waitForInit(w as unknown as Worker, () => {})
    const ev = new Event('error') as Event & { message: string }
    ev.message = '크래시'
    w.dispatchEvent(ev)
    await expect(p).rejects.toThrow('크래시')
  })
  it('init 응답 ok 면 resolve', async () => {
    const w = new FakeWorker()
    const p = waitForInit(w as unknown as Worker, () => {})
    w.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'init', ok: true } }))
    await expect(p).resolves.toBeUndefined()
  })
  it('init 타임아웃이면 reject', async () => {
    vi.useFakeTimers()
    const p = waitForInit(new FakeWorker() as unknown as Worker, () => {}, 1000)
    const assertion = expect(p).rejects.toThrow('초과')
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
  })
  it('변환 타임아웃이면 onTimeout 호출 후 reject', async () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const p = withTimeout(new Promise<never>(() => {}), 500, onTimeout)
    const assertion = expect(p).rejects.toThrow('초과')
    await vi.advanceTimersByTimeAsync(501)
    await assertion
    expect(onTimeout).toHaveBeenCalledOnce()
  })
})
