// 같은 출처의 다른 탭에 "저장소가 바뀌었다"를 알리는 채널(BroadcastChannel)과 탭 사이 잠금(Web Locks).
// 둘 다 없는 환경에서는 조용히 건너뛴다 — 덮어쓰기 방지는 저장 시점의 DB 검사(docDb.saveContent)가 맡으므로 알림은 화면을 빨리 맞추는 용도다.

/** 다른 탭에 보내는 알림. 받은 쪽이 저장소에서 다시 읽는다 */
export type TabMsg =
  | { t: 'docs' } // 글·폴더 목록이나 글 내용이 바뀜(저장·생성·삭제·이름·폴더·번들 병합)
  | { t: 'snippets' } // 글감이 바뀜
  | { t: 'threads'; keys: string[] } // 코멘트 스레드가 바뀜(글 id)
  | { t: 'template' } // docx 템플릿이 바뀜
  | { t: 'importing'; on: boolean }; // 번들 가져오기 시작·끝(그동안 다른 탭도 이미지 정리를 멈춘다)

export interface TabSync {
  notify(m: TabMsg): void;
  on(fn: (m: TabMsg) => void): () => void;
  close(): void;
}

/** 채널을 만든다. BroadcastChannel 이 없으면 아무것도 하지 않는 객체를 돌려준다 */
export function createTabSync(name = 'works-sync', factory: ((n: string) => BroadcastChannel) | undefined = typeof BroadcastChannel === 'function' ? (n) => new BroadcastChannel(n) : undefined): TabSync {
  const listeners = new Set<(m: TabMsg) => void>();
  let ch: BroadcastChannel | undefined;
  try {
    ch = factory?.(name);
  } catch { /* 만들 수 없는 환경(비공개 모드 등) */ }
  if (ch) {
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as TabMsg;
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
      for (const fn of [...listeners]) { try { fn(m); } catch { /* 한 수신자의 오류가 다른 수신자를 막지 않게 */ } }
    };
  }
  return {
    notify(m) { try { ch?.postMessage(m); } catch { /* 닫힌 채널 */ } },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { listeners.clear(); try { ch?.close(); } catch { /* 무시 */ } ch = undefined; },
  };
}

// ---- 앱 전역 채널: 스탠드얼론 모드가 startTabSync 로 켠다(서버 모드에서는 꺼져 있어 notify 가 아무 일도 하지 않는다) ----
let shared: TabSync | undefined;
const sharedListeners = new Set<(m: TabMsg) => void>();
let unsubShared: (() => void) | undefined;

export function startTabSync(): void {
  if (shared) return;
  shared = createTabSync();
  unsubShared = shared.on((m) => { for (const fn of [...sharedListeners]) { try { fn(m); } catch { /* 무시 */ } } });
}
export function stopTabSync(): void {
  unsubShared?.();
  unsubShared = undefined;
  shared?.close();
  shared = undefined;
}
export const notifyTabs = (m: TabMsg): void => shared?.notify(m);
/** 다른 탭의 알림을 받는다(채널이 켜지기 전에 등록해도 된다). 돌려주는 함수로 해제 */
export function onTabMessage(fn: (m: TabMsg) => void): () => void {
  sharedListeners.add(fn);
  return () => sharedListeners.delete(fn);
}

// ---- 탭 사이 잠금 ----
interface LockApi { request(name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown> }

/**
 * 다른 탭이 같은 이름의 작업을 하고 있으면 건너뛴다(false). Web Locks 가 없으면 잠금 없이 실행한다(true).
 * 이미지 정리처럼 "여럿이 동시에 돌면 안 되지만 한 번 건너뛰어도 되는" 일에 쓴다.
 */
export async function runExclusive(name: string, fn: () => Promise<void>, locks: LockApi | undefined = (typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: LockApi }).locks : undefined)): Promise<boolean> {
  if (!locks?.request) { await fn(); return true; }
  let ran = false;
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    ran = true;
    await fn();
  });
  return ran;
}
