// 정적 빌드의 오프라인 설치(PWA): 서비스 워커 등록과 "새 버전" 알림. 다른 빌드에서는 __PWA__ 가 false 라 통째로 제거된다.
import { toast } from '../store.svelte';
import { classifyInstall, shouldReload } from './state';

const CHECK_MS = 60 * 60 * 1000;

export function registerPwa() {
  if (!__PWA__) return;
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  void start();
}

async function start() {
  const sw = navigator.serviceWorker;
  let reg: ServiceWorkerRegistration;
  try { reg = await sw.register('./sw.js'); } catch { return; } // 비공개 모드 등에서는 조용히 일반 웹앱으로 쓴다

  let requested = false;
  let reloaded = false;
  sw.addEventListener('controllerchange', () => {
    if (!shouldReload(requested, reloaded)) return;
    reloaded = true;
    location.reload();
  });

  const apply = async () => {
    requested = true;
    // 저장 대기 중인 글을 먼저 기록한다(스탠드얼론 셸이 아니면 건너뜀)
    try { await (await import('../standalone-mode.svelte')).flush(); } catch { /* 새로 고침은 계속한다 */ }
    const w = reg.waiting;
    if (w) w.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  };
  const notifyUpdate = () => toast('새 버전이 있습니다', 'info', { action: { label: '새로 고침', run: () => void apply() } });

  const track = (w: ServiceWorker) => {
    w.addEventListener('statechange', () => {
      if (w.state !== 'installed') return;
      if (classifyInstall(!!sw.controller) === 'update') notifyUpdate();
      else toast('오프라인에서도 쓸 수 있습니다');
    });
  };
  if (reg.installing) track(reg.installing);
  // 이미 대기 중인 워커(이전 방문에서 받아 둔 것)는 알림을 놓쳤을 수 있으니 다시 알린다
  else if (reg.waiting && sw.controller) notifyUpdate();
  reg.addEventListener('updatefound', () => { if (reg.installing) track(reg.installing); });

  let lastNotice = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void reg.update().catch(() => {});
    // 토스트는 8초 뒤 사라지므로, 아직 대기 중이면 돌아왔을 때 다시 알린다(1분에 한 번까지)
    if (reg.waiting && sw.controller && Date.now() - lastNotice > 60_000) { lastNotice = Date.now(); notifyUpdate(); }
  });
  setInterval(() => { void reg.update().catch(() => {}); }, CHECK_MS);
}
