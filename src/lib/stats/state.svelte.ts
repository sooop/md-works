// 집필 통계의 화면 상태: 기록기를 하나 두고, 보이는 값·오늘 날짜를 반응형으로 노출한다.
import { createRecorder } from './recorder';
import { dateKey, type Days } from './logic';
import { STATS_KEY } from './store';

export const stats = $state<{ days: Days; today: string }>({ days: {}, today: dateKey(Date.now()) });

const rec = createRecorder({ onView: (d) => { stats.days = d; stats.today = dateKey(Date.now()); } });
stats.days = rec.view();

/** 통계 창을 열어 달라는 요청. 상태 표시줄의 단추가 숨는 좁은 화면에서는 명령 팔레트가 이 값을 켠다 */
export const statsUi = $state({ open: false });

export const trackDoc = rec.track;
export const clearStats = rec.clear;
export const flushStats = rec.flush;

/** 탭 숨김·pagehide·다른 탭의 기록·자정 넘김을 감시한다. 정리 함수를 돌려준다 */
export function startStats(): () => void {
  const onHide = () => { if (document.visibilityState === 'hidden') rec.flush(); };
  const onPageHide = () => rec.flush();
  const onStorage = (e: StorageEvent) => { if (e.key === STATS_KEY || e.key === null) rec.refresh(); };
  const tick = setInterval(() => { stats.today = dateKey(Date.now()); }, 60_000); // 자정을 넘기면 '오늘' 이 바뀐다
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('storage', onStorage);
  rec.refresh();
  return () => {
    rec.flush();
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('storage', onStorage);
  };
}
