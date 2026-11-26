// 테스트 플레이 진행 담당: 시작 준비 → 카운트다운 → 재생·판정 → 결과, 일시정지·이어하기·처음부터 다시.
// 원본(D:\RhythmActionGame_HitRus 의 playController)에서 스토리·몬스터·캐릭터·저장·메뉴 연결을 빼고,
// 재생 속도(rate)·시작 위치(startMs)·연습 모드·결과 요약(MISS 목록)을 더했다. 규칙(판정·점수)은 core\rules 를 그대로 쓴다.
import { EFFECT_CONFIG } from './effectConfig';
import { FeverEdge, feverFlashPlan, feverGlowLevel, feverRamp, hasHitFx } from './effectLogic';
import type { DifficultyName, GameConfig, Grade } from './core/config/gameConfig';
import { detectTouchDevice, renderPixelScale, MOBILE_CONFIG } from './core/config/viewConfig';
import type { ChartNote, LaneIndex } from './core/chart/types';
import type { JudgeEvent } from './core/rules/judge/judgeEngine';
import { RhythmSession, type SessionSnapshot } from './core/rules/session/rhythmSession';
import { Renderer10C } from '../play10c/renderer10c';
import { V10C } from '../play10c/config10c';
import { zoneBounds10c } from '../play10c/geometry10c';
import type { GameRenderer } from './gameRenderer';
import { FOUR_KEY_LABELS, LaneHoldCounter, PointerLaneTracker, laneFromKey, laneFromPointer, relativeX } from './inputMapper';
import { NOTE_STATE, VisibleNotes } from './noteLayout';
import { leadInStartMs, playEndMs } from './playClock';
import { PLAY_CONFIG } from './playConfig';
import { PlayFlow, countdownFinished, countdownNumber, reachedSegmentEnd, segmentProgress } from './playFlow';
import { PlayHud, type PauseSettings, type StartChoice } from './playHud';
import { PlayRenderer } from './playRenderer';
import { RunStats, type RunSummary } from './playResult';
import { PLAY_TEST_CONFIG } from './playTestConfig';
import { applyPlayJudgeToConfig, clonePlayJudge, describePlayJudge, musicGainOf, sfxLevelOf, type PlayJudgeOptions, type PlayVolumes } from './playOptions';
import { playJudge, playVolume } from './playOptionsStore';
import { SegmentPlayer } from './segmentPlayer';
import { SfxPlayer } from './sfx';
import { SyncRunner } from './syncRunner';
import { SYNC_CONFIG, clampDelayMs, recentMeanMs, type CalibrationResult } from './syncCalibration';
import { hitSfxName, type SfxName } from './sfxSynth';
import { WakeLockHolder } from './wakeLock';

/** 컨트롤러를 만들 때 필요한 것 */
export interface PlayControllerInit {
  /** 사용할 게임 수치(복사본). 입력 지연·낙하 시간·키는 설정에서 이미 채워져 있어야 한다 */
  config: GameConfig;
  context: AudioContext;
  buffer: AudioBuffer;
  /** 곡 전체 노트(시간 순)와 같은 순서의 편집기 노트 번호 */
  allNotes: readonly ChartNote[];
  allNoteIds: ReadonlyArray<number | null>;
  title: string;
  difficulty: string;
  /** [10단계] 키 모드: 2(기본) / 4 */
  keyMode?: 2 | 4;
  bpm: number;
  /** 박자 빛의 기준 시각(ms): 첫 박이 나오는 곡 시간 */
  beatOriginMs: number;
  durationMs: number;
  /** 요청이 정해 준 값. 있으면 시작 준비 화면을 건너뛴다 */
  preset: { startMs?: number; rate?: number; practice?: boolean };
  /** 시작 준비 화면에 보여 줄 편집기 위치(ms). 모르면 null */
  editorPositionMs: number | null;
  warnings: string[];
  /** 화면(스테이지)이 지금 몇 배로 보이는지 */
  stageScale: () => number;
  /** 한 판 결과를 가지고 나간다. summary 가 null 이면 취소(결과 없이 닫기) */
  onExit: (summary: RunSummary | null, gotoNoteId: number | null) => void;
  /** 일시정지 화면에서 설정을 바꿨다 → 저장소에 저장 */
  onSettingsChange: (patch: { inputDelayMs?: number; fallTimeMs?: number; fallTimeMs10c?: number; playScreen?: 'classic' | 'v10c'; hitSound?: boolean; showJudgeDetail?: boolean }) => void;
  /** 소리 효과·판정 표시의 시작값 */
  hitSound: boolean;
  showJudgeDetail: boolean;
  /** [11] 화면 모양(기본 기존 화면)과 새 화면 10-C 의 노트 속도(ms), 곡 이름(업로드한 파일 이름) */
  screen?: 'classic' | 'v10c';
  fallTimeMs10c?: number;
  songFileName?: string;
}

/** 점검용 읽기 도구(window.__rcwPlay) 모양 */
export interface PlayDebug {
  phase(): string;
  songMs(): number;
  heardSongMs(): number;
  noteCount(): number;
  notes(): readonly ChartNote[];
  snapshot(): SessionSnapshot | null;
  summary(): RunSummary | null;
  rate(): number;
  startMs(): number;
  settings(): { fallTimeMs: number; inputDelayMs: number; hitSound: boolean; showJudgeDetail: boolean; practice: boolean };
  pause(): void;
  resume(): void;
  /** [04b] 일시정지하고 [판정 설정]을 펼쳐 둔다 (PC 옆 패널의 [판정 설정] 버튼) */
  openJudgeSettings(): void;
  /** [04b] 이번 판에 실제로 쓰이는 판정 설정 */
  activeJudge(): PlayJudgeOptions | null;
  /** [04b] 소리 크기: 슬라이더 값과 실제 GainNode 목표값(음소거·곡선 반영) */
  volumes(): { music: number; sfx: number; muted: boolean; musicGain: number; sfxGain: number };
}

/** 규칙에 쓰는 난이도 이름(부정수치 허용 비율). 모르는 이름은 NORMAL */
export function ruleDifficulty(name: string): DifficultyName {
  const upper = name.toUpperCase();
  return upper === 'EASY' || upper === 'HARD' ? upper : 'NORMAL';
}

/** 이벤트 등록 한 건 */
interface Registration {
  target: EventTarget;
  type: string;
  handler: EventListener;
  options: AddEventListenerOptions | boolean;
}

export class PlayController {
  readonly hud: PlayHud;
  private readonly config: GameConfig;
  private readonly flow = new PlayFlow();
  private readonly lanes = new LaneHoldCounter();
  private readonly pointerLanes = new PointerLaneTracker();
  private readonly feverEdge = new FeverEdge();
  private readonly registrations: Registration[] = [];
  private readonly wake = new WakeLockHolder();
  private readonly minFrameMs: number;
  private readonly touchDevice = detectTouchDevice();
  private readonly hudView = { score: 0, combo: 0, comboQuiet: false, negativePercent: 0, feverGaugePercent: 0, feverActive: false, feverRemainingMs: 0, progress: 0, nowMs: 0 };

  /** 이번 판에서 칠 노트(시작 위치 뒤)와 편집기 노트 번호 */
  private notes: ChartNote[] = [];
  private noteIds: Array<number | null> = [];
  private rate = 1;
  private startMs = 0;
  private practice = true;
  private hitSound: boolean;
  private showJudgeDetail: boolean;
  /** 재생을 시작하는 곡 시간 (시작 위치보다 낙하 시간만큼 앞) */
  private playStartMs = 0;
  /** 끝내는 곡 시간 */
  private playEndMs = 0;
  /** [04b] 이번 판에 실제로 쓰이는 판정 설정 (판 시작·처음부터 다시 때 보관소에서 읽는다. 도중에는 바뀌지 않는다) */
  private activeJudgeOptions: PlayJudgeOptions | null = null;
  /** [04b] 볼륨 보관소 구독 해제 함수 */
  private unsubscribeVolume: (() => void) | null = null;
  /** [04b] 다음 일시정지 때 판정 설정을 펼쳐서 보여 줄지 */
  private openJudgeOnPause = false;
  /** 08: 실행 중인 [싱크 맞추기] */
  private syncRunner: SyncRunner | null = null;
  /** 08: 최근 판정의 빠름(−)/느림(+) 값(ms) — 판정 상세 표시의 "최근 판정 평균"용 */
  private recentDeltas: number[] = [];

  private session: RhythmSession | null = null;
  private stats: RunStats | null = null;
  private visible: VisibleNotes | null = null;
  private states = new Uint8Array(0);
  private burstIndices: number[] = [];
  private renderer: GameRenderer | null = null;
  /** [11] 지금 쓰는 화면 모양과 화면별 노트 속도(ms) */
  private screen: 'classic' | 'v10c' = 'classic';
  private fallClassicMs = 0;
  private fallV10cMs = 0;
  private zones10c: readonly number[] | null = null;
  private player: SegmentPlayer | null = null;
  private sfx: SfxPlayer | null = null;
  private raf = 0;
  private lastFrameMs = 0;
  private starting = false;
  private disposed = false;
  private lastSnapshot: SessionSnapshot | null = null;
  private lastSummary: RunSummary | null = null;
  private lastLane: LaneIndex = 0;
  /** 키 모드 (2 / 4) */
  private readonly keyMode: 2 | 4;
  private comboFromTick = false;
  private lastTickFxMs = -Infinity;
  private feverGlow = 0;
  private lastCountdownShown = 0;
  /** 규칙 쪽 판정 엔진이 세는 남은 연타 횟수 (함수를 한 번만 만들어 재사용) */
  private readonly remainingBurst = (noteIndex: number): number => this.session?.burstRemaining(noteIndex) ?? 0;

  private readonly init: PlayControllerInit;

  constructor(init: PlayControllerInit) {
    this.init = init;
    this.config = init.config;
    this.keyMode = init.keyMode === 4 ? 4 : 2;
    this.screen = init.screen === 'v10c' ? 'v10c' : 'classic';
    this.fallClassicMs = init.config.timing.fallTimeMs;
    this.fallV10cMs = init.fallTimeMs10c ?? V10C.note.travelMs;
    this.hitSound = init.hitSound;
    this.showJudgeDetail = init.showJudgeDetail;
    const limit = this.config.graphics.frameLimit;
    this.minFrameMs = limit > 0 ? 1000 / limit : 0;
    this.hud = new PlayHud({
      title: init.title,
      bpm: init.bpm,
      difficultyLabel: init.difficulty,
      laneLabels:
        this.keyMode === 4
          ? FOUR_KEY_LABELS // 4키: 판정원 안에 S D K L (터치 기기에서도 보인다)
          : this.touchDevice
            ? [null, null]
            : [keyLabel(this.config.input.keyLeft), keyLabel(this.config.input.keyRight)],
      keyMode: this.keyMode,
      onPause: () => this.pauseGame(),
      touchGuide: this.touchDevice,
    });
  }

  /** 입력 이벤트를 연결한다. 편집기의 단축키가 같이 반응하지 않도록 창에서 먼저(capture) 받아 막는다. */
  attach(): void {
    this.listen(window, 'keydown', (event) => this.onKeyDown(event as KeyboardEvent), true);
    this.listen(window, 'keyup', (event) => this.onKeyUp(event as KeyboardEvent), true);
    // 앱이 백그라운드로 가거나 화면이 잠기면 자동 일시정지 (돌아오면 일시정지 화면에서 이어하기)
    this.listen(window, 'blur', () => this.pauseGame());
    this.listen(window, 'pagehide', () => this.pauseGame());
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.pauseGame();
      else this.wake.reacquireIfWanted();
    });
    const layer = this.hud.inputLayer;
    this.listen(layer, 'pointerdown', (event) => this.onPointerDown(event as PointerEvent));
    this.listen(layer, 'pointerup', (event) => this.onPointerUp(event as PointerEvent));
    this.listen(layer, 'pointercancel', (event) => this.onPointerUp(event as PointerEvent));
    // 손가락이 화면 가장자리 제스처 등으로 끊겨도 눌림이 남지 않게 정리한다
    this.listen(layer, 'lostpointercapture', (event) => this.onPointerUp(event as PointerEvent));
    this.listen(layer, 'contextmenu', (event) => event.preventDefault());
    this.installDebug();
  }

  /** 이벤트를 달고, 나중에 한꺼번에 뗄 수 있게 기록해 둔다 */
  private listen(target: EventTarget, type: string, handler: EventListener, capture = false): void {
    const options: AddEventListenerOptions | boolean = capture;
    target.addEventListener(type, handler, options);
    this.registrations.push({ target, type, handler, options });
  }

  /** 시작: 요청이 시작 위치·속도를 정해 주었으면 바로, 아니면 시작 준비 화면을 보인다. */
  start(): void {
    const preset = this.init.preset;
    if (preset.startMs !== undefined || preset.rate !== undefined || preset.practice !== undefined) {
      this.begin({ rate: preset.rate ?? 1, startMs: preset.startMs ?? 0, practice: preset.practice ?? true });
      return;
    }
    this.flow.enterReady(performance.now());
    this.openStartPanel({ rate: 1, startMs: 0, practice: true });
  }

  /** 시작 준비 화면을 연다(처음, 그리고 [싱크 맞추기]에서 돌아올 때 고른 값 그대로) */
  private openStartPanel(choice: StartChoice): void {
    this.hud.showStart({
      title: this.init.title,
      difficulty: this.init.difficulty,
      noteCount: this.init.allNotes.length,
      rate: choice.rate,
      editorPositionMs: this.init.editorPositionMs,
      startMs: choice.startMs,
      practice: choice.practice,
      durationMs: this.init.durationMs,
      screen: this.screen,
      warnings: this.init.warnings,
      inputDelayMs: this.config.timing.inputDelayMs,
      onInputDelayChange: (ms) => this.applySettings({ inputDelayMs: clampDelayMs(ms, this.config.timing.inputDelayMs) }),
      onCalibrate: (picked) => this.startCalibration(picked),
      onStart: (picked) => this.begin(picked),
      onCancel: () => this.exit(null, null),
    });
  }

  /** 08: [싱크 맞추기]: 박자 소리를 들려주고 누름을 모은 뒤 결과를 보여 준다. 끝나면 시작 준비 화면으로 돌아간다. */
  private startCalibration(back: StartChoice): void {
    this.syncRunner?.cancel();
    const volume = playVolume.get();
    const clickPlayer = new SfxPlayer(this.init.context, 100, sfxLevelOf(volume), null);
    const leave = (): void => {
      clickPlayer.dispose();
      this.syncRunner = null;
      if (!this.disposed) this.openStartPanel(back);
    };
    const run = (): void => {
      const update = this.hud.showSyncRunning(SYNC_CONFIG.beats, () => {
        this.syncRunner?.cancel();
        leave();
      });
      this.syncRunner = new SyncRunner(this.init.context, clickPlayer, {
        onProgress: (counted) => update(counted),
        onDone: (result: CalibrationResult) => {
          this.hud.showSyncResult(
            result,
            this.config.timing.inputDelayMs,
            (ms) => {
              this.applySettings({ inputDelayMs: ms }); // 이 기기 설정(settingsStore)에 저장된다
              leave();
            },
            () => run(),
            leave,
          );
        },
      });
      void this.syncRunner.start();
    };
    run();
  }

  /** 고른 값으로 한 판을 준비하고 카운트다운을 시작한다. */
  private begin(choice: StartChoice): void {
    try {
      this.applyScreen(choice.screen ?? this.screen);
      this.rate = choice.rate;
      this.startMs = choice.startMs;
      this.practice = choice.practice;
      this.applyPractice();
      const from = this.init.allNotes.map((note, index) => ({ note, id: this.init.allNoteIds[index] ?? null })).filter((item) => item.note.timeMs >= this.startMs);
      this.notes = from.map((item) => item.note);
      this.noteIds = from.map((item) => item.id);
      if (this.notes.length === 0) {
        this.hud.showError('시작 위치 뒤에는 노트가 없어요. 더 앞에서 시작해 주세요.', () => this.exit(null, null));
        return;
      }
      this.playStartMs = leadInStartMs(this.startMs, this.config.timing.fallTimeMs);
      this.playEndMs = playEndMs(this.notes, PLAY_TEST_CONFIG.endTailMs);
      // [04b] 볼륨: 슬라이더 값 → (v/100)^2 곡선, 음소거 반영. 음악은 Web Audio GainNode 로 조절하므로 iPhone 에서도 동작한다
      const volume = playVolume.get();
      this.player = new SegmentPlayer(this.init.context, this.init.buffer, this.config.timing, musicGainOf(volume), this.rate);
      this.sfx = new SfxPlayer(this.init.context, 100, sfxLevelOf(volume));
      this.unsubscribeVolume?.();
      this.unsubscribeVolume = playVolume.subscribe((v) => this.applyVolume(v));
      this.renderer?.dispose();
      this.renderer = null;
      const pixelScale = renderPixelScale(this.init.stageScale(), window.devicePixelRatio || 1, this.touchDevice ? MOBILE_CONFIG.touchPixelRatioCap : MOBILE_CONFIG.desktopPixelRatioCap);
      if (this.screen === 'v10c') {
        try {
          const labels = this.keyMode === 4 ? FOUR_KEY_LABELS : [keyLabel(this.config.input.keyLeft), keyLabel(this.config.input.keyRight)];
          this.renderer = new Renderer10C({
            canvas: this.hud.canvas10c,
            notes: this.notes,
            keyMode: this.keyMode,
            songName: this.init.songFileName ?? this.init.title,
            difficulty: this.init.difficulty,
            keyLabels: this.touchDevice ? null : labels,
            pixelScale,
          });
        } catch {
          throw new Error('새 화면(10-C)을 그릴 수 없어요. 기존 화면으로 바꿔서 다시 시도해 주세요.');
        }
      } else {
        try {
          this.renderer = new PlayRenderer(
            this.hud.canvas,
            this.notes,
            this.config.graphics.renderScalePercent,
            PLAY_CONFIG.maxVisibleNotes,
            PLAY_CONFIG.burstLabelPool,
            this.config.graphics.effectLevel,
            pixelScale,
            this.keyMode,
          );
        } catch {
          throw new Error('그래픽(WebGL)을 쓸 수 없어요. 브라우저를 최신 버전으로 바꾸거나 크롬으로 열어 주세요.');
        }
      }
      this.states = new Uint8Array(this.notes.length);
      this.burstIndices = [];
      this.notes.forEach((note, index) => {
        if (note.type === 'burst') this.burstIndices.push(index);
      });
      this.hud.hideOverlay();
      this.resetRun();
      this.lastFrameMs = performance.now();
      this.flow.startCountdown(performance.now(), this.playStartMs);
      this.raf = requestAnimationFrame(this.frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 문제가 생겼어요.';
      this.flow.fail(performance.now());
      this.hud.showError(message, () => this.exit(null, null));
    }
  }

  /** [11] 화면 모양을 정한다: HUD 모양, 화면별 노트 속도, 터치 구역을 맞추고 고른 값을 설정에 저장한다. */
  private applyScreen(screen: 'classic' | 'v10c'): void {
    const changed = screen !== this.screen;
    this.screen = screen;
    this.config.timing.fallTimeMs = screen === 'v10c' ? this.fallV10cMs : this.fallClassicMs;
    this.zones10c = screen === 'v10c' ? zoneBounds10c(this.keyMode) : null;
    this.hud.setScreen(screen);
    if (changed) this.init.onSettingsChange({ playScreen: screen });
  }

  /** 연습 모드이면 부정수치가 100%가 되어도 실패하지 않게 한다(원본 규칙은 practice: false). */
  private applyPractice(): void {
    this.config.negative.failPercent = this.practice ? Number.POSITIVE_INFINITY : 100;
  }

  /** Esc: 재생·카운트다운 중이면 일시정지, 일시정지 중이면 이어하기. 처리했으면 true */
  onEscape(): boolean {
    const phase = this.flow.phase;
    if (phase === 'playing' || phase === 'countdown' || phase === 'resuming') {
      this.pauseGame();
      return true;
    }
    if (phase === 'paused') {
      this.resumeGame();
      return true;
    }
    return false;
  }

  /** 판정원(그림)과 키 안내(HUD)의 눌림 표시를 함께 바꾼다. */
  /** 이번 판의 레인 번호 목록 (2키 [0,1] / 4키 [0,1,2,3]) */
  private laneList(): readonly LaneIndex[] {
    return this.keyMode === 4 ? [0, 1, 2, 3] : [0, 1];
  }

  /** 모든 레인의 눌림 표시를 끈다 */
  private allLanesUp(): void {
    for (const lane of this.laneList()) this.setLaneDown(lane, false);
  }

  private setLaneDown(lane: LaneIndex, down: boolean): void {
    this.hud.setLane(lane, down);
    this.renderer?.setLaneDown(lane, down);
  }

  /** 새 판을 시작할 준비: 규칙 세션·화면 상태·판정원 불·연출을 처음으로 되돌린다. */
  private resetRun(): void {
    this.comboFromTick = false;
    this.lastTickFxMs = -Infinity;
    this.recentDeltas = [];
    this.hud.setSyncInfo('');
    // [04b] 판정 설정은 판을 시작할 때(처음부터 다시 포함)만 읽는다. 플레이 도중에 바꿔도 이번 판에는 영향이 없다
    const judge = playJudge.get();
    applyPlayJudgeToConfig(this.config, judge);
    this.activeJudgeOptions = judge;
    this.session = new RhythmSession(this.notes, ruleDifficulty(this.init.difficulty), this.config, this.init.bpm);
    this.stats = new RunStats(this.notes, this.noteIds);
    this.visible = new VisibleNotes(this.notes, PLAY_CONFIG.maxVisibleNotes);
    this.states.fill(NOTE_STATE.waiting);
    this.lanes.clear();
    this.pointerLanes.clear();
    this.allLanesUp();
    this.hud.clearJudge();
    this.hud.setCountdown(0);
    this.hud.resetEffects();
    this.feverEdge.reset();
    this.feverGlow = 0;
    this.lastCountdownShown = 0;
    this.lastSummary = null;
    this.lastSnapshot = null;
    this.renderer?.clear();
    this.hud.showTapHint();
    this.drawFrame(this.playStartMs, performance.now(), 0);
  }

  /** 한 프레임 (requestAnimationFrame) */
  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    this.syncWakeLock();
    if (this.minFrameMs > 0 && now - this.lastFrameMs < this.minFrameMs - PLAY_CONFIG.frameSlackMs) return;
    const dt = now - this.lastFrameMs;
    this.lastFrameMs = now;
    switch (this.flow.phase) {
      case 'countdown':
      case 'resuming':
        this.stepCountdown(now, dt);
        break;
      case 'playing':
        this.stepPlaying(now, dt);
        break;
      default:
        break;
    }
  };

  /** 플레이·카운트다운 중에만 화면 꺼짐 방지를 켜고, 일시정지·결과·실패에서는 끈다. */
  private syncWakeLock(): void {
    const phase = this.flow.phase;
    const active = phase === 'playing' || phase === 'countdown' || phase === 'resuming';
    if (active && !this.wake.isWanted) void this.wake.acquire();
    else if (!active && this.wake.isWanted) this.wake.release();
  }

  /** 카운트다운: 숫자를 보여 주고(숫자가 바뀔 때 똑딱 소리), 끝나면 곡을 재생한다. 이 동안 곡 시간은 멈춰 있다. */
  private stepCountdown(now: number, dt: number): void {
    const phase = this.flow.phase;
    const total = phase === 'countdown' ? PLAY_CONFIG.startCountdownSec : PLAY_CONFIG.resumeCountdownSec;
    const elapsed = this.flow.elapsedMs(now);
    const shown = countdownNumber(elapsed, total);
    if (shown !== this.lastCountdownShown) {
      this.lastCountdownShown = shown;
      if (shown > 0) this.playSfx('countTick');
    }
    this.hud.setCountdown(shown);
    this.drawFrame(this.flow.frozenMs, now, dt);
    if (countdownFinished(elapsed, total) && !this.starting) {
      this.starting = true;
      void this.beginPlayback();
    }
  }

  /** 곡을 멈춘 지점부터 재생하고 재생 단계로 들어간다. */
  private async beginPlayback(): Promise<void> {
    const player = this.player;
    if (player === null) return;
    try {
      await player.startAt(this.flow.frozenMs);
    } catch {
      this.starting = false;
      this.flow.fail(performance.now());
      this.hud.setCountdown(0);
      this.hud.showError('곡을 재생하지 못했어요. 소리 장치를 확인한 뒤 다시 시도해 주세요.', () => this.exit(null, null));
      return;
    }
    this.starting = false;
    if (this.disposed || (this.flow.phase !== 'countdown' && this.flow.phase !== 'resuming')) {
      player.stop();
      return;
    }
    this.hud.setCountdown(0);
    this.lastCountdownShown = 0;
    this.playSfx('countGo');
    this.flow.beginPlaying(performance.now());
  }

  /** 재생 중 한 프레임: 판정 시간 진행 → 끝/실패 확인 → 그리기 */
  private stepPlaying(now: number, dt: number): void {
    const player = this.player;
    const session = this.session;
    if (player === null || session === null) return;
    const songMs = player.nowSongMs();
    if (reachedSegmentEnd(songMs, this.playEndMs)) {
      this.finishRun(now, songMs);
      return;
    }
    this.handleEvents(session.advance(songMs - PLAY_CONFIG.advanceMarginMs), now);
    const snapshot = this.drawFrame(songMs, now, dt);
    if (snapshot !== null && snapshot.failed) this.failRun(now, songMs);
  }

  /** 지금 상태를 화면에 그린다. 규칙의 현재 상태(snapshot)를 돌려준다. */
  private drawFrame(songMs: number, now: number, dt: number): SessionSnapshot | null {
    const session = this.session;
    const renderer = this.renderer;
    const visible = this.visible;
    if (session === null || renderer === null || visible === null) return null;
    const snapshot = session.snapshot(songMs);
    this.lastSnapshot = snapshot;
    this.updateFever(snapshot.feverActive, now, dt);
    const timing = this.config.timing;
    visible.collect(songMs, timing.visualOffsetMs, timing.fallTimeMs, renderer.shape.bottomProgress);
    // 새 화면은 점수·콤보·게이지를 직접 그린다: 규칙의 snapshot 값을 그대로 넘긴다
    renderer.setStatus?.({
      score: snapshot.score,
      combo: snapshot.combo,
      feverGaugePercent: snapshot.feverGaugePercent,
      negativePercent: snapshot.negativePercent,
      progress: segmentProgress(songMs, this.playStartMs, this.playEndMs),
      burstRemaining: this.remainingBurst,
    });
    renderer.render(songMs, timing.visualOffsetMs, timing.fallTimeMs, visible, this.states, now, dt);
    this.hud.setBurstLabels(renderer.burstAnchors, this.remainingBurst);
    this.hud.setBeatGlow(this.beatGlowAt(songMs));

    const view = this.hudView;
    view.score = snapshot.score;
    view.combo = snapshot.combo;
    view.comboQuiet = this.comboFromTick;
    view.negativePercent = snapshot.negativePercent;
    view.feverGaugePercent = snapshot.feverGaugePercent;
    view.feverActive = snapshot.feverActive;
    view.feverRemainingMs = (snapshot.feverGaugePercent / 100) * this.config.fever.durationMs;
    view.progress = segmentProgress(songMs, this.playStartMs, this.playEndMs);
    view.nowMs = now;
    this.hud.update(view);
    return snapshot;
  }

  /** 박자에 맞춘 배경 빛(0~1): 박 시작 순간이 가장 밝고 점점 어두워진다. 재생·카운트다운 중에만 켠다 */
  private beatGlowAt(songMs: number): number {
    const phase = this.flow.phase;
    if (phase !== 'playing' || !(this.init.bpm > 0)) return 0;
    const beatMs = 60000 / this.init.bpm;
    const into = (((songMs - this.init.beatOriginMs) % beatMs) + beatMs) % beatMs;
    const { peak, power } = PLAY_TEST_CONFIG.beatGlow;
    return peak * Math.pow(1 - into / beatMs, power);
  }

  /** 피버 시작·끝 연출과 레일 빛남 */
  private updateFever(active: boolean, now: number, dt: number): void {
    const change = this.feverEdge.update(active);
    if (change === 'start') {
      const fever = EFFECT_CONFIG.fever;
      this.hud.feverBurst(feverFlashPlan(this.config.graphics.effectLevel, fever.flashPeak, fever.flashMs, fever.flashOffAtLow));
      this.hud.setFeverActive(true);
      this.playSfx('feverStart');
    } else if (change === 'end') {
      this.hud.setFeverActive(false);
      this.playSfx('feverEnd');
    }
    // 발광 단계는 켜질 때 glowRiseMs, 꺼질 때 glowFadeMs 동안 부드럽게 변하고, 피버 중에는 천천히 숨 쉬듯 오간다
    const cfg = EFFECT_CONFIG.fever;
    const before = this.feverGlow;
    this.feverGlow = feverRamp(this.feverGlow, active, Math.min(dt, 100), cfg.glowRiseMs, cfg.glowFadeMs);
    if (this.feverGlow > 0 || before > 0) {
      const level = feverGlowLevel(this.feverGlow, now, cfg.breathPeriodMs, cfg.breathDepth);
      this.renderer?.setFeverGlow(level);
      this.hud.setFeverGlow(level * cfg.bgOpacity * this.config.fever.glowStrength);
    }
  }

  /** [04b] 볼륨이 바뀌면(시작 전 창·일시정지 시트·PC 옆 패널) 플레이 도중에도 바로 소리 크기에 반영한다 */
  private applyVolume(v: PlayVolumes): void {
    this.player?.setVolume(musicGainOf(v));
    this.sfx?.setVolume(100, sfxLevelOf(v));
  }

  /** 효과음을 낸다. 효과음 설정이 꺼져 있어도 카운트·일시정지 소리는 낸다. */
  private playSfx(name: SfxName): void {
    if (!this.hitSound && name !== 'countTick' && name !== 'countGo' && name !== 'pause') return;
    this.sfx?.play(name);
  }

  /** 판정 글자에 붙일 "빠름/느림" 값 (설정이 꺼져 있으면 null) */
  private detailFor(event: JudgeEvent): number | null {
    if (this.showJudgeDetail && event.grade !== 'miss' && event.deltaMs !== null && Number.isFinite(event.deltaMs)) this.noteDelta(event.deltaMs);
    return this.showJudgeDetail ? event.deltaMs : null;
  }

  /** 08: 판정 하나의 빠름/느림을 기록하고 구석 표시("기기 소리 지연 약 N ms · 최근 판정 평균 ±N ms")를 새로 쓴다 */
  private noteDelta(deltaMs: number): void {
    this.recentDeltas.push(deltaMs);
    if (this.recentDeltas.length > 10) this.recentDeltas.shift();
    this.refreshSyncInfo();
  }

  private refreshSyncInfo(): void {
    if (!this.showJudgeDetail) {
      this.hud.setSyncInfo('');
      return;
    }
    const delay = Math.round(this.player?.outputDelayMs() ?? 0);
    const mean = recentMeanMs(this.recentDeltas);
    const meanText = mean === null ? '-' : `${mean >= 0 ? '+' : '−'}${Math.round(Math.abs(mean))}ms`;
    this.hud.setSyncInfo(`기기 소리 지연 약 ${delay}ms · 최근 판정 평균 ${meanText}`);
  }

  /** 판정 사건을 화면 상태(노트 그림·판정 글자·이펙트·효과음)에 반영한다. 점수·부정수치는 이미 규칙 쪽에서 계산되었다. */
  private handleEvents(events: JudgeEvent[], now: number): void {
    for (const event of events) {
      this.stats?.add(event);
      const index = event.noteIndex;
      const note = this.notes[index];
      const lane: LaneIndex = note !== undefined && note.lane !== 'both' ? note.lane : this.lastLane;
      if (event.weight > 0) this.comboFromTick = event.kind === 'holdTick';
      if (event.kind === 'holdTick') {
        // 틱: 판정 글자 없이 작은 링, 가벼운 틱 소리. 촘촘할 때를 위해 화면 시각 기준 최소 간격을 둔다
        if (now - this.lastTickFxMs < EFFECT_CONFIG.holdTick.minGapMs) continue;
        this.lastTickFxMs = now;
        this.renderer?.effects.holdTick(lane, now);
        this.playSfx('holdTick');
        continue;
      }
      if (event.kind === 'holdStarted') {
        this.states[index] = NOTE_STATE.holding;
        this.lastLane = lane;
        this.onJudged(lane, event.grade, now, this.detailFor(event));
        this.renderer?.effects.holdStart(lane);
        this.playSfx('holdStart');
        continue;
      }
      if (event.noteType === 'hold') {
        this.renderer?.effects.holdEnd(lane);
        // 끝까지 잡은 롱노트는 시작할 때 이미 판정 글자를 보였으므로 놓친 경우(회색으로 계속 내려감)만 다시 보인다
        if (event.grade === 'miss') {
          this.states[index] = NOTE_STATE.broken;
          this.onJudged(lane, 'miss', now, null);
        } else {
          this.states[index] = NOTE_STATE.done;
          this.renderer?.effects.hit(lane, 'good', now);
          this.playSfx('holdEnd');
        }
        continue;
      }
      this.states[index] = NOTE_STATE.done;
      if (event.noteType === 'burst') {
        if (event.grade === 'miss') {
          this.onJudged(this.lastLane, 'miss', now, null);
        } else {
          this.hud.showJudge(event.grade);
          this.renderer?.effects.burstSuccess(now);
          this.playSfx('burstSuccess');
        }
        continue;
      }
      this.lastLane = lane;
      this.onJudged(lane, event.grade, now, this.detailFor(event));
    }
  }

  /** 단타·롱노트 머리의 판정 하나: 판정 글자, 이펙트, 타격음 (MISS 는 붉은 글자와 소리만) */
  private onJudged(lane: LaneIndex, grade: Grade, now: number, detailMs: number | null): void {
    this.hud.showJudge(grade, detailMs);
    this.playSfx(hitSfxName(grade));
    this.renderer?.judged?.(lane, grade, now);
    if (!hasHitFx(grade)) return;
    this.renderer?.effects.hit(lane, grade, now);
  }

  /** 끝에 닿았다: 남은 노트를 확정하고 결과 화면을 띄운다. */
  private finishRun(now: number, songMs: number): void {
    const session = this.session;
    const player = this.player;
    if (session === null || player === null) return;
    this.releaseHeldLanes(songMs, now);
    this.handleEvents(session.finish(), now);
    player.stop();
    this.drawFrame(songMs, now, 0);
    this.flow.finish(now, !session.result().failed);
    this.showResultPanel();
  }

  /** 부정수치 100%(연습 모드가 아닐 때만): 곡을 바로 멈추고 실패 결과를 보여 준다. */
  private failRun(now: number, songMs: number): void {
    const session = this.session;
    if (session === null) return;
    session.finish();
    this.player?.stop();
    this.lanes.clear();
    this.pointerLanes.clear();
    this.allLanesUp();
    this.renderer?.effects.clear();
    this.drawFrame(songMs, now, 0);
    this.flow.finish(now, false);
    this.showResultPanel();
  }

  /** 결과 화면: 점수·판정별 개수·최대 콤보·평균 오차·MISS 목록 */
  private showResultPanel(): void {
    const session = this.session;
    const stats = this.stats;
    if (session === null || stats === null) return;
    this.hud.setCountdown(0);
    const summary = stats.summarize(session.result());
    this.lastSummary = summary;
    this.hud.showResult(
      { summary, practice: this.practice, judgeNote: this.activeJudgeOptions === null ? null : describePlayJudge(this.activeJudgeOptions), onMissClick: (noteId) => this.exit(summary, noteId) },
      [
        { label: '다시하기', primary: true, onClick: () => this.restart() },
        { label: '편집기로', onClick: () => this.exit(summary, null) },
      ],
    );
  }

  /** 일시정지: 곡과 시간을 멈추고 패널을 보인다. 누르고 있던 레인은 뗀 것으로 처리한다. */
  private pauseGame(): void {
    const phase = this.flow.phase;
    if (phase !== 'playing' && phase !== 'countdown' && phase !== 'resuming') return;
    const player = this.player;
    const songMs = phase === 'playing' && player !== null ? player.pause() : this.flow.frozenMs;
    if (phase === 'playing') this.releaseHeldLanes(songMs, performance.now());
    this.starting = false;
    this.flow.pause(performance.now(), songMs);
    this.hud.setCountdown(0);
    this.lastCountdownShown = 0;
    this.renderer?.effects.clear();
    this.playSfx('pause');
    this.pauseSheetRefresh();
  }

  /** 일시정지 시트(설정·볼륨·판정 설정)를 그린다. 이미 일시정지 중이어도 다시 그릴 수 있다 */
  private pauseSheetRefresh(): void {
    const settings: PauseSettings = {
      inputDelayMs: this.config.timing.inputDelayMs,
      fallTimeMs: this.config.timing.fallTimeMs,
      hitSound: this.hitSound,
      showJudgeDetail: this.showJudgeDetail,
    };
    const openJudge = this.openJudgeOnPause;
    this.openJudgeOnPause = false;
    this.hud.showPause(
      settings,
      (patch) => this.applySettings(patch),
      [
        { label: '이어하기', primary: true, onClick: () => this.resumeGame() },
        { label: '처음부터 다시', onClick: () => this.restart() },
        { label: '나가기', onClick: () => this.exit(null, null) },
      ],
      openJudge,
    );
  }

  /** 일시정지 화면에서 바꾼 설정을 바로 적용하고 저장소에 저장한다(편집기 [테스트]와 같은 값). */
  private applySettings(patch: Partial<PauseSettings>): void {
    if (patch.inputDelayMs !== undefined) this.config.timing.inputDelayMs = patch.inputDelayMs;
    if (patch.fallTimeMs !== undefined) {
      this.config.timing.fallTimeMs = patch.fallTimeMs;
      if (this.screen === 'v10c') this.fallV10cMs = patch.fallTimeMs;
      else this.fallClassicMs = patch.fallTimeMs;
    }
    if (patch.hitSound !== undefined) this.hitSound = patch.hitSound;
    if (patch.showJudgeDetail !== undefined) {
      this.showJudgeDetail = patch.showJudgeDetail;
      this.refreshSyncInfo();
    }
    // 노트 속도는 화면 모양별로 따로 저장한다 (새 화면 10-C 는 fallTimeMs10c)
    const { fallTimeMs, ...rest } = patch;
    this.init.onSettingsChange(fallTimeMs === undefined ? rest : this.screen === 'v10c' ? { ...rest, fallTimeMs10c: fallTimeMs } : { ...rest, fallTimeMs });
  }

  /** 이어하기: 패널을 닫고 3초 카운트 뒤에 멈춘 지점부터 다시 재생한다. */
  private resumeGame(): void {
    if (!this.flow.resume(performance.now())) return;
    this.hud.hideOverlay();
  }

  /** 다시하기: 같은 설정으로 처음(시작 위치)부터 다시 한다. */
  private restart(): void {
    if (this.player === null || this.renderer === null) return;
    this.player.stop();
    this.starting = false;
    this.hud.hideOverlay();
    this.resetRun();
    this.flow.restart(performance.now(), this.playStartMs);
  }

  /** 누르고 있던 레인을 뗀 것으로 규칙에 알린다. (일시정지·끝) */
  private releaseHeldLanes(songMs: number, now: number): void {
    const session = this.session;
    if (session === null) return;
    for (const lane of this.laneList()) {
      if (!this.lanes.isDown(lane)) continue;
      this.handleEvents(session.releaseLane(lane, songMs), now);
      this.setLaneDown(lane, false);
    }
    this.lanes.clear();
    this.pointerLanes.clear();
  }

  /** 지금 곡 시간에 진행 중인(아직 확정 안 된) 연타 노트 번호. 없으면 -1 */
  private activeBurstIndex(songMs: number): number {
    for (const index of this.burstIndices) {
      const note = this.notes[index]!;
      if (this.states[index] === NOTE_STATE.done) continue;
      if (songMs >= note.timeMs && songMs < note.timeMs + note.durationMs) return index; // 끝 시각은 구간에 넣지 않는다(judgeEngine 과 같은 규칙)
    }
    return -1;
  }

  /** 레인 눌림 처리 (키보드·마우스·터치 공통). timeStamp 는 입력 이벤트의 시각 */
  private press(lane: LaneIndex, timeStamp: number): void {
    if (this.flow.phase !== 'playing') return;
    const player = this.player;
    const session = this.session;
    if (player === null || session === null) return;
    if (!this.lanes.press(lane)) return; // 이미 눌려 있음 (키보드 + 마우스 동시 입력 등)
    const songMs = player.inputEventToSongMs(timeStamp);
    const now = performance.now();
    this.setLaneDown(lane, true);
    this.lastLane = lane;
    const burst = this.activeBurstIndex(songMs);
    const before = burst >= 0 ? session.burstRemaining(burst) : 0;
    this.handleEvents(session.pressLane(lane, songMs), now);
    if (burst >= 0 && session.burstRemaining(burst) < before) {
      // 연타를 한 번 셌다: 작은 이펙트와 누름 소리
      this.renderer?.effects.burstPress(now);
      this.playSfx('burstPress');
    }
    if (session.snapshot(songMs).failed) this.failRun(now, songMs);
  }

  /** 레인 뗌 처리 */
  private release(lane: LaneIndex, timeStamp: number): void {
    if (!this.lanes.release(lane)) return;
    this.setLaneDown(lane, false);
    if (this.flow.phase !== 'playing') return;
    const player = this.player;
    const session = this.session;
    if (player === null || session === null) return;
    const songMs = player.inputEventToSongMs(timeStamp);
    const now = performance.now();
    this.handleEvents(session.releaseLane(lane, songMs), now);
    if (session.snapshot(songMs).failed) this.failRun(now, songMs);
  }

  private onKeyDown(event: KeyboardEvent): void {
    // 플레이 화면이 열려 있는 동안 편집기 단축키는 동작하지 않게 한다(브라우저 기본 동작은 막지 않는다)
    event.stopPropagation();
    if (event.code === 'Escape') {
      if (!event.repeat) this.onEscape();
      event.preventDefault();
      return;
    }
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const lane = laneFromKey(event.code, this.config.input, this.keyMode);
    if (lane === null) return;
    event.preventDefault();
    this.press(lane, event.timeStamp);
  }

  private onKeyUp(event: KeyboardEvent): void {
    event.stopPropagation();
    const lane = laneFromKey(event.code, this.config.input, this.keyMode);
    if (lane === null) return;
    event.preventDefault();
    this.release(lane, event.timeStamp);
  }

  private onPointerDown(event: PointerEvent): void {
    const layer = this.hud.inputLayer;
    const rect = layer.getBoundingClientRect();
    const lane = laneFromPointer(relativeX(event.clientX, rect.left, rect.width), this.config.input, this.keyMode, this.zones10c);
    if (lane === null) return;
    event.preventDefault();
    try {
      // 손가락이 입력 영역 밖으로 밀려 나가도 같은 손가락의 떼기 이벤트를 받는다 (잡을 수 없는 경우는 무시)
      layer.setPointerCapture(event.pointerId);
    } catch {
      // 캡처를 못 해도 입력은 처리한다
    }
    if (!this.pointerLanes.down(event.pointerId, lane)) return;
    this.press(lane, event.timeStamp);
  }

  private onPointerUp(event: PointerEvent): void {
    const lane = this.pointerLanes.up(event.pointerId);
    if (lane === undefined) return;
    this.release(lane, event.timeStamp);
  }

  /** 화면을 나간다: 결과(또는 취소)를 알리고 정리는 바깥(index)이 dispose 로 한다. */
  private exit(summary: RunSummary | null, gotoNoteId: number | null): void {
    this.init.onExit(summary ?? this.lastSummary, gotoNoteId);
  }

  /** 화면을 닫을 때 소리·그림·반복·이벤트를 모두 정리한다. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.wake.release();
    for (const item of this.registrations) item.target.removeEventListener(item.type, item.handler, item.options);
    this.registrations.length = 0;
    this.unsubscribeVolume?.();
    this.unsubscribeVolume = null;
    this.syncRunner?.cancel();
    this.syncRunner = null;
    this.player?.dispose();
    this.sfx?.dispose();
    this.renderer?.dispose();
    this.player = null;
    this.sfx = null;
    this.renderer = null;
    this.session = null;
    this.visible = null;
    this.hud.root.remove();
    delete (window as unknown as { __rcwPlay?: PlayDebug }).__rcwPlay;
  }

  /** 점검용 읽기 도구를 연다(자동 점검이 상태를 읽는 데만 쓴다). */
  private installDebug(): void {
    const debug: PlayDebug = {
      phase: () => this.flow.phase,
      songMs: () => this.player?.nowSongMs() ?? 0,
      heardSongMs: () => this.player?.inputEventToSongMs(performance.now()) ?? 0,
      noteCount: () => this.notes.length,
      notes: () => this.notes,
      snapshot: () => this.lastSnapshot,
      summary: () => this.lastSummary,
      rate: () => this.rate,
      startMs: () => this.startMs,
      settings: () => ({ fallTimeMs: this.config.timing.fallTimeMs, inputDelayMs: this.config.timing.inputDelayMs, hitSound: this.hitSound, showJudgeDetail: this.showJudgeDetail, practice: this.practice }),
      pause: () => this.pauseGame(),
      resume: () => this.resumeGame(),
      openJudgeSettings: () => {
        this.openJudgeOnPause = true;
        if (this.flow.phase === 'paused') this.pauseSheetRefresh();
        else this.pauseGame();
        this.openJudgeOnPause = false;
      },
      activeJudge: () => (this.activeJudgeOptions === null ? null : clonePlayJudge(this.activeJudgeOptions)),
      volumes: () => {
        const v = playVolume.get();
        return { music: v.music, sfx: v.sfx, muted: v.muted, musicGain: this.player?.volume ?? musicGainOf(v), sfxGain: this.sfx?.gain ?? 0 };
      },
    };
    (window as unknown as { __rcwPlay?: PlayDebug }).__rcwPlay = debug;
  }
}

/** 키 이름(KeyboardEvent.code)을 화면에 보일 짧은 글자로 바꾼다 (KeyS → S) */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `숫자 ${code.slice(6)}`;
  const names: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Quote: "'" };
  return names[code] ?? code;
}
