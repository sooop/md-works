import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyTheme, settings } from './lib/store.svelte';
import { applyStoredDesign } from './lib/design/state.svelte';

// 셸 번들을 기다리는 동안 흰 화면이 번쩍이지 않도록 테마·디자인을 먼저 적용한다
applyTheme();
document.documentElement.dataset.anim = __ANIM__ && settings.animations ? 'on' : 'off';
applyStoredDesign();

// __MODE__ 는 빌드 시 상수로 치환되어, 사용하지 않는 모드의 셸은 번들에서 제거된다.
const Shell = (
  __MODE__ === 'server'
    ? await import('./lib/components/ServerShell.svelte')
    : await import('./lib/components/StandaloneShell.svelte')
).default;

mount(App, { target: document.getElementById('app')!, props: { Shell } });
