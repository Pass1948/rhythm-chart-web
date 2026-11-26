// 플레이 화면의 입구: 편집기의 [게임 화면으로 테스트]가 부르는 핸들러(registerPlayHandler 에 등록되는 함수).
// host 안에 플레이 화면을 만들고, 끝나면 소리·WebGL·이벤트·요소를 모두 정리한다(destroy).
import './playOriginal.css';
import './play.css';
import { gotoNote, type PlayRequest, type PlayResult } from '../app/bridge.ts';
import { readEditorHints } from '../chartPlay/editorHints.ts';
import { PlayChartError, toPlayChart } from '../chartPlay/toPlayChart.ts';
import { loadSettingsWithNotes, saveSettings } from '../storage/settingsStore.ts';
import { attachPlayLayout } from '../ui/layout/playLayout';
import { el } from './dom';
import { clampRate } from './playClock';
import { V10C_VIEW } from '../play10c/config10c';
import { coverWidths } from '../play10c/geometry10c';
import { PlayController } from './playController';
import { playVolume } from './playOptionsStore';
import { gameConfigFromSettings } from './playSettings';
import { toPlayResult, type RunSummary } from './playResult';

/** PlayRequest 에 호환되는 선택 추가 값(편집기가 알면 넘겨 주고, 없으면 편집기 상태에서 읽는다) */
export interface PlayRequestExt extends PlayRequest {
  /** 곡 BPM (롱노트 틱 간격 계산용) */
  bpm?: number;
  /** unityChart 노트와 같은 순서의 편집기 노트 번호 (MISS → 편집기 이동용) */
  noteIds?: number[];
  /** 첫 박이 나오는 곡 시간(ms) (박자 배경 빛용) */
  beatOriginMs?: number;
}

/** 지금 열려 있는 플레이 화면 수(중복 방지). 항상 0 또는 1 */
let openCount = 0;

/** 점검용 카운터: 시작·정리 횟수 (window.__rcwPlayStats) */
interface PlayStats {
  started: number;
  destroyed: number;
}
const stats: PlayStats = { started: 0, destroyed: 0 };
(window as unknown as { __rcwPlayStats?: PlayStats }).__rcwPlayStats = stats;

// 결과 화면의 MISS → 편집기 이동은 main.ts 가 onGotoNote 로 등록한 함수가 처리한다(05단계에서 이쪽 대체 코드를 걷어냈다).

/** 음원(blob 주소)을 읽어 디코딩한다. 실패하면 쉬운 한국어 오류 */
async function loadAudio(context: AudioContext, url: string): Promise<AudioBuffer> {
  let data: ArrayBuffer;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`응답 ${response.status}`);
    data = await response.arrayBuffer();
  } catch {
    throw new PlayChartError('곡 소리를 불러오지 못했어요. 편집기에서 곡을 다시 열어 주세요.');
  }
  try {
    return await context.decodeAudioData(data);
  } catch {
    throw new PlayChartError('곡 소리를 읽을 수 없어요. 파일이 깨졌거나 이 브라우저가 지원하지 않는 형식일 수 있어요.');
  }
}

/** 편집기의 채보를 게임 화면에서 쳐 본다. 끝나면(또는 닫으면) 결과를 돌려주고, 결과 없이 닫으면 null */
export function runPlay(req: PlayRequest, host: HTMLElement): Promise<PlayResult | null> {
  if (openCount > 0) return Promise.resolve(null); // 이미 열려 있음: 두 번 열지 않는다
  openCount += 1;
  stats.started += 1;

  return new Promise<PlayResult | null>((resolve) => {
    const root = el('div', { class: 'rcw-play', attrs: { role: 'dialog', 'aria-label': '게임 화면 테스트' } });
    const stage = el('div', { class: 'rcw-stage' });
    root.append(stage);
    host.append(root);

    let controller: PlayController | null = null;
    let context: AudioContext | null = null;
    let closed = false;
    // 04단계: 무대 배치(창 크기·안전 영역·PC 양옆 패널·태블릿 아래 HUD)는 ui/layout/playLayout.ts 가 맡는다. 창 크기·회전 때 스스로 다시 맞춘다.
    const layout = attachPlayLayout(root, stage);
    // [11] 새 화면 10-C: PC 에서 세로 무대 양옆을 불투명하게 덮는다 (창 크기·회전 때 다시 맞춘다)
    const coverL = el('div', { class: 'pl-side-cover' });
    const coverR = el('div', { class: 'pl-side-cover' });
    root.prepend(coverL, coverR);
    const fitCovers = (): void => {
      const fit = layout.last().fit;
      const widths = coverWidths(window.innerWidth, fit.left, V10C_VIEW.width * fit.scale);
      coverL.style.cssText = `left:0;width:${widths.left}px`;
      coverR.style.cssText = `right:0;width:${widths.right}px`;
    };
    fitCovers();
    window.addEventListener('resize', fitCovers);
    window.addEventListener('orientationchange', fitCovers);

    /** 정리하고 결과를 돌려준다 (WebGL·오디오·이벤트·요소 모두 해제) */
    const close = (summary: RunSummary | null, gotoNoteId: number | null): void => {
      if (closed) return;
      closed = true;
      window.removeEventListener('resize', fitCovers);
      window.removeEventListener('orientationchange', fitCovers);
      layout.dispose();
      controller?.dispose();
      controller = null;
      if (context !== null) void context.close().catch(() => undefined);
      context = null;
      root.remove();
      openCount -= 1;
      stats.destroyed += 1;
      resolve(summary === null ? null : toPlayResult(summary));
      if (gotoNoteId !== null && gotoNoteId >= 0) gotoNote(gotoNoteId);
    };

    /** 시작 전에 문제가 생겼을 때: 쉬운 안내와 [돌아가기] */
    const fail = (message: string): void => {
      const dialog = el(
        'div',
        { class: 'pl-dialog pink' },
        el('h2', { class: 'pl-dialog-title', text: '플레이를 시작할 수 없어요' }),
        el('p', { class: 'pl-dialog-text', text: message }),
        el('div', { class: 'pl-buttons' }, el('button', { class: 'btn big', text: '편집기로 돌아가기', attrs: { type: 'button' } })),
      );
      dialog.querySelector('button')?.addEventListener('click', () => close(null, null));
      stage.replaceChildren(el('div', { class: 'rcw-loading' }, dialog));
    };

    stage.append(el('div', { class: 'rcw-loading' }, el('div', { class: 'pl-dialog mint' }, el('h2', { class: 'pl-dialog-title', text: '불러오는 중...' }), el('p', { class: 'pl-dialog-text', text: '곡과 채보를 준비하고 있어요.' }))));

    void (async () => {
      try {
        const ext = req as PlayRequestExt;
        const hints = readEditorHints(req.difficulty);
        const noteIds = ext.noteIds ?? hints.noteIds ?? undefined;
        const build = toPlayChart(req.unityChart, req.difficulty, noteIds === undefined ? {} : { noteIds });
        const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtor === undefined) throw new PlayChartError('이 브라우저는 소리 재생을 지원하지 않아요. 크롬·엣지·사파리 최신 버전으로 열어 주세요.');
        const audioContext = new AudioCtor();
        context = audioContext;
        const buffer = await loadAudio(audioContext, req.audioUrl);
        if (closed) return;
        // 저장된 설정을 읽는다. 깨졌거나 범위를 벗어난 값은 가까운 값/기본값으로 고쳐지고, 고친 내용은 시작 창에 안내로 보인다
        const { settings, notes: settingsNotes } = loadSettingsWithNotes();
        if (settingsNotes.length > 0) saveSettings({}); // 고친 값을 저장해 같은 안내가 계속 뜨지 않게 한다
        playVolume.reload(); // 음악·효과음 볼륨은 저장된 값에서 다시 읽는다(음소거는 이번 화면을 여는 동안 유지)
        const preset: { startMs?: number; rate?: number; practice?: boolean } = {};
        if (req.startMs !== undefined) preset.startMs = Math.max(0, req.startMs);
        if (req.rate !== undefined) preset.rate = clampRate(req.rate);
        if (req.practice !== undefined) preset.practice = req.practice;
        const ctl = new PlayController({
          config: gameConfigFromSettings(settings),
          context: audioContext,
          buffer,
          allNotes: build.notes,
          allNoteIds: build.noteIds,
          title: build.title || '이름 없는 곡',
          difficulty: build.difficulty,
          keyMode: build.keyMode,
          bpm: ext.bpm ?? hints.bpm ?? 120,
          beatOriginMs: ext.beatOriginMs ?? hints.beatOriginMs,
          durationMs: req.durationMs > 0 ? req.durationMs : buffer.duration * 1000,
          preset,
          editorPositionMs: hints.positionMs,
          warnings: [...build.warnings, ...settingsNotes],
          stageScale: () => layout.last().fit.scale,
          onExit: (summary, id) => close(summary, id),
          onSettingsChange: (patch) => {
            saveSettings(patch);
          },
          hitSound: settings.hitSound,
          showJudgeDetail: settings.showJudgeDetail,
          screen: settings.playScreen,
          fallTimeMs10c: settings.fallTimeMs10c,
          songFileName: req.unityChart.song.audio_file || build.title || '이름 없는 곡',
        });
        controller = ctl;
        stage.replaceChildren(ctl.hud.root);
        ctl.attach();
        ctl.start();
      } catch (error) {
        if (closed) return;
        fail(error instanceof Error ? error.message : '알 수 없는 문제가 생겼어요.');
      }
    })();
  });
}
