// 가끔 쓰는 화면(대화상자·패널)을 처음 열 때 받아 오는 작은 도우미.
// 사용: 열림 상태가 true 가 되는 즉시 load() 를 부르고, Comp 가 생기면 그린다.
//   const dlg = lazyComponent(() => import('./Dlg.svelte'));
//   $effect(() => { if (open) dlg.load(() => (open = false)); });
//   {#if dlg.Comp}{@const D = dlg.Comp}<D bind:open />{/if}
// 한 번 받은 모듈은 다시 받지 않고, 받은 뒤에는 계속 마운트해 둔다(닫힘 애니메이션·포커스 복귀가 그대로 동작).
// 받는 동안은 아무것도 그리지 않는다. 실패하면(오프라인 등) 토스트로 알리고 onFail 로 열림 상태를 되돌린다.
import type { Component } from 'svelte';
import { toast } from './store.svelte';

export function lazyComponent<C extends Component<any, any, any>>(loader: () => Promise<{ default: C }>) {
  let comp = $state.raw<C | null>(null);
  let pending = false;
  return {
    get Comp(): C | null { return comp; },
    load(onFail?: () => void): void {
      if (comp || pending) return;
      pending = true;
      loader().then(
        (m) => { comp = m.default; },
        () => {
          toast('화면을 불러오지 못했습니다. 다시 시도해 주세요', 'error');
          onFail?.();
        },
      ).finally(() => { pending = false; });
    },
  };
}
