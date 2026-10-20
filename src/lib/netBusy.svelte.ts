// 서버 요청이 0.5초 넘게 끝나지 않으면 화면 위에 진행 표시줄(BusyBar)을 보여 주기 위한 추적.
// 짧은 요청은 표시하지 않고(깜빡임 방지), 한 번 보였으면 최소 0.3초는 둔다.
// 진행 중인 요청 수는 일반 변수로 센다. $state 로 두면 요청을 시작하는 $effect 안에서 읽고 쓰는 셈이 되어,
// 요청이 끝날 때마다 그 효과가 다시 실행되며 요청을 또 보내는 끝없는 반복이 된다(이력 창이 계속 '불러오는 중'이던 원인).
export const net = $state({ slow: false });

const SHOW_AFTER_MS = 500;
const MIN_SHOWN_MS = 300;
let pending = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let shownAt = 0;

export function trackNet<T>(p: Promise<T>): Promise<T> {
  pending++;
  if (pending === 1) {
    clearTimeout(timer);
    timer = setTimeout(() => { if (pending > 0) { net.slow = true; shownAt = Date.now(); } }, SHOW_AFTER_MS);
  }
  const done = () => {
    pending = Math.max(0, pending - 1);
    if (pending) return;
    clearTimeout(timer);
    if (net.slow) setTimeout(() => { if (!pending) net.slow = false; }, Math.max(0, MIN_SHOWN_MS - (Date.now() - shownAt)));
  };
  p.then(done, done);
  return p;
}
