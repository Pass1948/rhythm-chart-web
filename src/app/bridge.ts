/**
 * 편집기 ↔ 플레이 화면 연결 자리(계약 6번).
 * 02단계에서는 플레이 화면이 아직 없으므로 startPlayTest 는 "03단계에서 연결됩니다" 안내만 보여 주는 스텁이다.
 * 03단계가 registerPlayHandler 를 한 번 부르면 같은 함수가 실제 플레이 화면을 연다.
 */
import type { UnityChart } from '../core/chartIo.ts';

/** 플레이 시작 요청 */
export interface PlayRequest {
  /** 게임 로더 형식으로 변환한 채보 데이터 */
  unityChart: UnityChart;
  difficulty: string;
  /** blob: 주소 */
  audioUrl: string;
  durationMs: number;
  /** 중간부터 시작 */
  startMs?: number;
  /** 재생 속도 0.5~1.25 */
  rate?: number;
  /** true(기본)=실패 없음 */
  practice?: boolean;
}

/** 플레이 결과 */
export interface PlayResult {
  score: number;
  counts: Record<string, number>;
  maxCombo: number;
  meanErrorMs: number;
  missList: { noteId: number; timeMs: number; type: string }[];
}

type PlayHandler = (req: PlayRequest, host: HTMLElement) => Promise<PlayResult | null>;

let handler: PlayHandler | null = null;
let gotoNoteCb: ((noteId: number) => void) | null = null;

/** 03단계가 플레이 화면을 등록한다 */
export function registerPlayHandler(h: PlayHandler): void {
  handler = h;
}

/** 편집기가 "결과 화면의 MISS 클릭 → 그 노트로 이동"을 받을 함수를 등록한다 */
export function onGotoNote(cb: (noteId: number) => void): void {
  gotoNoteCb = cb;
}

/** 플레이 화면 쪽에서 부른다: 편집기를 그 노트로 이동시킨다 (등록된 함수가 없으면 아무 일도 없다) */
export function gotoNote(noteId: number): void {
  gotoNoteCb?.(noteId);
}

/** 플레이 화면이 아직 연결되지 않았을 때 보여 주는 안내 창 */
function showStub(): Promise<null> {
  return new Promise((done) => {
    const dlg = document.createElement('dialog');
    dlg.id = 'playStub';
    dlg.innerHTML = '<form method="dialog"><h3>게임 화면 테스트</h3><p class="help">플레이 화면은 03단계에서 연결됩니다. 지금은 편집기의 [테스트] 버튼으로 판정을 확인할 수 있습니다.</p><div class="dlgfoot"><button value="ok" class="primary">확인</button></div></form>';
    dlg.addEventListener('close', () => {
      dlg.remove();
      done(null);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** 플레이 테스트를 시작한다. 취소하면 null. 플레이 화면이 연결되지 않았으면 안내만 보이고 null. */
export function startPlayTest(req: PlayRequest): Promise<PlayResult | null> {
  if (!handler) return showStub();
  return handler(req, document.body);
}

// 03단계: 게임 화면 연결 (Three.js 가 들어 있는 플레이 화면은 처음 누를 때 불러온다)
registerPlayHandler((req, host) => import("../play/index.ts").then((m) => m.runPlay(req, host)));
