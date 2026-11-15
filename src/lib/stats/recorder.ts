// 기록기: 변화량을 메모리에 모았다가 디바운스·탭 숨김·pagehide 때 한 번에 쓴다. 상태 모듈(state.svelte.ts)이 얇게 감싼다.
import { addDelta, createTracker, type Days } from './logic';
import { clearDays, commitDelta, defaultStore, readDays, type Store } from './store';

export interface RecorderOptions {
  store?: Store | null;
  now?: () => number;
  /** 마지막 변화 뒤 이만큼(ms) 지나면 쓴다. 기본 2000 */
  delayMs?: number;
  /** 보이는 값(저장된 값 + 아직 안 쓴 증분)이 바뀔 때 */
  onView?: (days: Days) => void;
}

export function createRecorder(o: RecorderOptions = {}) {
  const store = o.store === undefined ? defaultStore() : o.store;
  const now = o.now ?? Date.now;
  const delay = o.delayMs ?? 2000;
  const tracker = createTracker();
  let base: Days = readDays(store);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const view = () => addDelta(base, tracker.peek());
  const emit = () => o.onView?.(view());

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const delta = tracker.take();
    if (!Object.keys(delta).length) return;
    base = commitDelta(delta, now(), store);
    emit();
  }

  return {
    /** 지금 글(식별자)과 공백 제외 글자 수. 글이 없으면 id 를 null 로 */
    track(id: string | null, count: number) {
      const d = tracker.observe(id, count, now());
      if (d === 0) return;
      emit();
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    /** 저장된 값을 다시 읽는다(다른 탭이 썼을 때) */
    refresh() { base = readDays(store); emit(); },
    view,
    clear() {
      clearTimeout(timer);
      timer = undefined;
      tracker.take();
      clearDays(store);
      base = {};
      emit();
    },
  };
}
