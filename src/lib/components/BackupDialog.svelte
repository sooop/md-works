<script lang="ts">
  import { tip } from '../tooltip.svelte';
  // 상단바 '백업' 버튼 + 모달: 상태 요약, 내보내기, 가져오기(미리보기·병합), 텔레그램, (서버 모드) 노트 폴더 백업.
  import { onMount } from 'svelte';
  import DatabaseBackup from '@lucide/svelte/icons/database-backup';
  import { toast, errMsg } from '../store.svelte';
  import { previewBundle, applyBundle, type MergePreview, type MergeResult, type DocAction } from '../bundle/api';
  import BundleDeletions from './BundleDeletions.svelte';
  import { BundleCryptoError } from '../bundle/crypto';
  import { NOTIFY_DAY_CHOICES } from '../bundle/backupLogic';
  import { MIN_AUTO_MINUTES, getMe, sendMessage } from '../bundle/telegram';
  import {
    backup, backupUi, ago, lastBackupAt, hasUnbacked, isStale, keyAvailable, exportToFile, readBundleFiles,
    persistTelegram, persistBackupSettings, telegramReady, uploadToTelegram, startBackupScheduler,
    listFolderBackups, backupToFolder, folderBackupUrl, FOLDER_DEFAULT_MINUTES, type FolderBackup,
  } from '../bundle/backupState.svelte';

  let { server = false, trigger = true }: { server?: boolean; trigger?: boolean } = $props();

  const hasKey = keyAvailable();
  let exportKind = $state<'enc' | 'zip'>(hasKey ? 'enc' : 'zip');
  let busy = $state('');
  let error = $state('');

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

  function resetImport() {
    importName = ''; bytes = null; preview = null; result = null; applyDesignToo = false; applyDeletions = false;
  }

  function explain(e: unknown): string {
    if (e instanceof BundleCryptoError) {
      if (e.code === 'no-key') return '이 빌드에는 복호화 키가 없어 .mwb 를 열 수 없습니다 (VITE_BUNDLE_KEY).';
      if (e.code === 'auth-failed') return '복호화에 실패했습니다. 다른 키로 만든 파일이거나 파일이 변조·손상되었습니다.';
      if (e.code === 'truncated') return '파일이 잘려 있습니다. 다시 받아 보세요.';
    }
    return errMsg(e);
  }

  async function loadFiles(files: File[]) {
    resetImport();
    error = '';
    busy = '번들을 읽는 중…';
    const label = files.length > 1 ? `조각 ${files.length}개` : (files[0]?.name ?? '');
    try {
      const b = await readBundleFiles(files);
      const p = await previewBundle(b);
      importName = label;
      bytes = b;
      preview = p;
    } catch (e) {
      error = `'${label}': ${explain(e)}`;
    } finally {
      busy = '';
    }
  }

  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.mwb,.zip,.001,.002,.003,.004,.005,application/zip,application/octet-stream';
    input.onchange = () => { const fs = [...(input.files ?? [])]; if (fs.length) void loadFiles(fs); };
    input.click();
  }

  async function apply() {
    if (!bytes) return;
    error = '';
    busy = '병합하는 중…';
    try {
      result = await applyBundle(bytes, { applyDesign: applyDesignToo, applyDeletions });
      preview = null;
      bytes = null;
    } catch (e) {
      error = `병합 실패: ${explain(e)}`;
    } finally {
      busy = '';
    }
  }

  // 앱 전체 드롭(.mwb / 번들 zip)이 들어오면 열려 있는 이 대화상자에서 이어 받는다
  $effect(() => {
    if (backupUi.open && backupUi.pending) {
      const f = backupUi.pending;
      backupUi.pending = null;
      void loadFiles(f);
    }
  });

  // ---- 내보내기 ----
  async function doExport() {
    error = '';
    busy = '번들을 만드는 중…';
    try {
      await exportToFile(exportKind === 'enc');
      toast('백업 파일을 내려받았습니다');
    } catch (e) {
      error = `내보내기 실패: ${errMsg(e)}`;
    } finally {
      busy = '';
    }
  }

  // ---- 텔레그램 ----
  let tgInfo = $state('');
  async function tgTest() {
    error = ''; tgInfo = '';
    busy = '연결 확인 중…';
    try {
      const t = $state.snapshot(backup.telegram);
      const me = await getMe(t);
      await sendMessage(t, `md-works 연결 테스트 (${new Date().toLocaleString('ko-KR')})`);
      tgInfo = `연결 성공: @${me.username ?? me.first_name ?? '봇'} → chat ${t.chatId}`;
    } catch (e) {
      error = `텔레그램: ${errMsg(e)}`;
    } finally {
      busy = '';
    }
  }
  async function tgUpload() {
    error = ''; tgInfo = '';
    busy = '텔레그램에 올리는 중…';
    try {
      const name = await uploadToTelegram();
      tgInfo = `올렸습니다: ${name}`;
    } catch (e) {
      error = `텔레그램: ${errMsg(e)}`;
    } finally {
      busy = '';
    }
  }

  // ---- 서버 노트 폴더 백업 ----
  let folderList = $state<FolderBackup[]>([]);
  async function refreshFolder() {
    if (!server) return;
    try { folderList = await listFolderBackups(); } catch (e) { error = `폴더 백업 목록: ${errMsg(e)}`; }
  }
  async function folderNow() {
    error = '';
    busy = '노트 폴더에 백업하는 중…';
    try {
      const name = await backupToFolder();
      toast(`노트 폴더에 백업했습니다: ${name}`);
      await refreshFolder();
    } catch (e) {
      error = `폴더 백업 실패: ${errMsg(e)}`;
    } finally {
      busy = '';
    }
  }

  $effect(() => { if (backupUi.open) void refreshFolder(); });

  onMount(() => { startBackupScheduler(); });

  const fmtTime = (ts: number) => (ts ? new Date(ts).toLocaleString('ko-KR') : '없음');
  const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  const close = () => { backupUi.open = false; };
  const dotOn = $derived(isStale());
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && backupUi.open && !busy) close(); }} />

{#if trigger}
<button
  class="icon-btn backup-btn"
  aria-label="백업"
  use:tip={dotOn ? '백업한 지 오래됐습니다 — 백업' : '백업 · 가져오기'}
  onclick={() => (backupUi.open = true)}
>
  <DatabaseBackup size={18} />{#if dotOn}<span class="dot-badge" aria-label="백업 필요"></span>{/if}
</button>
{/if}

{#if backupUi.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="overlay" onclick={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
    <div class="dialog wide backup" role="dialog" aria-modal="true" aria-label="백업">
      <h2>백업</h2>

      <section aria-label="현재 상태">
        <h3>지금 상태</h3>
        <p class="line">
          마지막 백업: <b>{lastBackupAt() ? `${fmtTime(lastBackupAt())} (${ago(lastBackupAt())})` : '없음'}</b>
          {#if hasUnbacked()}<span class="warn"> · 마지막 백업 이후 변경이 있습니다</span>{:else if lastBackupAt()}<span class="ok"> · 최신 상태입니다</span>{/if}
        </p>
        <label class="row">
          <span>백업 알림</span>
          <select
            aria-label="백업 알림 기준일"
            value={String(backup.notifyDays)}
            onchange={(e) => { backup.notifyDays = Number(e.currentTarget.value); persistBackupSettings(); }}
          >
            {#each NOTIFY_DAY_CHOICES as d}<option value={String(d)}>{d ? `${d}일 넘으면` : '끔'}</option>{/each}
          </select>
        </label>
      </section>

      <section aria-label="내보내기">
        <h3>내보내기</h3>
        <div class="seg" role="radiogroup" aria-label="내보내기 형식">
          <button role="radio" aria-checked={exportKind === 'enc'} class:active={exportKind === 'enc'} disabled={!hasKey} onclick={() => (exportKind = 'enc')} aria-label="암호화 .mwb">암호화 (.mwb)</button>
          <button role="radio" aria-checked={exportKind === 'zip'} class:active={exportKind === 'zip'} onclick={() => (exportKind = 'zip')} aria-label="평문 zip">평문 zip</button>
        </div>
        {#if !hasKey}<p class="hint">이 빌드에는 암호화 키(VITE_BUNDLE_KEY)가 없어 암호화·텔레그램 올리기를 쓸 수 없습니다. 평문 zip 만 내보낼 수 있습니다.</p>{/if}
        {#if exportKind === 'zip'}<p class="hint">평문 zip 은 누구나 열 수 있습니다. 보관·전달에 주의하세요.</p>{/if}
        <button class="primary" disabled={!!busy} onclick={doExport} aria-label="내려받기">내려받기</button>
      </section>

      <section aria-label="가져오기">
        <h3>가져오기</h3>
        <p class="hint">.mwb / 번들 zip 을 선택하거나, 앱 창에 끌어다 놓으세요. 텔레그램에서 받은 파일을 그대로 쓰면 됩니다. 큰 백업은 <code>.mwb.001</code>, <code>.002</code> … 조각으로 나뉘어 있으니 조각 파일을 모두 한꺼번에 끌어다 놓으세요(여러 개 선택도 됩니다). 병합 전에 미리보기를 보여 줍니다.</p>
        <button disabled={!!busy} onclick={pickFile} aria-label="가져올 파일 선택">파일 선택…</button>

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
            <label class="check"><input type="checkbox" bind:checked={applyDesignToo} aria-label="디자인도 적용" /><span>디자인도 적용 (번들의 디자인 설정이 현재와 다릅니다)</span></label>
          {/if}
          <div class="actions">
            <button onclick={resetImport} disabled={!!busy} aria-label="가져오기 취소">취소</button>
            <button class="primary" onclick={apply} disabled={!!busy || !applicable} aria-label="병합 적용">병합 적용</button>
          </div>
          {#if !applicable}<p class="hint">바뀔 내용이 없습니다.</p>{/if}
        {/if}

        {#if result}
          <div class="tbl-wrap" role="status">
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
          <button onclick={() => location.reload()} aria-label="새로 고침">새로 고침해서 반영 확인</button>
        {/if}
      </section>

      <section aria-label="텔레그램">
        <h3>텔레그램으로 올리기</h3>
        <p class="hint">암호화된 번들(.mwb)만 올립니다{hasKey ? '' : ' — 이 빌드에는 키가 없어 쓸 수 없습니다'}. 토큰·chat_id 는 이 브라우저(localStorage)에만 저장되고 백업에는 포함되지 않습니다. 가져오기는 텔레그램에서 받은 파일을 앱에 끌어다 놓으세요.</p>
        <p class="hint">큰 번들은 45MB 단위로 나눠 올립니다 (최대 20개). 예: 100MB 면 3개 조각(<code>.mwb.001</code>~<code>.003</code>)으로 올라갑니다.</p>
        <label class="row"><span>봇 토큰</span>
          <input type="password" autocomplete="off" spellcheck="false" aria-label="봇 토큰" bind:value={backup.telegram.token} onchange={persistTelegram} placeholder="123456:ABC…" />
        </label>
        <label class="row"><span>chat_id</span>
          <input type="text" spellcheck="false" aria-label="chat_id" bind:value={backup.telegram.chatId} onchange={persistTelegram} placeholder="예: 123456789" />
        </label>
        <div class="actions left">
          <button disabled={!!busy || !backup.telegram.token.trim() || !backup.telegram.chatId.trim()} onclick={tgTest} aria-label="연결 테스트">연결 테스트</button>
          <button class="primary" disabled={!!busy || !telegramReady()} onclick={tgUpload} aria-label="지금 올리기">지금 올리기</button>
        </div>
        <label class="check">
          <input type="checkbox" aria-label="자동 올리기" bind:checked={backup.telegram.auto} onchange={persistTelegram} disabled={!hasKey} />
          <span>자동 올리기 (마지막 변경이 있을 때만)</span>
        </label>
        <label class="row"><span>간격(분, 최소 {MIN_AUTO_MINUTES})</span>
          <input type="number" min={MIN_AUTO_MINUTES} step="5" aria-label="자동 올리기 간격(분)" bind:value={backup.telegram.intervalMin} onchange={persistTelegram} />
        </label>
        <p class="line">마지막 올리기 성공: <b>{fmtTime(backup.lastTelegram)}</b></p>
        {#if tgInfo}<p class="ok" role="status">{tgInfo}</p>{/if}
      </section>

      {#if server}
        <section aria-label="노트 폴더 백업">
          <h3>노트 폴더 백업</h3>
          <p class="hint">노트 폴더의 숨김 폴더 <code>.works-backup/</code> 에 번들을 저장하고 최근 10개만 남깁니다.</p>
          <label class="check">
            <input type="checkbox" aria-label="폴더 자동 백업" bind:checked={backup.folderAuto} onchange={persistBackupSettings} />
            <span>자동 백업 (변경이 있을 때만)</span>
          </label>
          <label class="row"><span>간격(분, 최소 {MIN_AUTO_MINUTES}, 기본 {FOLDER_DEFAULT_MINUTES})</span>
            <input type="number" min={MIN_AUTO_MINUTES} step="5" aria-label="폴더 백업 간격(분)" bind:value={backup.folderIntervalMin} onchange={persistBackupSettings} />
          </label>
          <p class="line">마지막 폴더 백업: <b>{fmtTime(backup.lastFolder)}</b></p>
          <button class="primary" disabled={!!busy} onclick={folderNow} aria-label="지금 폴더 백업">지금 백업</button>
          {#if folderList.length}
            <div class="tbl-wrap list">
              <table aria-label="최근 백업 목록">
                <thead><tr><th>파일</th><th>크기</th><th>시각</th></tr></thead>
                <tbody>
                  {#each folderList as f (f.name)}
                    <tr><td><a href={folderBackupUrl(f.name)} download={f.name}>{f.name}</a></td><td>{fmtSize(f.size)}</td><td>{fmtTime(f.mtime)}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="hint">아직 폴더 백업이 없습니다.</p>
          {/if}
        </section>
      {/if}

      {#if busy}<p class="busy" role="status">{busy}{#if backupUi.tgProgress} (조각 {backupUi.tgProgress}){/if}</p>{/if}
      {#if error}<p class="err" role="alert">{error}</p>{/if}

      <div class="actions"><button onclick={close} disabled={!!busy} aria-label="닫기">닫기</button></div>
    </div>
  </div>
{/if}

<style>
  .backup-btn { position: relative; }
  .dot-badge { position: absolute; top: 3px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
  .dialog.backup { max-height: calc(100dvh - 32px); overflow: auto; }
  section { padding: 10px 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  h3 { margin: 0; font-size: 14px; }
  p { margin: 0 !important; }
  .line { font-size: 13px; }
  .hint { font-size: 12px; color: var(--muted); }
  .ok { color: var(--accent); font-size: 13px; }
  .warn { color: var(--danger); }
  .err { color: var(--danger); font-size: 13px; }
  .busy { font-size: 13px; color: var(--muted); }
  .row { display: flex; gap: 8px; align-items: center; font-size: 13px; width: 100%; }
  .row span { flex: none; min-width: 7em; color: var(--muted); }
  .row input, .row select { flex: 1; min-width: 0; margin: 0; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); width: auto; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; width: 100%; }
  .actions.left { justify-content: flex-start; }
  .check input { width: auto; margin: 0; }
  .tbl-wrap { width: 100%; overflow-x: auto; }
  .tbl-wrap.list { max-height: 180px; overflow-y: auto; }
  table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
  th, td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; white-space: nowrap; }
  td.warn { font-weight: 600; }
  code { font-family: var(--font-code); }
</style>
