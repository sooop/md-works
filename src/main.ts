import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyTheme, applyLayout } from './lib/store.svelte';

// __MODE__ 는 빌드 시 상수로 치환되어, 사용하지 않는 모드의 셸은 번들에서 제거된다.
const Shell = (
  __MODE__ === 'server'
    ? await import('./lib/components/ServerShell.svelte')
    : await import('./lib/components/StandaloneShell.svelte')
).default;

applyTheme();
applyLayout();
mount(App, { target: document.getElementById('app')!, props: { Shell } });
