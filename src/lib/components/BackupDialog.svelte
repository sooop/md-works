<script lang="ts">
  import { backdropFx, modalFx } from '../motion';
  import { tip } from '../tooltip.svelte';
  import { modal } from '../modal';
  import ModalClose from './ModalClose.svelte';
  import Switch from './Switch.svelte';
  // 상단바 '백업' 버튼 + 모달. 탭 두 개:
  //  - 내보내기·가져오기: 번들 내려받기, 가져오기(미리보기·병합·삭제 묘비 선택·조각 파일)
  //  - 자동 백업: (서버 모드) 노트 폴더 백업과 복원, 텔레그램 올리기, 백업 알림
  // 오류·진행·성공 안내는 탭 아래 고정 영역(backupUi.notice / busy)에 보인다.
  import { onMount, tick } from 'svelte';
  import DatabaseBackup from '@lucide/svelte/icons/database-backup';
  import X from '@lucide/svelte/icons/x';
  import { errMsg } from '../store.svelte';
  import { reload as reloadSnippets } from '../snippets/state.svelte';
  import { previewBundle, applyBundle, type MergePreview, type MergeResult, type DocAction } from '../bundle/api';
  import BundleDeletions from './BundleDeletions.svelte';
  import { BundleCryptoError } from '../bundle/crypto';
  import { checkPasswordPair } from '../bundle/passwordInput';
  import { NOTIFY_DAY_CHOICES, folderBackupKind, isFailing, type PathStatus } from '../bundle/backupLogic';
  import { MIN_AUTO_MINUTES, getMe, sendMessage } from '../bundle/telegram';
  import {
    backup, backupUi, ago, lastBackupAt, hasUnbacked, isStale, telegramStale, keyAvailable, exportToFile, readImportSource, decodeImportSource, needsPassword, type ImportSource,
    persistTelegram, persistBackupSettings, telegramReady, uploadToTelegram, resumeTelegramUpload, canResumeTelegram, resumeMissesChange, startBackupScheduler, pathStatus,
    listFolderBackups, backupToFolder, folderBackupUrl, fetchFolderBackup, showNotice, clearNotice,
    FOLDER_DEFAULT_MINUTES, type FolderBackup, type BackupTab,
  } from '../bundle/backupState.svelte';

  let { server = false, trigger = true }: { server?: boolean; trigger?: boolean } = $props();

  const hasKey = keyAvailable();
  let exportKind = $state<'enc' | 'pw' | 'zip'>(hasKey ? 'enc' : 'zip');
  let busy = $state('');

  // 비밀번호 내보내기 입력. 이 컴포넌트의 메모리에만 두고 저장하지 않으며, 내려받은 뒤·창을 닫을 때 비운다.
  let pwValue = $state('');
  let pwConfirm = $state('');
  let pwShow = $state(false);
  const pwCheck = $derived(checkPasswordPair(pwValue, pwConfirm));
  const clearExportPw = () => { pwValue = ''; pwConfirm = ''; pwShow = false; };

  const fail = (text: string) => showNotice('error', text);
  const ok = (text: string) => showNotice('success', text);

  // ---- 탭 (WAI-ARIA tabs: ←/→/Home/End, roving tabindex, 선택하면 바로 전환) ----
  const TABS: { id: BackupTab; label: string }[] = [
    { id: 'transfer', label: '내보내기·가져오기' },
    { id: 'auto', label: '자동 백업' },
  ];
  const tabId = (id: BackupTab) => `bk-tab-${id}`;
  const panelId = (id: BackupTab) => `bk-panel-${id}`;
  const tab = $derived(backupUi.tab);

  function selectTab(id: BackupTab, focus = false) {
    backupUi.tab = id;
    if (focus) void tick().then(() => document.getElementById(tabId(id))?.focus());
  }
  function onTabKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const n = TABS.length;
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    selectTab(TABS[to].id, true);
  }

  // ---- 내보내기 형식 라디오 (roving tabindex + 화살표키) ----
  const KINDS = [
    { id: 'enc', label: '암호화 (.mwb)' },
    { id: 'pw', label: '비밀번호로 암호화 (.mwb)' },
    { id: 'zip', label: '평문 zip' },
  ] as const;
  function onKindKey(e: KeyboardEvent) {
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!fwd && !back) return;
    const usable = KINDS.filter((k) => k.id !== 'enc' || hasKey);
    if (usable.length < 2) return;
    e.preventDefault();
    const i = usable.findIndex((k) => k.id === exportKind);
    const next = usable[(i + (fwd ? 1 : -1) + usable.length) % usable.length];
    exportKind = next.id;
    void tick().then(() => document.getElementById(`bk-kind-${next.id}`)?.focus());
  }

  // ---- 가져오기 ----
  let importName = $state('');
  let bytes = $state<Uint8Array | null>(null);
  let preview = $state<MergePreview | null>(null);
  let applyDesignToo = $state(false);
  let applyDeletions = $state(false);
  let result = $state<MergeResult | null>(null);

  const ACTION_LABEL: Record<DocAction, string> = {
    add: '추가', update: '갱신', conflict: '충돌', same: '동일', 'keep-local': '로컬 유지',
  };
  const ACTIONS: DocAction[] = ['add', 'update', 'conflict', 'same', 'keep-local'];
  const actionCount = (a: DocAction) => preview?.docs.filter((d) => d.action === a).length ?? 0;
  const applicable = $derived(!!preview && (preview.docs.some((d) => d.action !== 'same' && d.action !== 'keep-local') || preview.designDiffers || (applyDeletions && preview.deletions.some((d) => d.action === 'delete'))
    || preview.snippets.add + preview.snippets.update + preview.threads.add + preview.threads.update + preview.versions.add > 0));

  // 비밀번호(MWB2) 파일을 가져올 때의 입력 단계. 읽은 암호문 바이트만 들고 있고, 비밀번호는 시도할 때마다 비운다.
  let pwStep = $state<{ src: ImportSource; label: string } | null>(null);
  let pwInput = $state('');
  let pwError = $state('');
  let pwImportShow = $state(false);

  function resetImport() {
    importName = ''; bytes = null; preview = null; result = null; applyDesignToo = false; applyDeletions = false;
    pwStep = null; pwInput = ''; pwError = ''; pwImportShow = false;
  }

  function explain(e: unknown): string {
    if (e instanceof BundleCryptoError) {
      if (e.code === 'no-key') return '이 빌드에는 복호화 키가 없어 .mwb 를 열 수 없습니다 (VITE_BUNDLE_KEY)';
      if (e.code === 'auth-failed') return '다른 키로 만든 파일이거나 파일이 변조·손상되었습니다';
      if (e.code === 'truncated') return '파일이 잘려 있습니다. 다시 받아 보세요';
      // MWB2: GCM 은 틀린 비밀번호와 손상을 구분할 수 없어 한 문장으로 안내한다. 헤더가 깨진 경우만 따로 안내한다
      if (e.code === 'password-failed') return '비밀번호가 맞지 않거나 파일이 손상되었습니다';
      if (e.code === 'bad-header') return '파일이 손상되었습니다. 다시 받아 보세요';
      if (e.code === 'password-required') return '비밀번호가 필요한 파일입니다';
    }
    return errMsg(e);
  }

  const focusPw = () => void tick().then(() => document.getElementById('bk-import-pw')?.focus());

  /** 비밀번호로 잠긴 파일: 틀리면 같은 자리에서 다시 입력하고, 취소하면 가져오기를 접는다 */
  async function submitPassword() {
    const step = pwStep;
    const pw = pwInput;
    if (!step || !pw || busy) return;
    pwInput = '';
    pwError = '';
    clearNotice();
    busy = '비밀번호를 확인하는 중… (키를 만드는 데 잠시 걸립니다)';
    try {
      const b = await decodeImportSource(step.src, pw);
      const p = await previewBundle(b);
      importName = step.label;
      bytes = b;
      preview = p;
      pwStep = null;
      pwImportShow = false;
    } catch (e) {
      if (e instanceof BundleCryptoError && e.code === 'password-failed') {
        pwError = explain(e);
        focusPw();
      } else {
        pwStep = null;
        fail(`'${step.label}' 을(를) 읽지 못했습니다: ${explain(e)}`);
      }
    } finally {
      busy = '';
    }
  }
  const cancelPassword = () => { pwStep = null; pwInput = ''; pwError = ''; pwImportShow = false; clearNotice(); };

  async function loadFiles(files: File[]): Promise<boolean> {
    resetImport();
    clearNotice();
    busy = '번들을 읽는 중…';
    const label = files.length > 1 ? `조각 ${files.length}개` : (files[0]?.name ?? '');
    try {
      const src = await readImportSource(files);
      if (needsPassword(src)) {
        pwStep = { src, label };
        backupUi.tab = 'transfer';
        focusPw();
        return false; // 비밀번호를 받은 뒤 submitPassword 가 미리보기로 잇는다
      }
      const b = await decodeImportSource(src);
      const p = await previewBundle(b);
      importName = label;
      bytes = b;
      preview = p;
      return true;
    } catch (e) {
      fail(`'${label}' 을(를) 읽지 못했습니다: ${explain(e)}`);
      return false;
    } finally {
      busy = '';
    }
  }

  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.mwb,.zip,.json,.001,.002,.003,.004,.005,application/zip,application/octet-stream';
    input.onchange = () => { const fs = [...(input.files ?? [])]; if (fs.length) void loadFiles(fs); };
    input.click();
  }

  async function apply() {
    if (!bytes) return;
    clearNotice();
    busy = '병합하는 중…';
    try {
      // 글·트리·열린 편집기는 앱이 병합 직후 스스로 다시 읽는다(afterApply). 글감 패널만 여기서 다시 읽는다.
      const r = await applyBundle(bytes, { applyDesign: applyDesignToo, applyDeletions });
      result = r;
      preview = null;
      bytes = null;
      if (r.snippets > 0) void reloadSnippets();
      const parts = [`글 ${r.docsAdded}개 추가`, `${r.docsUpdated}개 갱신`];
      if (r.conflicts.length) parts.push(`충돌 ${r.conflicts.length}개`);
      if (r.docsDeleted) parts.push(`삭제 ${r.docsDeleted}개`);
      ok(`병합했습니다: ${parts.join(', ')}`);
    } catch (e) {
      fail(`병합하지 못했습니다: ${explain(e)}`);
    } finally {
      busy = '';
    }
  }

  // 앱 전체 드롭(.mwb / 번들 zip)이 들어오면 열려 있는 이 대화상자의 가져오기 탭에서 이어 받는다
  $effect(() => {
    if (backupUi.open && backupUi.pending) {
      const f = backupUi.pending;
      backupUi.pending = null;
      backupUi.tab = 'transfer';
      void loadFiles(f);
    }
  });

  // ---- 내보내기 ----
  async function doExport() {
    const usePw = exportKind === 'pw';
    if (usePw && pwCheck.blocked) return;
    clearNotice();
    busy = '번들을 만드는 중…';
    try {
      const name = usePw
        ? await exportToFile(true, { password: pwValue, onStage: () => { busy = '비밀번호로 암호화하는 중… (키를 만드는 데 잠시 걸립니다)'; } })
        : await exportToFile(exportKind === 'enc');
      if (usePw) clearExportPw();
      ok(`백업 파일을 내려받았습니다: ${name}`);
    } catch (e) {
      fail(`백업 파일을 만들지 못했습니다: ${errMsg(e)}`);
    } finally {
      busy = '';
    }
  }

  // ---- 텔레그램 ----
  async function tgTest() {
    clearNotice();
    busy = '연결을 확인하는 중…';
    try {
      const t = $state.snapshot(backup.telegram);
      const me = await getMe(t);
      await sendMessage(t, `md-works 연결 테스트 (${new Date().toLocaleString('ko-KR')})`);
      ok(`텔레그램 연결을 확인했습니다: @${me.username ?? me.first_name ?? '봇'} → chat ${t.chatId}`);
    } catch (e) {
      fail(`텔레그램 연결을 확인하지 못했습니다: ${errMsg(e)}`);
    } finally {
      busy = '';
    }
  }
  async function tgUpload() {
    clearNotice();
    busy = '텔레그램에 올리는 중…';
    try {
      const name = await uploadToTelegram();
      ok(`텔레그램에 올렸습니다: ${name}`);
    } catch (e) {
      fail(`텔레그램에 올리지 못했습니다: ${errMsg(e)}`);
    } finally {
      busy = '';
    }
  }

  async function tgResume() {
    clearNotice();
    busy = '텔레그램에 이어 올리는 중…';
    try {
      const name = await resumeTelegramUpload();
      ok(`텔레그램에 이어 올렸습니다: ${name}`);
    } catch (e) {
      fail(`텔레그램에 이어 올리지 못했습니다: ${errMsg(e)}`);
    } finally {
      busy = '';
    }
  }

  // ---- 서버 노트 폴더 백업 ----
  let folderList = $state<FolderBackup[]>([]);
  async function refreshFolder() {
    if (!server) return;
    try { folderList = await listFolderBackups(); } catch (e) { fail(`폴더 백업 목록을 읽지 못했습니다: ${errMsg(e)}`); }
  }
  async function folderNow() {
    clearNotice();
    busy = '노트 폴더에 백업하는 중…';
    try {
      const name = await backupToFolder();
      ok(`노트 폴더에 백업했습니다: ${name}`);
      await refreshFolder();
    } catch (e) {
      fail(`노트 폴더에 백업하지 못했습니다: ${errMsg(e)}`);
    } finally {
      busy = '';
    }
  }
  /** 폴더 백업 하나를 서버에서 받아 가져오기 탭의 미리보기 → '병합 적용' 흐름으로 넘긴다 */
  async function restoreFolder(f: FolderBackup) {
    clearNotice();
    busy = `${f.name} 을(를) 받는 중…`;
    let file: File;
    try {
      file = await fetchFolderBackup(f.name);
    } catch (e) {
      fail(`'${f.name}' 을(를) 받지 못했습니다: ${errMsg(e)}`);
      busy = '';
      return;
    }
    if (await loadFiles([file])) {
      selectTab('transfer');
      ok(`'${f.name}' 을(를) 읽었습니다. 미리보기를 확인한 뒤 병합 적용을 누르세요`);
    }
  }

  $effect(() => { if (backupUi.open) void refreshFolder(); });

  onMount(() => { startBackupScheduler(); });

  const fmtTime = (ts: number) => (ts ? new Date(ts).toLocaleString('ko-KR') : '없음');
  const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  const close = () => { backupUi.open = false; clearNotice(); clearExportPw(); cancelPassword(); };
  const dotOn = $derived(isStale());
  const tgStatus = $derived(pathStatus('telegram'));
  const folderStatus = $derived(pathStatus('folder'));
  const exportStatus = $derived(pathStatus('export'));
  // '자동 백업' 탭에 문제가 있으면 탭 제목에 점을 단다
  const autoProblem = $derived(isFailing(tgStatus) || telegramStale() || (server && isFailing(folderStatus)));
</script>

{#snippet statusLine(label: string, s: PathStatus, stale = false)}
  <p class="line">{label}: <b>{s.lastSuccess ? `${fmtTime(s.lastSuccess)} (${ago(s.lastSuccess)})` : '없음'}</b></p>
  {#if isFailing(s)}
    <p class="line warn">실패 중: {s.failMsg || '이유를 알 수 없습니다'} ({fmtTime(s.failAt)})</p>
  {:else if stale}
    <p class="line warn">마지막 성공 뒤로 오래 올리지 못했습니다</p>
  {/if}
{/snippet}

{#if trigger}
<button
  class="icon-btn backup-btn"
  aria-label={dotOn ? '백업 (필요)' : '백업'}
  use:tip={dotOn ? '백업한 지 오래됐습니다 — 백업' : '백업 · 가져오기'}
  onclick={() => (backupUi.open = true)}
>
  <DatabaseBackup size={18} />{#if dotOn}<span class="dot-badge" aria-hidden="true"></span>{/if}
</button>
{/if}

{#if backupUi.open}
  <div class="overlay" transition:backdropFx use:modal={{ onClose: close, canClose: () => !busy }}>
    <div class="dialog wide backup" role="dialog" transition:modalFx aria-modal="true" aria-labelledby="bk-title">
      <div class="dlg-head"><h2 id="bk-title">백업</h2><ModalClose onclick={close} disabled={!!busy} /></div>

      <p class="line summary">
        마지막 백업: <b>{lastBackupAt() ? `${fmtTime(lastBackupAt())} (${ago(lastBackupAt())})` : '없음'}</b>
        {#if hasUnbacked()}<span class="warn"> · 이후 변경이 있습니다</span>{:else if lastBackupAt()}<span class="ok"> · 최신 상태입니다</span>{/if}
      </p>

      <div class="sidetabs bk-tabs" role="tablist" aria-label="백업 구분">
        {#each TABS as t (t.id)}
          <button
            role="tab" id={tabId(t.id)} aria-selected={tab === t.id} aria-controls={panelId(t.id)} tabindex={tab === t.id ? 0 : -1}
            class:on={tab === t.id} onclick={() => selectTab(t.id)} onkeydown={onTabKey}
          >{t.label}{#if t.id === 'auto' && autoProblem}<span class="tab-dot" aria-hidden="true"></span><span class="sr-only"> (확인 필요)</span>{/if}</button>
        {/each}
      </div>

      <!-- 진행·성공·오류 안내: 스크롤하는 내용 밖(탭 바로 아래)에 고정한다. 영역은 항상 있어야 내용이 바뀔 때 읽어 준다 -->
      <div class="notices">
        <div role="status" aria-live="polite">
          {#if busy}
            <p class="busy">{busy}{#if backupUi.tgProgress} (조각 {backupUi.tgProgress}){/if}</p>
          {:else if backupUi.notice?.kind === 'success'}
            <p class="note ok">
              <span>{backupUi.notice.text}</span>
              <button type="button" class="icon-btn" aria-label="안내 닫기" onclick={clearNotice}><X size={14} /></button>
            </p>
          {/if}
        </div>
        <div role="alert">
          {#if backupUi.notice?.kind === 'error'}
            <p class="note err">
              <span>{backupUi.notice.text}</span>
              <button type="button" class="icon-btn" aria-label="안내 닫기" onclick={clearNotice}><X size={14} /></button>
            </p>
          {/if}
        </div>
      </div>

      <!-- 내보내기·가져오기 -->
      <div class="tabpane bk-pane" role="tabpanel" id={panelId('transfer')} aria-labelledby={tabId('transfer')} hidden={tab !== 'transfer'}>
        <section aria-labelledby="bk-h-export">
          <h3 id="bk-h-export">내보내기</h3>
          <div class="seg" role="radiogroup" aria-label="내보내기 형식">
            {#each KINDS as k (k.id)}
              <button
                role="radio" id={`bk-kind-${k.id}`} aria-checked={exportKind === k.id} tabindex={exportKind === k.id ? 0 : -1}
                class:active={exportKind === k.id} disabled={k.id === 'enc' && !hasKey}
                onclick={() => (exportKind = k.id)} onkeydown={onKindKey}
              >{k.label}</button>
            {/each}
          </div>
          {#if exportKind === 'pw'}
            <p class="hint">내가 정한 비밀번호로 잠급니다. 비밀번호는 저장하지 않으며, <b>비밀번호를 잊으면 이 파일은 복구할 수 없습니다.</b> 자동 백업·텔레그램은 이 방식을 쓰지 않습니다.</p>
            <label class="field"><span>비밀번호</span>
              <input type={pwShow ? 'text' : 'password'} autocomplete="new-password" spellcheck="false" bind:value={pwValue} disabled={!!busy} />
            </label>
            <label class="field"><span>비밀번호 확인</span>
              <input type={pwShow ? 'text' : 'password'} autocomplete="new-password" spellcheck="false" bind:value={pwConfirm} disabled={!!busy} />
            </label>
            <label class="show-pw"><input type="checkbox" bind:checked={pwShow} /> 비밀번호 보기</label>
            {#if pwCheck.warning}<p class="hint warn">{pwCheck.warning}</p>{/if}
            {#if pwCheck.blocked}<p class="hint" class:warn={!!pwConfirm}>{pwCheck.blocked}</p>{/if}
          {:else if !hasKey}
            <p class="hint">이 빌드에는 암호화 키(VITE_BUNDLE_KEY)가 없어 빌드 키 암호화는 쓸 수 없습니다. 비밀번호로 암호화하거나 평문 zip 으로 내보내세요. 텔레그램 올리기도 쓸 수 없습니다.</p>
          {:else if exportKind === 'enc'}
            <p class="hint">이 앱 빌드에 들어 있는 키로 잠급니다. 같은 빌드를 가진 사람은 열 수 있으므로 비밀번호 수준의 보호는 아닙니다.</p>
          {:else}
            <p class="hint">잠그지 않은 파일이라 누구나 열 수 있습니다. 보관·전달에 주의하세요.</p>
          {/if}
          <button class="primary" disabled={!!busy || (exportKind === 'pw' && !!pwCheck.blocked)} onclick={doExport}>내려받기</button>
          {#if exportStatus.lastSuccess}<p class="hint">마지막 내려받기: {fmtTime(exportStatus.lastSuccess)} ({ago(exportStatus.lastSuccess)})</p>{/if}
        </section>

        <section aria-labelledby="bk-h-import">
          <h3 id="bk-h-import">가져오기</h3>
          <p class="hint">.mwb 또는 번들 zip 을 고르거나 앱 창에 끌어다 놓으세요. 조각(<code>.mwb.001</code>, <code>.002</code> …)은 모두 함께 고릅니다. 병합 전에 미리보기를 보여 줍니다.</p>
          <button disabled={!!busy} onclick={pickFile}>파일 선택…</button>

          {#if pwStep}
            <form class="pwstep" onsubmit={(e) => { e.preventDefault(); void submitPassword(); }}>
              <p class="line"><b>{pwStep.label}</b> 은(는) 비밀번호로 잠긴 파일입니다. 비밀번호를 입력하세요.</p>
              <label class="field"><span>비밀번호</span>
                <input id="bk-import-pw" type={pwImportShow ? 'text' : 'password'} autocomplete="off" spellcheck="false" bind:value={pwInput} disabled={!!busy} />
              </label>
              <label class="show-pw"><input type="checkbox" bind:checked={pwImportShow} /> 비밀번호 보기</label>
              {#if pwError}<p class="hint warn" role="alert">{pwError}. 다시 입력해 보세요.</p>{/if}
              <div class="actions">
                <button type="button" onclick={cancelPassword} disabled={!!busy}>취소</button>
                <button type="submit" class="primary" disabled={!!busy || !pwInput}>열기</button>
              </div>
            </form>
          {/if}

          {#if preview}
            <p class="line"><b>{importName}</b> — {new Date(preview.createdAt).toLocaleString('ko-KR')} · {preview.mode === 'server' ? '서버' : '스탠드얼론'}에서 만듦</p>
            <div class="tbl-wrap">
              <table aria-label="병합 미리보기 요약">
                <thead><tr>{#each ACTIONS as a}<th>글 {ACTION_LABEL[a]}</th>{/each}<th>글감 추가/갱신</th><th>스레드 추가/갱신</th><th>이력 추가</th></tr></thead>
                <tbody><tr>
                  {#each ACTIONS as a}<td class:warn={a === 'conflict' && actionCount(a) > 0}>{actionCount(a)}</td>{/each}
                  <td>{preview.snippets.add}/{preview.snippets.update}</td>
                  <td>{preview.threads.add}/{preview.threads.update}</td>
                  <td>{preview.versions.add}</td>
                </tr></tbody>
              </table>
            </div>
            {#if preview.docs.some((d) => d.action !== 'same')}
              <div class="tbl-wrap list">
                <table aria-label="글별 병합 결과">
                  <thead><tr><th>글</th><th>처리</th></tr></thead>
                  <tbody>
                    {#each preview.docs.filter((d) => d.action !== 'same') as d (d.name)}
                      <tr><td>{d.name}</td><td class:warn={d.action === 'conflict'}>{ACTION_LABEL[d.action]}</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
            {#if actionCount('conflict')}
              <p class="hint">충돌한 글은 진 쪽 내용이 '병합 전' 이름의 버전으로 이력에 보존됩니다.</p>
            {/if}
            <BundleDeletions {preview} bind:applyDeletions />
            {#if preview.designDiffers}
              <Switch bind:checked={applyDesignToo}>디자인도 적용 (번들의 디자인 설정이 현재와 다릅니다)</Switch>
            {/if}
            <div class="actions">
              <button onclick={resetImport} disabled={!!busy}>취소</button>
              <button class="primary" onclick={apply} disabled={!!busy || !applicable}>병합 적용</button>
            </div>
            {#if !applicable}<p class="hint">바뀔 내용이 없습니다.</p>{/if}
          {/if}

          {#if result}
            <div class="tbl-wrap">
              <table aria-label="병합 결과">
                <thead><tr><th>글 추가</th><th>글 갱신</th><th>충돌</th><th>글감</th><th>스레드</th><th>이력</th><th>디자인</th></tr></thead>
                <tbody><tr>
                  <td>{result.docsAdded}</td><td>{result.docsUpdated}</td><td class:warn={result.conflicts.length > 0}>{result.conflicts.length}</td>
                  <td>{result.snippets}</td><td>{result.threads}</td><td>{result.versions}</td><td>{result.designApplied ? '적용' : '-'}</td>
                </tr></tbody>
              </table>
            </div>
            {#if result.conflicts.length}
              <p class="hint">충돌한 글은 '병합 전' 이력 버전으로 보존되었습니다: {result.conflicts.join(', ')}</p>
            {/if}
            {#if result.docsDeleted}
              <p class="hint">다른 기기에서 지운 글 {result.docsDeleted}개를 삭제했습니다. 내용은 '삭제 전' 글감으로 글감함에 보관되었습니다.</p>
            {/if}
            <!-- 글·글 목록·열린 편집기·글감 패널은 병합 직후 자동으로 다시 읽는다. 코멘트 상태는 열린 글에 묶여 있어 여기서 다시 읽을 수 없으므로, 코멘트가 바뀐 경우에만 새로 고침을 안내한다 -->
            {#if result.threads > 0}
              <div class="actions left">
                <button onclick={() => location.reload()}>새로 고침</button>
                <span class="hint">열려 있는 글의 코멘트를 반영하려면 새로 고침하세요.</span>
              </div>
            {/if}
          {/if}
        </section>
      </div>

      <!-- 자동 백업 -->
      <div class="tabpane bk-pane" role="tabpanel" id={panelId('auto')} aria-labelledby={tabId('auto')} hidden={tab !== 'auto'}>
        {#if server}
          <section aria-labelledby="bk-h-folder">
            <h3 id="bk-h-folder">노트 폴더 백업</h3>
            <p class="hint">노트 폴더의 숨김 폴더 <code>.works-backup/</code> 에 저장합니다. 최근 10개는 모두, 48시간 안은 시간당 1개, 30일 안은 하루 1개만 남깁니다.</p>
            <Switch bind:checked={backup.folderAuto} onchange={persistBackupSettings}>자동 백업 (변경이 있을 때만)</Switch>
            <label class="field"><span>간격(분, 최소 {MIN_AUTO_MINUTES}, 기본 {FOLDER_DEFAULT_MINUTES})</span>
              <input type="number" min={MIN_AUTO_MINUTES} step="5" bind:value={backup.folderIntervalMin} onchange={persistBackupSettings} />
            </label>
            {@render statusLine('마지막 성공', folderStatus)}
            <button class="primary" disabled={!!busy} onclick={folderNow}>지금 백업</button>
            {#if folderList.length}
              <div class="tbl-wrap list tall">
                <table aria-label="폴더 백업 목록">
                  <thead><tr><th>시각</th><th>크기</th><th>형식</th><th></th></tr></thead>
                  <tbody>
                    {#each folderList as f (f.name)}
                      <tr>
                        <td title={f.name}>{fmtTime(f.mtime)}</td>
                        <td>{fmtSize(f.size)}</td>
                        <td>{folderBackupKind(f.name) === 'mwb' ? '암호화 (.mwb)' : 'zip'}</td>
                        <td class="ops">
                          <button class="small" disabled={!!busy} onclick={() => restoreFolder(f)} aria-label={`복원… (${fmtTime(f.mtime)} 백업)`}>복원…</button>
                          <a href={folderBackupUrl(f.name)} download={f.name} aria-label={`받기 (${fmtTime(f.mtime)} 백업)`}>받기</a>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="hint">아직 폴더 백업이 없습니다.</p>
            {/if}
          </section>
        {/if}

        <section aria-labelledby="bk-h-tg">
          <h3 id="bk-h-tg">텔레그램</h3>
          <p class="hint">
            암호화된 번들(.mwb)만 45MB 단위 조각(최대 20개)으로 올립니다{hasKey ? '' : ' — 이 빌드에는 키가 없어 쓸 수 없습니다'}.
            토큰·chat_id 는 이 브라우저에만 저장되고 백업에는 포함되지 않습니다. 받은 파일은 앱 창에 끌어다 놓아 가져옵니다.
          </p>
          <label class="field"><span>봇 토큰</span>
            <input type="password" autocomplete="off" spellcheck="false" bind:value={backup.telegram.token} onchange={persistTelegram} placeholder="123456:ABC…" />
          </label>
          <label class="field"><span>chat_id</span>
            <input type="text" spellcheck="false" bind:value={backup.telegram.chatId} onchange={persistTelegram} placeholder="예: 123456789" />
          </label>
          <div class="actions left">
            <button disabled={!!busy || !backup.telegram.token.trim() || !backup.telegram.chatId.trim()} onclick={tgTest}>연결 테스트</button>
            <button class="primary" disabled={!!busy || !telegramReady()} onclick={tgUpload}>지금 올리기</button>
          </div>
          {#if canResumeTelegram() && backupUi.tgResume}
            <div class="actions left">
              <button disabled={!!busy} onclick={tgResume}>이어 올리기 ({backupUi.tgResume.done}/{backupUi.tgResume.total} 조각까지 올라감)</button>
            </div>
            {#if resumeMissesChange()}<p class="hint">실패 뒤 변경된 내용은 포함되지 않습니다</p>{/if}
          {/if}
          <Switch bind:checked={backup.telegram.auto} onchange={persistTelegram} disabled={!hasKey}>자동 올리기 (변경이 있을 때만)</Switch>
          <label class="field"><span>간격(분, 최소 {MIN_AUTO_MINUTES})</span>
            <input type="number" min={MIN_AUTO_MINUTES} step="5" bind:value={backup.telegram.intervalMin} onchange={persistTelegram} />
          </label>
          {@render statusLine('마지막 성공', tgStatus, telegramStale())}
        </section>

        <section aria-labelledby="bk-h-notify">
          <h3 id="bk-h-notify">백업 알림</h3>
          <label class="field"><span>알림 기준</span>
            <select
              value={String(backup.notifyDays)}
              onchange={(e) => { backup.notifyDays = Number(e.currentTarget.value); persistBackupSettings(); }}
            >
              {#each NOTIFY_DAY_CHOICES as d}<option value={String(d)}>{d ? `${d}일 넘으면` : '끔'}</option>{/each}
            </select>
          </label>
          <p class="hint">마지막 백업이 기준을 넘고 이후 변경이 있으면 상단바 백업 단추에 점을 표시합니다. 텔레그램 자동 올리기가 오래 실패하는 경우도 같습니다.</p>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .backup-btn { position: relative; }
  .dot-badge { position: absolute; top: 3px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  /* 탭을 바꿔도 창 높이가 출렁이지 않게 높이를 고정하고, 내용만 안에서 스크롤한다 */
  .dialog.backup { display: flex; flex-direction: column; height: min(680px, calc(100dvh - 32px)); overflow: hidden; }
  .dialog.backup .dlg-head { flex: none; }
  .summary { flex: none; margin-bottom: 10px !important; }
  .bk-tabs { flex: none; padding: 0; }
  .bk-tabs button { position: relative; }
  .tab-dot { display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--danger); vertical-align: middle; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  /* 전역 .tabpane 은 flex 열이다 — 이 창에서는 위에서 아래로 쌓는 스크롤 영역으로 쓴다(hidden 이면 전역 규칙이 숨긴다) */
  .bk-pane { display: block; flex: 1; min-height: 0; overflow-y: auto; padding-top: 4px; }
  .notices { flex: none; }
  .notices > div:empty { display: none; }
  .notices > div { margin-top: 8px; }
  .note { display: flex; align-items: flex-start; gap: 8px; justify-content: space-between; padding: 8px 10px; border-radius: 8px; font-size: 13px; overflow-wrap: anywhere; }
  .note.ok { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .note.err { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
  .note .icon-btn { flex: none; padding: 2px; margin: -2px -4px 0 0; }
  .busy { font-size: 13px; color: var(--muted); padding: 8px 10px; }
  section { padding: 12px 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  section:first-child { border-top: 0; }
  h3 { margin: 0; font-size: 14px; }
  p { margin: 0 !important; }
  .line { font-size: 13px; }
  .hint { font-size: 12px; color: var(--muted); }
  .ok { color: var(--accent); }
  .warn { color: var(--danger); }
  .field { display: flex; flex-direction: row; gap: 8px; align-items: center; font-size: 13px; width: 100%; }
  .field span { flex: none; min-width: 7em; color: var(--muted); }
  .field input, .field select { flex: 1; min-width: 0; margin: 0; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); width: auto; }
  .pwstep { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .show-pw { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
  .actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; width: 100%; }
  .actions.left { justify-content: flex-start; }
  .tbl-wrap { width: 100%; overflow-x: auto; }
  .tbl-wrap.list { max-height: 180px; overflow-y: auto; }
  .tbl-wrap.list.tall { max-height: 240px; }
  table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
  th, td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; white-space: nowrap; }
  thead th { position: sticky; top: 0; background: var(--bg); }
  td.warn { font-weight: 600; }
  td.ops { display: flex; gap: 10px; align-items: center; border: 0; border-bottom: 1px solid var(--border); }
  button.small { padding: 2px 8px; font-size: 12px; }
  code { font-family: var(--font-code); }
</style>
