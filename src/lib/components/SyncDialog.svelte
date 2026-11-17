<script lang="ts">
  // '동기화' 대화상자: 상태 줄 → (연결 전) 연결 폼 / (연결 후) 키·사용량·연결 해제 → 문제 안내(키·한도·oversize·resync·대량 삭제).
  // 열림 상태는 syncUi.open(명령·배지가 연다). 입력 오류는 필드 옆 인라인, 작업 결과 오류는 상단 고정 영역(role=alert).
  // 키·Worker 주소는 이 대화상자와 localStorage('works.sync')에만 있고 번들·백업에는 들어가지 않는다.
  import { onDestroy, tick } from 'svelte';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Check from '@lucide/svelte/icons/check';
  import CloudOff from '@lucide/svelte/icons/cloud-off';
  import CloudCheck from '@lucide/svelte/icons/cloud-check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Pause from '@lucide/svelte/icons/pause';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Copy from '@lucide/svelte/icons/copy';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import { backdropFx, modalFx, listFx } from '../motion';
  import { modal } from '../modal';
  import { tip } from '../tooltip.svelte';
  import { errMsg } from '../store.svelte';
  import { formatAgo } from '../bundle/backupLogic';
  import ModalClose from './ModalClose.svelte';
  import Switch from './Switch.svelte';
  import { LIMITS } from '../sync/protocol';
  import { phaseLabel, phaseTone, problemTitle, usageRatio, isNearLimit, groupKeyInput } from '../sync/syncLabels';
  import {
    sync, syncUi, SyncInputError, connectNew, connectExisting, disconnect, clearSyncMeta, pause, resume, syncNow, resolveResync, resolveMassDelete,
  } from '../sync/state.svelte';

  let busy = $state('');
  let actionError = $state('');

  const close = () => { syncUi.open = false; actionError = ''; resetForms(); };

  // ---- 지금 시각(상대 시각·재시도 시각 갱신) ----
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    clearInterval(timer);
    if (syncUi.open) { now = Date.now(); timer = setInterval(() => (now = Date.now()), 30_000); }
    return () => clearInterval(timer);
  });
  onDestroy(() => clearInterval(timer));

  const fmtTime = (ts: number) => new Date(ts).toLocaleString('ko-KR');
  const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  const fmtMb = (n: number) => `${(n / 1048576).toFixed(1)}MB`;

  // ---- 상태 ----
  const status = $derived(sync.status);
  const connected = $derived(!!sync.config);
  const tone = $derived(phaseTone(status.phase));
  const problem = $derived(status.lastError);
  const syncing = $derived(status.phase === 'syncing');
  const ratios = $derived(usageRatio(status.usage));
  const KIND_NAME: Record<string, string> = { doc: '글', snippet: '글감', thread: '코멘트' };

  // ---- 연결 폼 ----
  type Mode = 'new' | 'existing';
  let mode = $state<Mode>('new');
  let workerUrl = $state('');
  let inviteCode = $state('');
  let keyInput = $state('');
  let errUrl = $state('');
  let errInvite = $state('');
  let errKey = $state('');
  let createdKey = $state(''); // 방금 만든 키를 한 번 보여 준다(보관 안내)

  function resetForms() {
    keyInput = ''; inviteCode = ''; errUrl = errInvite = errKey = ''; reKey = false; confirming = null; keyShown = false; createdKey = '';
  }

  const MODES: { id: Mode; label: string }[] = [
    { id: 'new', label: '이 기기에서 새로 시작' },
    { id: 'existing', label: '다른 기기의 키로 연결' },
  ];
  function onModeKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!fwd && !back) return;
    e.preventDefault();
    mode = mode === 'new' ? 'existing' : 'new';
    void tick().then(() => document.getElementById(`sy-mode-${mode}`)?.focus());
  }

  function onKeyInput() { keyInput = groupKeyInput(keyInput); errKey = ''; }

  /** 입력 오류는 해당 칸 옆에, 그 밖의 오류는 상단 고정 영역에 보인다 */
  function showError(e: unknown) {
    if (e instanceof SyncInputError) {
      if (e.field === 'workerUrl') { errUrl = e.message; void tick().then(() => document.getElementById('sy-url')?.focus()); }
      else if (e.field === 'inviteCode') { errInvite = e.message; void tick().then(() => document.getElementById('sy-invite')?.focus()); }
      else { errKey = e.message; void tick().then(() => document.getElementById(reKey ? 'sy-rekey' : 'sy-key')?.focus()); }
    } else {
      actionError = `동기화 설정을 저장하지 못했습니다: ${errMsg(e)}`;
    }
  }

  async function submitConnect() {
    if (busy) return;
    errUrl = errInvite = errKey = ''; actionError = '';
    busy = '연결하는 중…';
    try {
      if (mode === 'new') {
        await clearSyncMeta().catch(() => {});
        createdKey = await connectNew(workerUrl, inviteCode);
        keyShown = true;
      } else {
        await clearSyncMeta().catch(() => {});
        await connectExisting(workerUrl, keyInput);
      }
      keyInput = ''; inviteCode = '';
    } catch (e) {
      showError(e);
    } finally {
      busy = '';
    }
  }

  // ---- 키 표시·복사 ----
  let keyShown = $state(false);
  let copied = $state(false);
  let copyFallback = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  const masked = $derived((sync.config?.syncKey ?? '').replace(/[0-9A-Z]/g, '•'));

  async function copyKey() {
    const k = sync.config?.syncKey;
    if (!k) return;
    try {
      await navigator.clipboard.writeText(k);
      copied = true; copyFallback = false;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1800);
    } catch {
      // 클립보드를 못 쓰는 환경: 키를 보이고 선택해서 직접 복사하게 한다
      keyShown = true; copyFallback = true;
      void tick().then(() => { const el = document.getElementById('sy-keybox') as HTMLInputElement | null; el?.focus(); el?.select(); });
    }
  }

  // ---- 동작 ----
  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    actionError = '';
    busy = label;
    try { await fn(); } catch (e) { actionError = `${label.replace(/하는 중…$/, '하지 못했습니다')}: ${errMsg(e)}`; } finally { busy = ''; }
  }
  const doSyncNow = () => run('동기화하는 중…', syncNow);

  // 확인 단계(되돌릴 수 없는 동작): 처음 포커스는 취소에 둔다
  type Confirm = 'disconnect' | 'resync-delete' | 'mass-proceed';
  let confirming = $state<Confirm | null>(null);
  async function ask(c: Confirm) {
    confirming = c;
    await tick();
    document.getElementById('sy-confirm-cancel')?.focus();
  }
  const cancelConfirm = () => { const c = confirming; confirming = null; void tick().then(() => document.getElementById(c === 'disconnect' ? 'sy-disconnect' : c === 'mass-proceed' ? 'sy-mass-proceed' : 'sy-resync-delete')?.focus()); };

  async function doDisconnect() {
    confirming = null;
    await run('연결을 해제하는 중…', async () => {
      disconnect();
      await clearSyncMeta().catch(() => {}); // 키를 지웠으니 이 공간의 커서·rev 는 쓸모없다(글은 그대로)
      createdKey = ''; keyShown = false; mode = 'new';
    });
  }
  const doResync = (c: 'upload' | 'delete') => { confirming = null; return run(c === 'upload' ? '서버에 올리는 중…' : '이 기기에서 지우는 중…', () => resolveResync(c)); };
  const doMass = (c: 'proceed' | 'restore') => run(c === 'proceed' ? '삭제를 반영하는 중…' : '서버 사본으로 되돌리는 중…', () => resolveMassDelete(c));

  // 키 다시 입력(unauthorized·crypto)
  let reKey = $state(false);
  async function openReKey() { reKey = true; keyInput = ''; errKey = ''; await tick(); document.getElementById('sy-rekey')?.focus(); }
  async function submitReKey() {
    if (busy || !sync.config) return;
    errKey = ''; actionError = '';
    busy = '키를 확인하는 중…';
    try {
      await connectExisting(sync.config.workerUrl, keyInput);
      keyInput = ''; reKey = false;
    } catch (e) { showError(e); } finally { busy = ''; }
  }

  const toggleAuto = (on: boolean) => { if (on) resume(); else pause(); };
  const retryText = (at?: number) => (at ? `${fmtTime(at)}에 자동으로 다시 시도합니다` : '자동으로 다시 시도하지 않습니다. 지금 동기화로 다시 시도하세요');
</script>

{#if syncUi.open}
  <div class="overlay" transition:backdropFx use:modal={{ onClose: close, canClose: () => !busy }}>
    <div class="dialog wide sync" role="dialog" transition:modalFx aria-modal="true" aria-labelledby="sy-title">
      <div class="dlg-head"><h2 id="sy-title">동기화</h2><ModalClose onclick={close} disabled={!!busy} /></div>

      <!-- 상태 줄 -->
      <div class="statusrow" role="status" aria-live="polite">
        <span class="state tone-{tone}">
          {#if syncing}<RefreshCw size={16} class="spin" aria-hidden="true" />
          {:else if status.phase === 'idle'}<CloudCheck size={16} aria-hidden="true" />
          {:else if status.phase === 'offline'}<CloudOff size={16} aria-hidden="true" />
          {:else if status.phase === 'error'}<TriangleAlert size={16} aria-hidden="true" />
          {:else if status.phase === 'paused'}<Pause size={16} aria-hidden="true" />
          {:else}<Cloud size={16} aria-hidden="true" />{/if}
          <span class="txt">{phaseLabel(status)}</span>
        </span>
        {#if connected}
          <span class="when">마지막 동기화: <b>{status.lastSyncAt ? formatAgo(status.lastSyncAt, now) : '없음'}</b></span>
          <button type="button" class="syncnow" disabled={!!busy || syncing} onclick={doSyncNow}>
            <RefreshCw size={14} aria-hidden="true" />{syncing ? '동기화하는 중…' : '지금 동기화'}
          </button>
        {/if}
      </div>

      <!-- 작업 결과 안내: 스크롤 영역 밖 고정. 영역은 항상 DOM 에 있다 -->
      <div class="notices">
        <div role="status" aria-live="polite">{#if busy}<p class="busy">{busy}</p>{/if}</div>
        <div role="alert">{#if actionError}<p class="note err"><span>{actionError}</span></p>{/if}</div>
      </div>

      <div class="body">
        {#if !connected}
          <!-- ───── 연결 전 ───── -->
          <section aria-labelledby="sy-h-connect">
            <h3 id="sy-h-connect">연결</h3>
            <p class="hint">같은 키를 입력한 기기끼리 글·글감·코멘트를 공유합니다. 내용은 이 기기에서 암호화해 올리며, 서버는 읽을 수 없습니다. 서버는 직접 배포한 Cloudflare Worker 입니다.</p>

            <label class="field"><span>Worker 주소</span>
              <input id="sy-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://md-works-sync.내이름.workers.dev"
                bind:value={workerUrl} oninput={() => (errUrl = '')} aria-invalid={!!errUrl} aria-describedby={errUrl ? 'sy-url-err' : undefined} disabled={!!busy} />
            </label>
            {#if errUrl}<p id="sy-url-err" class="hint inline err" role="alert">{errUrl}</p>{/if}

            <div class="seg" role="radiogroup" aria-label="연결 방법">
              {#each MODES as m (m.id)}
                <button type="button" role="radio" id={`sy-mode-${m.id}`} aria-checked={mode === m.id} tabindex={mode === m.id ? 0 : -1}
                  class:active={mode === m.id} onclick={() => (mode = m.id)} onkeydown={onModeKey}>{m.label}</button>
              {/each}
            </div>

            <form class="connect" onsubmit={(e) => { e.preventDefault(); void submitConnect(); }}>
              {#if mode === 'new'}
                <p class="hint">이 기기에서 새 동기화 키를 만들고 서버에 새 공간을 엽니다. 다른 기기는 만들어진 키로 연결합니다.</p>
                <label class="field"><span>초대 코드</span>
                  <input id="sy-invite" type="text" autocomplete="off" spellcheck="false" placeholder="Worker 를 배포할 때 정한 코드"
                    bind:value={inviteCode} oninput={() => (errInvite = '')} aria-invalid={!!errInvite} aria-describedby={errInvite ? 'sy-invite-err' : undefined} disabled={!!busy} />
                </label>
                {#if errInvite}<p id="sy-invite-err" class="hint inline err" role="alert">{errInvite}</p>{/if}
              {:else}
                <p class="hint">다른 기기의 동기화 대화상자에서 키를 복사해 붙여 넣으세요. 공백·소문자는 자동으로 정리됩니다.</p>
                <label class="field"><span>동기화 키</span>
                  <input id="sy-key" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" class="mono" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
                    bind:value={keyInput} oninput={onKeyInput} aria-invalid={!!errKey} aria-describedby={errKey ? 'sy-key-err' : undefined} disabled={!!busy} />
                </label>
                {#if errKey}<p id="sy-key-err" class="hint inline err" role="alert">{errKey}</p>{/if}
              {/if}
              <div class="actions">
                <button type="submit" class="primary" disabled={!!busy || !workerUrl.trim() || (mode === 'new' ? !inviteCode.trim() : !keyInput)}>
                  {busy ? '연결하는 중…' : mode === 'new' ? '새로 시작' : '연결'}
                </button>
              </div>
            </form>
          </section>
        {:else}
          <!-- ───── 문제 안내 ───── -->
          {#if status.resync}
            <section class="card" aria-labelledby="sy-h-resync" transition:listFx>
              <h3 id="sy-h-resync"><TriangleAlert size={15} aria-hidden="true" /> 서버에 없는 항목이 {status.resync.orphans.length}개 있습니다</h3>
              <p class="hint">이 기기에서 오랫동안 동기화하지 않아, 서버가 그동안의 삭제 기록을 정리했습니다. 아래 항목은 서버에 없는데 이 기기에는 남아 있습니다. 어떻게 할지 고르세요.</p>
              <ul class="items" aria-label="서버에 없는 항목">
                {#each status.resync.orphans as o (o.id)}<li><span class="kind">{KIND_NAME[o.kind] ?? o.kind}</span><span class="name">{o.label}</span></li>{/each}
              </ul>
              {#if confirming === 'resync-delete'}
                <p class="line err">이 기기에서 {status.resync.orphans.length}개 항목을 지웁니다. 서버에도 없으므로 <b>되돌릴 수 없습니다.</b></p>
                <div class="actions">
                  <button type="button" id="sy-confirm-cancel" onclick={cancelConfirm} disabled={!!busy}>취소</button>
                  <button type="button" class="danger" onclick={() => doResync('delete')} disabled={!!busy}>지우기</button>
                </div>
              {:else}
                <div class="actions">
                  <button type="button" id="sy-resync-delete" onclick={() => ask('resync-delete')} disabled={!!busy}>이 기기에서 지우기…</button>
                  <button type="button" class="primary" onclick={() => doResync('upload')} disabled={!!busy}>서버에 올리기</button>
                </div>
              {/if}
            </section>
          {/if}

          {#if status.massDelete}
            <section class="card" aria-labelledby="sy-h-mass" transition:listFx>
              <h3 id="sy-h-mass"><TriangleAlert size={15} aria-hidden="true" /> 항목이 한꺼번에 사라졌습니다</h3>
              <p class="line">이 기기에서 전체 {status.massDelete.total}개 중 {status.massDelete.missing}개가 사라진 것으로 보여 동기화를 멈췄습니다.</p>
              <p class="hint">저장소를 읽지 못했거나 실제로 많이 지운 경우입니다. 실제로 지운 게 맞다면 삭제를 서버와 다른 기기에도 반영하고, 아니라면 서버 사본으로 되돌리세요.</p>
              {#if confirming === 'mass-proceed'}
                <p class="line err">전체 {status.massDelete.total}개 중 {status.massDelete.missing}개의 삭제를 서버에 반영합니다. 서버에서 지워지면 <b>다른 기기에서도 해당 글이 지워지며 되돌릴 수 없습니다.</b></p>
                <div class="actions">
                  <button type="button" id="sy-confirm-cancel" onclick={cancelConfirm} disabled={!!busy}>취소</button>
                  <button type="button" class="danger" onclick={() => { confirming = null; void doMass('proceed'); }} disabled={!!busy}>삭제 반영</button>
                </div>
              {:else}
                <div class="actions">
                  <button type="button" id="sy-mass-proceed" onclick={() => ask('mass-proceed')} disabled={!!busy}>삭제를 서버에도 반영…</button>
                  <button type="button" class="primary" onclick={() => doMass('restore')} disabled={!!busy}>서버 사본으로 되돌리기</button>
                </div>
              {/if}
            </section>
          {/if}

          {#if problem && !status.massDelete}
            <section class="card warn" aria-labelledby="sy-h-prob" transition:listFx>
              <h3 id="sy-h-prob"><TriangleAlert size={15} aria-hidden="true" /> {problemTitle(problem)}</h3>
              {#if problem.kind === 'unauthorized'}
                <p class="line">서버가 이 키를 받아 주지 않습니다. 키를 잘못 입력했거나 다른 공간의 키입니다. 동기화는 멈췄습니다.</p>
              {:else if problem.kind === 'forbidden'}
                <p class="line">초대 코드가 맞지 않거나, 허용되지 않은 앱이거나, 서버의 공간 수 한도를 넘었습니다. Worker 설정을 확인하세요.</p>
              {:else if problem.kind === 'rate-limited'}
                <p class="line">서버의 하루 쓰기 한도에 도달했습니다. {problem.retryAt ? `${fmtTime(problem.retryAt)} 이후 자동으로 이어집니다.` : '내일(UTC 0시 이후) 이어집니다.'} 그동안 글은 이 기기에 안전하게 남습니다.</p>
              {:else if problem.kind === 'unavailable'}
                <p class="line">서버가 일시적으로 응답하지 않습니다. {retryText(problem.retryAt)}.</p>
              {:else if problem.kind === 'crypto'}
                <p class="line">받은 데이터를 이 키로 풀 수 없습니다. 다른 기기와 키가 다르거나 데이터가 손상됐습니다. 키를 다시 확인하세요.</p>
              {:else if problem.kind === 'space-full' || problem.kind === 'item-limit' || problem.kind === 'item-too-large'}
                <p class="line">서버 한도(글 {LIMITS.MAX_ITEMS_PER_SPACE}개, 전체 {fmtMb(LIMITS.MAX_SPACE_BYTES)}, 글 하나 {fmtSize(LIMITS.MAX_ITEM_BYTES)}) 때문에 올리지 못한 항목이 있습니다. 쓰지 않는 글을 지우거나 글을 줄이세요.</p>
              {:else}
                <p class="line">인터넷 연결을 확인하세요. 연결되면 자동으로 이어집니다.</p>
              {/if}
              {#if problem.message}<p class="hint raw">{problem.message}</p>{/if}
              {#if problem.kind === 'unauthorized' || problem.kind === 'crypto'}
                {#if reKey}
                  <form class="rekey" onsubmit={(e) => { e.preventDefault(); void submitReKey(); }}>
                    <label class="field"><span>동기화 키</span>
                      <input id="sy-rekey" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" class="mono" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
                        bind:value={keyInput} oninput={onKeyInput} aria-invalid={!!errKey} aria-describedby={errKey ? 'sy-rekey-err' : undefined} disabled={!!busy} />
                    </label>
                    {#if errKey}<p id="sy-rekey-err" class="hint inline err" role="alert">{errKey}</p>{/if}
                    <div class="actions">
                      <button type="button" onclick={() => { reKey = false; keyInput = ''; errKey = ''; }} disabled={!!busy}>취소</button>
                      <button type="submit" class="primary" disabled={!!busy || !keyInput}>키 바꾸기</button>
                    </div>
                  </form>
                {:else}
                  <div class="actions"><button type="button" onclick={openReKey} disabled={!!busy}>키 다시 입력…</button></div>
                {/if}
              {:else if problem.kind === 'rate-limited' || problem.kind === 'unavailable' || problem.kind === 'network' || problem.kind === 'forbidden'}
                {#if problem.kind !== 'rate-limited'}<div class="actions"><button type="button" onclick={doSyncNow} disabled={!!busy || syncing}>다시 시도</button></div>{/if}
              {/if}
            </section>
          {/if}

          {#if status.oversize.length}
            <section class="card warn" aria-labelledby="sy-h-over" transition:listFx>
              <h3 id="sy-h-over"><TriangleAlert size={15} aria-hidden="true" /> 동기화되지 않는 글 {status.oversize.length}개</h3>
              <p class="hint">글 하나는 {fmtSize(LIMITS.MAX_ITEM_BYTES)}까지만 동기화됩니다. 글을 나누거나 줄이세요. 줄이면 자동으로 올라갑니다.</p>
              <ul class="items" aria-label="동기화되지 않는 글">
                {#each status.oversize as o (o.id)}<li><span class="name">{o.label}</span><span class="size">{fmtSize(o.bytes)}</span></li>{/each}
              </ul>
            </section>
          {/if}

          <!-- ───── 연결됨 ───── -->
          <section aria-labelledby="sy-h-key">
            <h3 id="sy-h-key">동기화 키</h3>
            {#if createdKey}
              <p class="line"><b>새 키를 만들었습니다.</b> 다른 기기를 연결할 때 필요합니다. 서버는 키를 모르므로 <b>잃어버리면 복구할 수 없습니다.</b> 안전한 곳에 따로 적어 두세요.</p>
            {:else}
              <p class="hint">다른 기기에서 '다른 기기의 키로 연결'을 고르고 이 키를 입력하세요. 키를 아는 사람은 누구나 이 데이터를 읽을 수 있습니다.</p>
            {/if}
            <div class="keyrow">
              <input id="sy-keybox" class="mono" readonly type="text" spellcheck="false" aria-label="동기화 키" value={keyShown ? (sync.config?.syncKey ?? '') : masked} />
              <button type="button" class="icon-btn" aria-label={keyShown ? '키 가리기' : '키 보기'} aria-pressed={keyShown} use:tip={keyShown ? '키 가리기' : '키 보기'} onclick={() => (keyShown = !keyShown)}>
                {#if keyShown}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
              </button>
              <button type="button" class="icon-btn" aria-label={copied ? '복사했습니다' : '키 복사'} use:tip={copied ? '복사했습니다' : '키 복사'} onclick={copyKey}>
                {#if copied}<Check size={16} />{:else}<Copy size={16} />{/if}
              </button>
            </div>
            <div class="sr-only" role="status" aria-live="polite">{copied ? '키를 복사했습니다' : ''}</div>
            {#if copyFallback}<p class="hint inline">클립보드를 쓸 수 없습니다. 위 입력에서 키를 선택해 직접 복사하세요.</p>{/if}
            <p class="hint">서버: <span class="mono wrap">{sync.config?.workerUrl}</span></p>
            <Switch checked={sync.enabled} onchange={toggleAuto}>자동 동기화 (끄면 멈춥니다)</Switch>
          </section>

          <section aria-labelledby="sy-h-usage">
            <h3 id="sy-h-usage">사용량</h3>
            {#if status.usage}
              {@const u = status.usage}
              {@render meter('항목 수', ratios.items, `${u.items.toLocaleString('ko-KR')} / ${LIMITS.MAX_ITEMS_PER_SPACE.toLocaleString('ko-KR')}개`)}
              {@render meter('저장 용량', ratios.bytes, `${fmtMb(u.bytes)} / ${fmtMb(LIMITS.MAX_SPACE_BYTES)}`)}
              {@render meter('오늘 쓰기', ratios.writes, `${u.dailyWrites} / ${LIMITS.MAX_DAILY_WRITES}회`)}
              {#if status.throttled}<p class="hint warn">오늘 쓰기 한도의 80% 에 가까워 올리는 간격을 5분으로 늘렸습니다.</p>{/if}
            {:else}
              <p class="hint">동기화하면 서버 사용량이 여기에 표시됩니다.</p>
            {/if}
          </section>

          <section aria-labelledby="sy-h-note">
            <h3 id="sy-h-note">동기화되는 것</h3>
            <p class="hint">글·글감·코멘트만 동기화합니다. <b>이미지는 동기화되지 않습니다.</b> 다른 기기에서 이미지를 보려면 백업의 번들로 옮기세요. 글 이력은 기기마다 따로 둡니다.</p>
          </section>

          <section aria-labelledby="sy-h-off">
            <h3 id="sy-h-off">연결 해제</h3>
            {#if confirming === 'disconnect'}
              <p class="line">이 기기의 키와 설정만 지웁니다. <b>글은 남습니다.</b> 서버와 다른 기기의 데이터는 그대로입니다. 키를 따로 적어 두지 않았다면 이 기기에서도 다시 연결할 수 없습니다.</p>
              <div class="actions">
                <button type="button" id="sy-confirm-cancel" onclick={cancelConfirm} disabled={!!busy}>취소</button>
                <button type="button" class="danger" onclick={doDisconnect} disabled={!!busy}>연결 해제</button>
              </div>
            {:else}
              <p class="hint">이 기기의 키만 지우고 글은 남습니다.</p>
              <button type="button" id="sy-disconnect" onclick={() => ask('disconnect')} disabled={!!busy}>연결 해제…</button>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#snippet meter(label: string, r: number, text: string)}
  <div class="meter" class:near={isNearLimit(r)}>
    <div class="mrow"><span>{label}</span><span class="num">{text}{#if isNearLimit(r)} · 한도 가까움{/if}</span></div>
    <div class="bar" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(r * 100)} aria-valuetext={text}><span style:width="{Math.round(r * 100)}%"></span></div>
  </div>
{/snippet}

<style>
  .dialog.sync { display: flex; flex-direction: column; max-height: min(720px, calc(100dvh - 32px)); overflow: hidden; }
  .dialog.sync .dlg-head { flex: none; }
  .statusrow { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: 13px; }
  .state { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 200px; }
  .state .txt { overflow-wrap: anywhere; }
  .tone-ok { color: var(--accent); }
  .tone-error { color: var(--danger); }
  .tone-muted, .tone-warn { color: var(--muted); }
  .tone-busy { color: var(--text); }
  .when { color: var(--muted); font-variant-numeric: tabular-nums; }
  .syncnow { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
  :global(.spin) { animation: sy-spin 1s linear infinite; }
  @keyframes sy-spin { to { rotate: 360deg; } }
  .notices { flex: none; }
  .notices > div:empty { display: none; }
  .notices > div { margin-top: 8px; }
  .note { padding: 8px 10px; border-radius: 8px; font-size: 13px; overflow-wrap: anywhere; }
  .note.err { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
  .busy { font-size: 13px; color: var(--muted); padding: 4px 10px; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding-top: 4px; }
  section { padding: 12px 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  section:first-child { border-top: 0; }
  section.card { padding: 12px; margin-top: 8px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--surface); }
  section.card.warn { border-color: color-mix(in srgb, var(--danger) 50%, var(--border)); }
  section.card + section.card, section.card + section:not(.card) { margin-top: 8px; }
  h3 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 6px; }
  section.card h3 { color: var(--danger); }
  p { margin: 0 !important; }
  .line { font-size: 13px; overflow-wrap: anywhere; }
  .hint { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .hint.inline { margin-top: -4px !important; }
  .hint.raw { font-size: 11.5px; }
  .err { color: var(--danger); }
  .warn { color: var(--danger); }
  .mono { font-family: var(--font-code); font-variant-numeric: tabular-nums; }
  .wrap { overflow-wrap: anywhere; }
  .field { display: flex; flex-direction: row; gap: 8px; align-items: center; font-size: 13px; width: 100%; }
  .field span { flex: none; min-width: 6.5em; color: var(--muted); }
  .field input { flex: 1; min-width: 0; margin: 0; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); width: auto; }
  .field input[aria-invalid='true'] { border-color: var(--danger); }
  .connect, .rekey { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .seg { width: 100%; }
  .seg button { flex: 1; }
  .keyrow { display: flex; gap: 4px; align-items: center; width: 100%; }
  .keyrow input { flex: 1; min-width: 0; margin: 0; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); width: auto; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; width: 100%; flex-wrap: wrap; }
  button.danger { background: var(--danger); border-color: var(--danger); color: var(--bg); }
  button.danger:hover:not(:disabled) { background: var(--danger); filter: brightness(1.08); }
  .items { list-style: none; margin: 0; padding: 0; width: 100%; max-height: 160px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
  .items li { display: flex; gap: 8px; align-items: baseline; padding: 4px 8px; font-size: 12.5px; border-bottom: 1px solid var(--border); }
  .items li:last-child { border-bottom: 0; }
  .items .kind { flex: none; color: var(--muted); }
  .items .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .items .size { flex: none; font-variant-numeric: tabular-nums; color: var(--muted); }
  .meter { width: 100%; font-size: 12.5px; }
  .mrow { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 3px; }
  .mrow .num { font-variant-numeric: tabular-nums; color: var(--muted); }
  .meter.near .mrow .num { color: var(--danger); font-weight: 600; }
  .bar { height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width var(--dur-2) var(--ease-out); }
  .meter.near .bar span { background: var(--danger); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) { .bar span { transition: none; } }
  @media (pointer: coarse) {
    .field input, .keyrow input { font-size: 16px; min-height: 40px; }
    .seg button, .actions button, .syncnow { min-height: 40px; }
  }
  @media (max-width: 640px) {
    .field { flex-direction: column; align-items: stretch; gap: 4px; }
  }
</style>
