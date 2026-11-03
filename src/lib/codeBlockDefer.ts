// 코드 블록(placeholder ↔ CodeMirror) 교체를 스크롤이 멈춘 뒤로 미룬다.
// @milkdown/components 는 코드 블록이 화면 200px 안으로 들어오면 CodeMirror 를 동기로 만든다(생성 비용이 커서 모바일 스크롤이 멈칫한다).
// placeholder 와 CodeMirror 의 높이를 같게 맞춰 두었으므로(app.css) 교체 시점을 늦춰도 화면은 움직이지 않는다.
// 라이브러리 내부(private) 메서드를 prototype 에서 감싼다 — 메서드가 없으면(버전 변경) 아무것도 하지 않는다.
import { CodeMirrorBlock } from '@milkdown/components/code-block';

type Block = {
  dom: HTMLElement;
  initialized: boolean;
  initializeCodeMirror(): void;
  teardownCodeMirror(): void;
  selectNode(): void;
  setSelection(anchor: number, head: number): boolean | undefined;
};

const IDLE_MS = 120; // 스크롤 이벤트가 이만큼 없으면 멈춘 것으로 본다
const MARGIN = 300; // 화면 위아래로 이만큼 안의 블록만 만든다 (라이브러리의 감지 범위 200px + 여유)

let installed = false;
let scrolling = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let forceNow = 0; // selectNode/setSelection 안에서는 바로 만들어야 한다(곧바로 this.cm 을 쓴다)
let draining = false;
const queue = new Set<Block>();

const nearViewport = (b: Block) => {
  if (!b.dom.isConnected) return false;
  const r = b.dom.getBoundingClientRect();
  return r.bottom > -MARGIN && r.top < window.innerHeight + MARGIN;
};

function drain() {
  if (draining) return;
  draining = true;
  const step = () => {
    if (scrolling) { draining = false; return; }
    const next = queue.values().next().value as Block | undefined;
    if (!next) { draining = false; return; }
    queue.delete(next);
    try {
      if (!next.initialized && nearViewport(next)) next.initializeCodeMirror.call(next);
    } finally {
      requestAnimationFrame(step); // 한 프레임에 하나씩. 생성이 던져도 draining 이 풀려 나머지 블록이 계속 만들어진다
    }
  };
  requestAnimationFrame(step);
}

function onScroll() {
  scrolling = true;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { scrolling = false; if (queue.size) drain(); }, IDLE_MS);
}

export function deferCodeMirrorDuringScroll() {
  if (installed) return;
  const proto = CodeMirrorBlock?.prototype as unknown as Block | undefined;
  if (!proto || typeof proto.initializeCodeMirror !== 'function' || typeof proto.teardownCodeMirror !== 'function') return;
  installed = true;

  const init = proto.initializeCodeMirror;
  proto.initializeCodeMirror = function (this: Block) {
    if (this.initialized) return;
    if (forceNow > 0 || !scrolling) return init.call(this);
    queue.add(this); // 스크롤 중 화면 진입 → 멈춘 뒤에 만든다
  };

  // 사용자가 직접 선택·편집하는 경로는 즉시 만든다
  for (const name of ['selectNode', 'setSelection'] as const) {
    const orig = proto[name] as (...a: never[]) => unknown;
    (proto as unknown as Record<string, unknown>)[name] = function (this: Block, ...args: never[]) {
      forceNow++;
      try { return orig.apply(this, args); } finally { forceNow--; }
    };
  }

  // 화면 밖으로 나간 블록의 해제도 스크롤 중에는 미룬다(그 사이 다시 보이면 건너뛴다)
  const tear = proto.teardownCodeMirror;
  const safeTear = function (this: Block) {
    if (!this.dom.isConnected) return;
    if (scrolling) { setTimeout(() => safeTear.call(this), 1000); return; }
    if (nearViewport(this)) return;
    tear.call(this);
  };
  proto.teardownCodeMirror = safeTear;

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}
