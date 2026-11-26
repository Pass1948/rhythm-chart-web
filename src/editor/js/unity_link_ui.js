// 내보내기 창의 "유니티 묶음 (4키)" 영역: 유니티 폴더 연결·[유니티로 보내기]·[ZIP으로 저장]
import { api } from '../../app/localApi.js';
import { S, emit, status } from './state.js';
import { exportChart } from './actions.js';
import { UnityLinkError, isLinkSupported, readLinkMarker, sendBundleToDir } from '../../storage/unityLink.ts';
import { clearLink, loadLink, saveLink } from '../../storage/unityLinkStore.ts';

const $ = (id) => document.getElementById(id);
/** 연결된 폴더 {handle, projectName} (없으면 null) */
let link = null;
let busy = false;

// 영역 안 안내 글(오류·결과)
function say(text, bad) {
  $('unityLinkMsg').textContent = text || '';
  $('unityLinkMsg').dataset.bad = bad ? '1' : '';
}

// 연결 상태·버튼 활성 상태를 현재 채보·브라우저·연결에 맞춰 다시 그린다
export function refreshUnityLinkUi() {
  if (!$('unityLinkBox')) return;
  const four = !!S.chart && S.chart.keyMode === 4;
  const ok = isLinkSupported();
  $('unityLinkState').textContent = link ? `연결됨: ${link.projectName}` : '연결 안 됨';
  $('btnUnityLink').textContent = link ? '다른 폴더로 바꾸기' : '유니티 폴더 연결';
  $('btnUnityLink').disabled = !ok || busy;
  $('btnUnityUnlink').hidden = !link;
  $('btnUnityUnlink').disabled = busy;
  $('btnUnitySend').disabled = !ok || !four || !link || busy;
  let why = '';
  if (!ok) why = '이 브라우저는 폴더 연결을 지원하지 않습니다. 크롬 또는 엣지(데스크톱)에서 열어 주세요. ZIP 저장은 그대로 쓸 수 있습니다.';
  else if (!four) why = '4키 채보만 보낼 수 있습니다';
  else if (!link) why = '먼저 유니티 폴더를 연결해 주세요';
  $('unitySendWhy').textContent = why;
}

// 연결을 끊고 저장된 연결도 지운다
async function unlink() {
  link = null;
  await clearLink();
  refreshUnityLinkUi();
}

// [유니티 폴더 연결]: 폴더 선택창 → 표시 파일 검증 → 저장
async function connect() {
  say('');
  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 선택 취소는 조용히 넘긴다
    return say('폴더 선택창을 열 수 없습니다.', true);
  }
  try {
    const { projectName } = await readLinkMarker(dir);
    link = { handle: dir, projectName };
    const saved = await saveLink(dir, projectName);
    say(saved ? '' : '연결은 이번에 연 화면 동안만 유지됩니다(이 브라우저는 연결을 저장하지 못했습니다).');
  } catch (e) {
    say(e instanceof UnityLinkError ? e.message : '폴더를 확인하지 못했습니다.', true);
  }
  refreshUnityLinkUi();
}

// [유니티로 보내기]: 권한 확인 → 묶음 만들기 → 폴더에 쓰기
async function send() {
  if (busy || !link) return;
  say('');
  busy = true;
  refreshUnityLinkUi();
  try {
    const h = link.handle;
    if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      if (!h.requestPermission || (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return say('폴더 쓰기 권한이 필요합니다.', true);
    }
    let bundle;
    try {
      bundle = await api.prepareUnityBundle({ song: S.song, chart: S.chart });
    } catch (e) {
      if (e.status === 422 && e.data) {
        S.issues = e.data.issues || [];
        emit('health');
      }
      return say(e.message, true);
    }
    try {
      await sendBundleToDir(h, bundle, (n, total) => say(`${n}/${total} 쓰는 중…`));
    } catch (e) {
      if (!(e instanceof UnityLinkError)) throw e;
      if (e.code === 'marker') {
        await unlink();
        return say(`${e.message} 연결을 해제했습니다.`, true);
      }
      say(e.message, true);
      status(e.message, 'error');
      $('dlgExport').close();
      return exportChart('unity', 'unity', false); // 같은 묶음을 ZIP 으로 저장하는 흐름으로 바로 이어진다
    }
    const msg = `유니티 ChartInbox에 보냈습니다: ${bundle.folder}. 유니티의 Chart Sync 창에서 [동기화]를 눌러 주세요.`;
    say(msg);
    status(msg, 'ok');
  } catch (e) {
    say(e && e.message ? e.message : '보내지 못했습니다.', true);
  } finally {
    busy = false;
    refreshUnityLinkUi();
  }
}

// 버튼 연결 + 저장된 연결 복원(실제 권한 확인은 보내기를 누를 때 한다)
export async function initUnityLinkUi() {
  if (!$('unityLinkBox')) return;
  $('btnUnityLink').addEventListener('click', connect);
  $('btnUnityUnlink').addEventListener('click', unlink);
  $('btnUnitySend').addEventListener('click', send);
  $('btnUnityZip').addEventListener('click', () => {
    $('dlgExport').close();
    exportChart('unity', 'unity', false);
  });
  refreshUnityLinkUi();
  try {
    link = await loadLink();
  } catch {
    link = null;
  }
  refreshUnityLinkUi();
}
