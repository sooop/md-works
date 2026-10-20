// 서버 요청이 0.5초 넘게 끝나지 않으면 화면 위에 진행 표시줄(BusyBar)을 보여 주기 위한 추적.
// 짧은 요청은 표시하지 않고(깜빡임 방지), 한 번 보였으면 최소 0.3초는 둔다.
export const net = $state({ pending: 0, slow: false });

const SHOW_AFTER_MS = 500;
const MIN_SHOWN_MS = 300;
let timer: ReturnType<typeof setTimeout> | undefined;
let shownAt = 0;

export function trackNet<T>(p: Promise<T>): Promise<T> {
  net.pending++;
  if (net.pending === 1) {
    clearTimeout(timer);
    timer = setTimeout(() => { if (net.pending > 0) { net.slow = true; shownAt = Date.now(); } }, SHOW_AFTER_MS);
  }
  const done = () => {
    net.pending = Math.max(0, net.pending - 1);
    if (net.pending) return;
    clearTimeout(timer);
    if (net.slow) setTimeout(() => { if (!net.pending) net.slow = false; }, Math.max(0, MIN_SHOWN_MS - (Date.now() - shownAt)));
  };
  p.then(done, done);
  return p;
}
