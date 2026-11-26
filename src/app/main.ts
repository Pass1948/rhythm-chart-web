/**
 * 앱 시작점(02단계): 편집기 화면을 서버 없이 브라우저 안에서 띄운다.
 * - 편집기 화면 조각(src\editor\index.html 의 body)을 #app 대신 문서에 넣고 편집기 JS(js\main.js)를 불러온다.
 * - 같은 주소 뒤에 #rcw-test 가 붙으면 [테스트] 팝업 화면(원본 판정 테스트)을 띄운다.
 * - 저장소 상태 안내(시크릿 모드·남은 용량), [게임 화면 테스트] 버튼(03단계 연결 자리)을 연결한다.
 */
import '../editor/tokens.css';
import '../editor/style.css';
import '../ui/layout/layout.css'; // 04단계: 태블릿·모바일 배치(반드시 style.css 다음)
import editorHtml from '../editor/index.html?raw';
import testPopupHtml from '../editor/test_popup.html?raw';
import { exportUnity } from '../core/index.ts';
import { storageWarning } from '../storage/songStore.ts';
import { onGotoNote, startPlayTest } from './bridge.ts';
import { readEditorHints } from '../chartPlay/editorHints.ts';
import { initEditorLayout } from '../ui/layout/index.ts';

/** 편집기 점검용 객체(editor/js/main.js 가 window.__editor 로 내놓는다) */
interface EditorHandle {
  A: { audio: { durationMs: number } };
  S: { chart: { difficulties: { name: string }[] } | null; song: string | null; diffIndex: number; dirty: boolean };
}
type AppWindow = Window & { __editor?: () => EditorHandle };

/** HTML 문서 문자열에서 <body> 안쪽만 꺼낸다 */
function bodyOf(html: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1]! : html;
}

/** 화면 모드(화이트/다크)를 첫 그림 전에 적용한다. 값은 settingsStore 가 쓰는 localStorage 에 있다(깜빡임 방지). index.html 의 머리 글자(스크립트)가 먼저 같은 일을 하고, 이 함수는 그것을 되풀이하는 안전장치다. */
function applyThemeEarly(): void {
  let mode = 'light'; // 기본은 화이트(04b: 원본 동작). 저장된 값이 있으면 그 값을 쓴다
  try {
    const raw = localStorage.getItem('rcw.settings.v1');
    const theme = raw ? (JSON.parse(raw) as { theme?: string }).theme : undefined;
    if (theme === 'dark' || theme === 'system' || theme === 'light') mode = theme;
  } catch {
    /* 저장소를 못 읽으면 화이트 */
  }
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** 저장소 안내 줄: IndexedDB 를 못 쓰면 "저장되지 않습니다", 남은 용량이 적으면 용량 안내 */
async function showStorageNote(): Promise<void> {
  const note = document.getElementById('storageNote');
  if (!note) return;
  // @ts-ignore 편집기 JS(타입 검사 제외)
  const { api } = await import('./localApi.js');
  const info = (await api.storageInfo()) as { persistent: boolean };
  if (!info.persistent) {
    note.textContent = '이 모드에서는 저장되지 않습니다. 작업 후 [내보내기]로 파일을 저장하세요. (시크릿 모드이거나 브라우저가 저장 기능을 막고 있습니다)';
    note.hidden = false;
    return;
  }
  const warn = await storageWarning();
  if (warn) {
    note.textContent = warn;
    note.hidden = false;
  }
}

/** [게임 화면 테스트] 버튼: 지금 채보를 플레이 화면(03단계)으로 넘긴다. 아직 연결 전이면 안내만 보인다. */
function bindPlayTestButton(): void {
  const btn = document.getElementById('btnPlayTest');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const ed = (window as AppWindow).__editor?.();
    const status = document.getElementById('statusLine');
    const say = (text: string): void => {
      if (status) status.textContent = text;
    };
    if (!ed || !ed.S.chart || !ed.S.song) {
      say('먼저 곡을 열어 주세요.');
      return;
    }
    const name = ed.S.chart.difficulties[ed.S.diffIndex]?.name ?? 'NORMAL';
    try {
      // @ts-ignore 편집기 JS(타입 검사 제외)
      const { api } = await import('./localApi.js');
      const unityChart = exportUnity(ed.S.chart as never, name);
      // 곡 BPM·노트 번호·첫 박 위치를 편집기가 직접 넘긴다(플레이 쪽이 편집기 상태를 따로 읽지 않아도 되게)
      const hints = readEditorHints(name);
      await startPlayTest({
        unityChart,
        difficulty: name,
        audioUrl: api.audioUrl(ed.S.song) as string,
        durationMs: ed.A.audio.durationMs,
        ...(hints.bpm !== null ? { bpm: hints.bpm } : {}),
        ...(hints.noteIds !== null ? { noteIds: hints.noteIds } : {}),
        beatOriginMs: hints.beatOriginMs,
      } as Parameters<typeof startPlayTest>[0]);
    } catch (e) {
      say(e instanceof Error ? e.message : '게임 화면 테스트를 시작하지 못했습니다.');
    }
  });
}

/** 결과 화면의 MISS 를 누르면 편집기가 그 노트로 이동해 선택한다 */
function bindGotoNote(): void {
  onGotoNote((noteId) => {
    // @ts-ignore 편집기 JS(타입 검사 제외)
    void import('../editor/js/actions.js').then((m: { focusNote: (id: number) => void }) => m.focusNote(noteId));
  });
}

/** 편집기 화면을 띄운다 */
async function bootEditor(): Promise<void> {
  document.title = '리듬 채보 만들기';
  document.body.innerHTML = bodyOf(editorHtml);
  // @ts-ignore 편집기 JS(타입 검사 제외). 가져오는 순간 편집기가 시작된다.
  await import('../editor/js/main.js');
  bindPlayTestButton();
  bindGotoNote();
  void showStorageNote();
  void initEditorLayout(); // 04단계: 반응형 배치·터치 편집
}

/** [테스트] 팝업 화면을 띄운다(원본 판정 테스트) */
async function bootTestPopup(): Promise<void> {
  document.title = '채보 테스트';
  document.body.innerHTML = bodyOf(testPopupHtml);
  // @ts-ignore 편집기 JS(타입 검사 제외). 가져오는 순간 테스트 화면이 시작된다.
  await import('../editor/js/test_popup.js');
}

/** 주소창 아이콘 요청(favicon.ico 404)이 생기지 않게 빈 아이콘을 지정한다 */
function setBlankIcon(): void {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = 'data:,';
  document.head.appendChild(link);
}

setBlankIcon();
applyThemeEarly();
if (window.location.hash === '#rcw-test') {
  void bootTestPopup();
} else {
  void bootEditor();
}
