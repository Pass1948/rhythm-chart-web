// 플레이 화면의 HTML 겹침 화면(HUD): 점수·게이지·콤보·곡 정보·판정 글자·카운트다운·안내 패널(시작 준비·일시정지·결과).
// 값이 바뀔 때만 글자를 고쳐서 프레임마다 화면 구조를 건드리지 않는다. 이미지 파일은 쓰지 않는다(전부 코드로 그림).
import type { Grade } from './core/config/gameConfig';
import { MOBILE_CONFIG } from './core/config/viewConfig';
import { el } from './dom';
import { EFFECT_CONFIG } from './effectConfig';
import { ComboTracker, comboOpacity } from './effectLogic';
import { keyGuidePosition } from './keyGuide';
import { FOUR_KEY_LABELS, fourKeyZoneBounds } from './inputMapper';
import { negativeGaugeColor, formatScore } from './playFlow';
import { PLAY_CONFIG, PLAY_VIEW } from './playConfig';
import type { BurstAnchors } from './playRenderer';
import { PLAY_TEST_CONFIG } from './playTestConfig';
import { SYNC_CONFIG, clampDelayMs, type CalibrationResult } from './syncCalibration';
import { judgeSettingsPanel, volumeControls } from './playOptionsUi';
import { playJudge, playVolume } from './playOptionsStore';
import type { RunSummary } from './playResult';
import { createRailShape, type RailShape } from './railGeometry';

/** 매 프레임 HUD 에 넘기는 값 */
export interface HudView {
  score: number;
  combo: number;
  /** 콤보가 롱노트 틱으로 늘었으면 true (크게 튀지 않게 함) */
  comboQuiet: boolean;
  negativePercent: number;
  feverGaugePercent: number;
  feverActive: boolean;
  feverRemainingMs: number;
  /** 곡 진행 막대 (0~1) */
  progress: number;
  /** 지금 시각 (ms, performance.now 기준). 콤보 팝 연출용 */
  nowMs: number;
}

export interface HudInit {
  title: string;
  bpm: number;
  difficultyLabel: string;
  /** 레일 키 안내 글자 (2키는 [왼쪽, 오른쪽], 4키는 [S, D, K, L]). null 이면 그쪽은 표시하지 않는다 */
  laneLabels: readonly (string | null)[];
  /** [10단계] 키 모드 (생략하면 2키) */
  keyMode?: 2 | 4;
  onPause: () => void;
  /** 터치 기기이면 true: 레일 바깥 키 안내 대신 왼쪽·오른쪽 탭 영역 안내를 잠깐 보여 준다 */
  touchGuide?: boolean;
}

/** 패널 버튼 한 개 */
export interface PanelButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/** 시작 준비 화면에서 고른 값 */
export interface StartChoice {
  rate: number;
  startMs: number;
  practice: boolean;
  /** [11] 화면 모양: 기존(classic) / 새 화면 10-C(v10c). 없으면 지금 설정대로 */
  screen?: 'classic' | 'v10c';
}

/** 시작 준비 화면에 보여 줄 값 */
export interface StartPanelInit {
  title: string;
  difficulty: string;
  noteCount: number;
  rate: number;
  /** 편집기에서 보던 위치(ms). 모르면 null */
  editorPositionMs: number | null;
  startMs: number;
  practice: boolean;
  /** 곡 길이(ms): 시작 위치 상한 */
  durationMs: number;
  /** [11] 지금 고른 화면 모양 */
  screen: 'classic' | 'v10c';
  warnings: string[];
  /** 08: 지금 입력 보정(ms)과 바꿀 때 부르는 함수, [싱크 맞추기]를 누를 때 부르는 함수(고른 값을 넘겨 돌아올 때 그대로 다시 보여 준다) */
  inputDelayMs: number;
  onInputDelayChange: (ms: number) => void;
  onCalibrate: (choice: StartChoice) => void;
  onStart: (choice: StartChoice) => void;
  onCancel: () => void;
}

/** 일시정지 화면에서 바꿀 수 있는 설정 */
export interface PauseSettings {
  inputDelayMs: number;
  fallTimeMs: number;
  hitSound: boolean;
  showJudgeDetail: boolean;
}

/** 결과 화면에 보여 줄 값 */
export interface ResultPanelInit {
  summary: RunSummary;
  practice: boolean;
  /** 기본값이 아닌 판정 설정을 쓴 판이면 맨 위에 작게 보일 문구 (기본값이면 null) */
  judgeNote?: string | null;
  /** MISS 한 줄을 눌렀을 때 (편집기로 돌아가 그 노트 선택) */
  onMissClick: (noteId: number) => void;
}

/** 판정 글자·콤보 묶음의 가로 폭 (px). 판정원 위에 가운데 정렬로 놓는다 */
const JUDGE_BLOCK_WIDTH = 360;

/** 번개 모양 아이콘 (이미지 파일 없이 코드로 그림) */
const BOLT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>';

/** ms → "m:ss.s" 글자 */
export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** 노트 종류 이름 (쉬운 한국어) */
const TYPE_LABELS: Record<string, string> = { tap: '단타', hold: '롱노트', burst: '연타' };

export class PlayHud {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** [11] 새 화면 10-C 전용 2D canvas (WebGL canvas 와 따로 둔다). 10-C 를 고르기 전에는 숨겨져 있다 */
  readonly canvas10c: HTMLCanvasElement;
  /** 마우스·터치 입력을 받는 투명한 층 */
  readonly inputLayer: HTMLElement;

  private readonly shape: RailShape = createRailShape();
  private readonly progressFill: HTMLElement;
  private readonly scoreValue: HTMLElement;
  private readonly feverPanel: HTMLElement;
  private readonly feverPercent: HTMLElement;
  private readonly feverFill: HTMLElement;
  private readonly feverHint: HTMLElement;
  private readonly negPercent: HTMLElement;
  private readonly negFill: HTMLElement;
  private readonly comboBox: HTMLElement;
  private readonly comboValue: HTMLElement;
  private readonly judgeText: HTMLElement;
  private readonly judgeDetail: HTMLElement;
  private readonly judgeBlock: HTMLElement;
  /** 08: 판정 상세 표시를 켰을 때 구석에 보이는 "기기 소리 지연 · 최근 판정 평균" */
  private readonly syncInfo: HTMLElement = el('div', { class: 'pl-sync-info' });
  private readonly feverFlash: HTMLElement;
  /** 피버 중 배경 위에 얹는 투명한 발광 (불투명도만 바뀐다) */
  private readonly feverGlowEl: HTMLElement = el('div', { class: 'bg-fever-glow' });
  /** 박자에 맞춰 깜빡이는 배경 빛 */
  private readonly beatGlowEl: HTMLElement = el('div', { class: 'bg-beat-glow' });
  private lastGlowKey = '';
  private lastBeatKey = '';
  private readonly feverTitle: HTMLElement;
  /** 터치 기기용 탭 영역 안내 (왼쪽·오른쪽). 터치가 아니면 null */
  private readonly tapZones: HTMLElement | null;
  private readonly scoreMult: HTMLElement;
  private readonly combo = new ComboTracker();
  private lastComboScale = 1;
  private readonly countdown: HTMLElement;
  private readonly overlay: HTMLElement;
  /** 레일 바깥 키 안내 (표시하지 않는 쪽은 null) */
  private readonly keyGuides: Array<HTMLElement | null>;
  private readonly laneCount: number;
  private readonly burstLabels: HTMLElement[] = [];
  private readonly infoDiff: HTMLElement;
  private readonly lastText = new Map<HTMLElement, string>();
  private lastNegativeKey = '';

  constructor(init: HudInit) {
    const layout = PLAY_CONFIG.layout;

    this.canvas = el('canvas', { class: 'pl-canvas', attrs: { width: String(PLAY_VIEW.width), height: String(PLAY_VIEW.height) } });
    this.canvas10c = el('canvas', { class: 'pl-canvas pl-canvas10c', attrs: { width: String(PLAY_VIEW.width), height: String(PLAY_VIEW.height) } });
    this.canvas10c.hidden = true;
    this.inputLayer = el('div', { class: 'pl-input', attrs: { 'aria-hidden': 'true' } });

    this.progressFill = el('div', { class: 'pl-progress-fill' });
    const progress = el('div', { class: 'pl-progress', attrs: { role: 'progressbar', 'aria-label': '곡 진행' } }, this.progressFill);

    // 점수 · 피버 · 부정수치 패널
    this.scoreValue = el('b', { class: 'pl-score-value', text: '0' });
    this.scoreMult = el('span', { class: 'pl-score-mult hidden', text: '×1.5' });
    const scorePanel = el('div', { class: 'pl-panel pl-score' }, el('span', { class: 'pl-label mint', text: 'SCORE' }), this.scoreValue, this.scoreMult);

    this.feverPercent = el('b', { text: '0%' });
    this.feverFill = el('div', { class: 'pl-gauge-fill mint' });
    this.feverHint = el('span', { class: 'pl-hint', text: 'PERFECT·GREAT 로 충전' });
    this.feverPanel = el(
      'div',
      { class: 'pl-panel pl-fever' },
      el('div', { class: 'pl-panel-head' }, el('span', { class: 'pl-label mint', html: `${BOLT_SVG} FEVER` }), this.feverPercent),
      el('div', { class: 'pl-gauge' }, this.feverFill),
      this.feverHint,
    );

    this.negPercent = el('b', { text: '0%' });
    this.negFill = el('div', { class: 'pl-gauge-fill pink' });
    const negPanel = el(
      'div',
      { class: 'pl-panel pl-neg' },
      el('div', { class: 'pl-panel-head' }, el('span', { class: 'pl-label pink', text: '부정수치' }), this.negPercent),
      el('div', { class: 'pl-gauge' }, this.negFill),
      el('span', { class: 'pl-hint', text: '100%가 되면 실패 · Hit 하면 줄어듦' }),
    );

    const pauseButton = el('button', { class: 'pl-pause', attrs: { type: 'button', 'aria-label': '일시정지 (Esc)', title: '일시정지 (Esc)' }, html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1"/><rect x="13.8" y="5" width="4.2" height="14" rx="1"/></svg>' });
    pauseButton.addEventListener('click', init.onPause);

    // 콤보 · 판정 글자 · 카운트다운
    this.comboValue = el('b', { class: 'pl-combo-value', text: '0' });
    this.comboBox = el('div', { class: 'pl-combo hidden' }, this.comboValue, el('span', { class: 'pl-combo-label', text: 'COMBO' }));
    this.comboBox.style.opacity = String(EFFECT_CONFIG.combo.opacity);
    this.judgeText = el('div', { class: 'pl-judge-text' });
    this.judgeDetail = el('div', { class: 'pl-judge-detail' });
    // 콤보는 판정 글자 바로 위에 맞붙여 놓는다 (같은 가로 위치)
    this.judgeBlock = el('div', { class: 'pl-judge-block' }, this.comboBox, this.judgeText, this.judgeDetail);
    this.judgeBlock.style.left = `${PLAY_CONFIG.rail.centerX - JUDGE_BLOCK_WIDTH / 2}px`;
    this.judgeBlock.style.width = `${JUDGE_BLOCK_WIDTH}px`;
    this.judgeBlock.style.bottom = `${PLAY_VIEW.height - layout.judgeBlockBottomY}px`;
    this.feverFlash = el('div', { class: 'pl-fever-flash' });
    this.feverTitle = el('div', { class: 'pl-fever-title', text: 'FEVER!' });
    this.countdown = el('div', { class: 'pl-countdown hidden' });

    // 키 안내 (판정선과 같은 높이, 레일 바깥 양옆). 판정원 그림은 Three.js 쪽(노트 아래)에서 그린다
    this.laneCount = init.keyMode === 4 ? 4 : 2;
    const guideAt = (lane: number): HTMLElement | null => {
      const label = init.laneLabels[lane];
      if (label === null || label === undefined) return null;
      const position = keyGuidePosition(this.shape, lane, PLAY_CONFIG.keyGuide.gap, PLAY_CONFIG.judgeCircle.radius, this.laneCount);
      const guide = el('div', { class: `pl-keyguide lane${lane}${this.laneCount === 4 ? ' k4' : ''}`, text: label });
      guide.style.left = `${position.x}px`;
      guide.style.top = `${position.y}px`;
      guide.style.fontSize = `${PLAY_CONFIG.keyGuide.fontPx}px`;
      guide.style.opacity = String(PLAY_CONFIG.keyGuide.opacity);
      // 왼쪽 레인은 글자의 오른쪽 끝을, 오른쪽 레인은 왼쪽 끝을 기준으로 놓는다
      guide.style.transform = position.anchor === 'end' ? 'translate(-100%, -50%)' : position.anchor === 'center' ? 'translate(-50%, -50%)' : 'translate(0, -50%)';
      return guide;
    };
    this.keyGuides = Array.from({ length: this.laneCount }, (_, lane) => guideAt(lane));

    // 곡 정보 (BPM · 곡 이름 · 난이도)
    this.infoDiff = el('span', { class: 'pl-info-diff', text: init.difficultyLabel });
    const bpmText = Number.isFinite(init.bpm) && init.bpm > 0 ? `BPM ${Math.round(init.bpm * 10) / 10}` : 'BPM -';
    const info = el('div', { class: 'pl-info' }, el('span', { class: 'pl-info-stage', text: bpmText }), el('span', { class: 'pl-info-song', text: init.title }), this.infoDiff);

    for (let i = 0; i < PLAY_CONFIG.burstLabelPool; i += 1) {
      this.burstLabels.push(el('div', { class: 'pl-burst-label hidden' }));
    }

    this.overlay = el('div', { class: 'pl-overlay hidden' });

    // 터치 기기: 왼쪽·오른쪽 탭 영역을 반투명으로 보여 준다 (몇 초 뒤 사라짐)
    this.tapZones =
      init.touchGuide === true
        ? el(
            'div',
            { class: 'pl-tapzones', attrs: { 'aria-hidden': 'true' } },
            ...(this.laneCount === 4 ? this.fourKeyTapZones() : [el('div', { class: 'pl-tapzone lane0' }, el('b', { text: '왼쪽 탭' })), el('div', { class: 'pl-tapzone lane1' }, el('b', { text: '오른쪽 탭' }))]),
          )
        : null;

    this.root = el(
      'section',
      { class: 'play-screen' },
      el('div', { class: 'bg', attrs: { 'aria-hidden': 'true' } }, el('div', { class: 'bg-rings' }), el('div', { class: 'bg-stripes' }), this.beatGlowEl, this.feverGlowEl),
      this.canvas,
      this.canvas10c,
      this.inputLayer,
      ...this.keyGuides.filter((guide): guide is HTMLElement => guide !== null),
      ...this.burstLabels,
      this.judgeBlock,
      this.syncInfo,
      scorePanel,
      this.feverPanel,
      negPanel,
      pauseButton,
      info,
      progress,
      ...(this.tapZones === null ? [] : [this.tapZones]),
      this.feverFlash,
      this.feverTitle,
      this.countdown,
      this.overlay,
    );
    this.applyLayoutVars();
  }

  /** [10단계] 4키 터치 구역 안내 4칸: 실제 입력 구역(fourKeyZoneBounds)과 같은 경계로 나눈다. */
  private fourKeyTapZones(): HTMLElement[] {
    const [a, b, c] = fourKeyZoneBounds();
    const edges = [0, a, b, c, 1];
    return FOUR_KEY_LABELS.map((label, lane) => {
      const zone = el('div', { class: `pl-tapzone lane${lane} k4` }, el('b', { text: label }));
      zone.style.flex = `0 0 ${((edges[lane + 1]! - edges[lane]!) * 100).toFixed(3)}%`;
      return zone;
    });
  }

  /** [11] 화면 모양을 바꾼다. 10-C 이면 2D canvas 를 보이고 기존 WebGL canvas·HTML 점수 패널 등을 숨긴다(CSS 의 v10c 클래스). */
  setScreen(screen: 'classic' | 'v10c'): void {
    const on = screen === 'v10c';
    this.root.classList.toggle('v10c', on);
    this.root.closest('.rcw-play')?.classList.toggle('v10c', on);
    this.canvas.hidden = on;
    this.canvas10c.hidden = !on;
  }

  /** 배치 숫자(playConfig 한 곳)를 CSS 변수로 내려 준다. 스타일 시트에는 위치 숫자를 직접 쓰지 않는다. */
  private applyLayoutVars(): void {
    const layout = PLAY_CONFIG.layout;
    const style = this.root.style;
    const set = (name: string, value: number): void => style.setProperty(name, `${value}px`);
    set('--pl-w', PLAY_VIEW.width);
    set('--pl-h', PLAY_VIEW.height);
    set('--pl-margin', layout.margin);
    set('--pl-pause-size', layout.pauseSize);
    set('--pl-pause-top', layout.pauseTop);
    set('--pl-info-top', layout.infoTop);
    set('--pl-info-height', layout.infoHeight);
    set('--pl-info-left', layout.margin * 2 + layout.pauseSize);
    set('--pl-panel-top', layout.panelTop);
    set('--pl-panel-height', layout.panelHeight);
    set('--pl-panel-gap', layout.panelGap);
    set('--pl-panel-width', (PLAY_VIEW.width - layout.margin * 2 - layout.panelGap * 2) / 3);
    set('--pl-countdown-top', layout.countdownTop);
    set('--pl-fever-title-top', layout.feverTitleTop);
    set('--pl-tapzone-top', layout.tapZoneTop);
    set('--pl-tapzone-height', layout.tapZoneBottom - layout.tapZoneTop);
    style.setProperty('--pl-tapzone-ms', `${MOBILE_CONFIG.tapHintMs}ms`);
  }

  /** 글자가 바뀐 경우에만 고친다. */
  private setText(target: HTMLElement, text: string): void {
    if (this.lastText.get(target) === text) return;
    this.lastText.set(target, text);
    target.textContent = text;
  }

  /** 매 프레임 값을 반영한다. */
  update(view: HudView): void {
    this.setText(this.scoreValue, formatScore(view.score));
    // 연습 모드에서는 부정수치가 100%를 넘어도 실패하지 않으므로 표시만 100%로 맞춘다
    const negativeShown = Math.min(100, view.negativePercent);
    const negative = Math.round(negativeShown);
    this.setText(this.negPercent, `${negative}%`);
    this.negFill.style.width = `${negativeShown}%`;
    const negativeKey = negative.toString();
    if (negativeKey !== this.lastNegativeKey) {
      this.lastNegativeKey = negativeKey;
      this.negFill.style.setProperty('--neg-color', negativeGaugeColor(negativeShown, PLAY_CONFIG.negativeColor.low, PLAY_CONFIG.negativeColor.high));
    }

    const fever = Math.round(view.feverGaugePercent);
    this.feverFill.style.width = `${view.feverGaugePercent}%`;
    if (view.feverActive) {
      this.setText(this.feverPercent, `${(view.feverRemainingMs / 1000).toFixed(1)}초`);
      this.setText(this.feverHint, 'FEVER TIME! 점수 ×1.5');
    } else {
      this.setText(this.feverPercent, `${fever}%`);
      this.setText(this.feverHint, 'PERFECT·GREAT 로 충전');
    }
    this.feverPanel.classList.toggle('active', view.feverActive);

    const comboCfg = EFFECT_CONFIG.combo;
    const combo = this.combo.update(view.combo, view.nowMs, comboCfg.minShow, comboCfg.popMs, comboCfg.popPeak, view.comboQuiet);
    this.setText(this.comboValue, String(view.combo));
    this.comboBox.classList.toggle('hidden', !combo.visible);
    if (combo.scale !== this.lastComboScale) {
      this.lastComboScale = combo.scale;
      this.comboValue.style.transform = combo.scale === 1 ? '' : `scale(${combo.scale.toFixed(3)})`;
      // 반투명(레일의 노트가 가려지지 않게). 팝 순간에만 살짝 진해진다
      this.comboBox.style.opacity = comboOpacity(combo.scale, comboCfg.popPeak, comboCfg.opacity, comboCfg.popOpacity).toFixed(3);
    }
    this.scoreMult.classList.toggle('hidden', !view.feverActive);
    this.progressFill.style.transform = `scaleX(${view.progress})`;
  }

  /** 박자에 맞춘 배경 빛의 불투명도(0~1)를 정한다. 값이 거의 같으면 건드리지 않는다. */
  setBeatGlow(opacity: number): void {
    const key = opacity.toFixed(2);
    if (key === this.lastBeatKey) return;
    this.lastBeatKey = key;
    this.beatGlowEl.style.opacity = key;
  }

  /** 곡 정보의 난이도 글자를 바꾼다. */
  setDifficultyLabel(label: string): void {
    this.setText(this.infoDiff, label);
  }

  /** 키 안내를 밝게 하고 되돌린다 (눌린 동안만 밝음) */
  setLane(lane: number, down: boolean): void {
    const guide = this.keyGuides[lane];
    if (guide === null || guide === undefined) return;
    guide.classList.toggle('down', down);
    guide.style.opacity = String(down ? PLAY_CONFIG.keyGuide.pressedOpacity : PLAY_CONFIG.keyGuide.opacity);
  }

  /**
   * 판정 글자를 화면 가운데 고정 위치(콤보 바로 아래)에 띄운다. 등급별 색·크기. MISS 는 붉은 글자가 떨어진다.
   * detailMs 가 있으면(판정 표시 설정이 켜진 때) 글자 아래에 "빠름 12ms" / "느림 8ms" 를 함께 보인다.
   */
  showJudge(grade: Grade, detailMs: number | null = null): void {
    const text = this.judgeText;
    text.textContent = PLAY_CONFIG.gradeLabels[grade];
    text.style.color = PLAY_CONFIG.gradeColors[grade];
    text.style.fontSize = `${EFFECT_CONFIG.judgeFontPx[grade]}px`;
    text.classList.remove('pop', 'pop-miss');
    void text.offsetWidth; // 같은 애니메이션을 처음부터 다시 시작하려면 한 번 읽어 줘야 한다
    text.classList.add(grade === 'miss' ? 'pop-miss' : 'pop');
    const detail = this.judgeDetail;
    if (detailMs === null || grade === 'miss' || Math.abs(detailMs) < PLAY_TEST_CONFIG.detailMinMs) {
      detail.textContent = '';
      return;
    }
    detail.textContent = detailMs < 0 ? `빠름 ${Math.round(-detailMs)}ms` : `느림 ${Math.round(detailMs)}ms`;
    detail.style.color = detailMs < 0 ? '#9bd7ff' : '#ffb86b';
    detail.classList.remove('pop');
    void detail.offsetWidth;
    detail.classList.add('pop');
  }

  /** 피버가 시작되었다: 약한 플래시(flash 가 null 이면 없음)와 FEVER! 글자 */
  feverBurst(flash: { peak: number; ms: number } | null): void {
    if (flash !== null) {
      this.feverFlash.style.setProperty('--flash-peak', String(flash.peak));
      this.feverFlash.style.animationDuration = `${flash.ms}ms`;
    }
    const targets = flash === null ? [this.feverTitle] : [this.feverFlash, this.feverTitle];
    for (const target of targets) {
      target.classList.remove('go');
      void target.offsetWidth;
      target.classList.add('go');
    }
  }

  /** 배경 발광 세기(불투명도 0~1). 값이 거의 같으면 건드리지 않는다. */
  setFeverGlow(opacity: number): void {
    const key = opacity.toFixed(3);
    if (key === this.lastGlowKey) return;
    this.lastGlowKey = key;
    this.feverGlowEl.style.opacity = key;
  }

  /** 피버 중 화면 꾸밈(패널 빛남)을 켜고 끈다. */
  setFeverActive(active: boolean): void {
    this.root.classList.toggle('fever-on', active);
  }

  /** 콤보·피버 상태를 처음으로 되돌린다. */
  resetEffects(): void {
    this.combo.reset();
    this.lastComboScale = 1;
    this.comboValue.style.transform = '';
    this.comboBox.style.opacity = String(EFFECT_CONFIG.combo.opacity);
    this.setFeverActive(false);
    this.setFeverGlow(0);
    this.setBeatGlow(0);
  }

  /** 터치 기기의 탭 영역 안내를 처음부터 다시 보여 준다 (몇 초 뒤 저절로 사라진다). 터치가 아니면 아무것도 하지 않는다. */
  showTapHint(): void {
    const zones = this.tapZones;
    if (zones === null) return;
    zones.classList.remove('show');
    void zones.offsetWidth;
    zones.classList.add('show');
  }

  /** 판정 글자를 지운다. */
  clearJudge(): void {
    this.judgeText.classList.remove('pop', 'pop-miss');
    this.judgeText.textContent = '';
    this.judgeDetail.textContent = '';
  }

  /** 카운트다운 숫자를 보여 준다. 0 이면 숨긴다. */
  setCountdown(value: number): void {
    if (value <= 0) {
      this.countdown.classList.add('hidden');
      this.lastText.delete(this.countdown);
      return;
    }
    this.countdown.classList.remove('hidden');
    this.setText(this.countdown, String(value));
  }

  /** 연타 막대 위 "×n" 글자를 놓는다. remaining(noteIndex) 가 남은 횟수 */
  setBurstLabels(anchors: BurstAnchors, remaining: (noteIndex: number) => number): void {
    for (let i = 0; i < this.burstLabels.length; i += 1) {
      const label = this.burstLabels[i]!;
      if (i >= anchors.count) {
        label.classList.add('hidden');
        continue;
      }
      label.classList.remove('hidden');
      const text = `×${remaining(anchors.noteIndex[i]!)}`;
      const changed = this.lastText.has(label) && this.lastText.get(label) !== text;
      this.setText(label, text);
      if (changed) {
        // 누를 때마다 커졌다 돌아오는 팝
        label.classList.remove('pop');
        void label.offsetWidth;
        label.classList.add('pop');
      }
      label.style.left = `${anchors.x[i]!}px`;
      label.style.top = `${anchors.y[i]!}px`;
    }
  }

  /** 패널을 닫는다. */
  hideOverlay(): void {
    this.overlay.classList.add('hidden');
    this.overlay.replaceChildren();
  }

  /** 가운데 패널을 연다. */
  private showPanel(title: string, body: Array<HTMLElement | null>, buttons: PanelButton[], tone: 'mint' | 'pink' = 'mint', extraClass = ''): void {
    const row = el('div', { class: 'pl-buttons' });
    for (const item of buttons) {
      const button = el('button', { class: `btn big${item.primary === true ? '' : ' secondary'}`, text: item.label, attrs: { type: 'button' } });
      button.addEventListener('click', item.onClick);
      row.append(button);
    }
    this.overlay.replaceChildren(el('div', { class: `pl-dialog ${tone} ${extraClass}` }, el('h2', { class: 'pl-dialog-title', text: title }), ...body, row));
    this.overlay.classList.remove('hidden');
    row.querySelector('button')?.focus();
  }

  /** 불러오는 중 표시 */
  showLoading(message: string): void {
    this.overlay.replaceChildren(el('div', { class: 'pl-dialog mint' }, el('h2', { class: 'pl-dialog-title', text: '불러오는 중...' }), el('p', { class: 'pl-dialog-text', text: message })));
    this.overlay.classList.remove('hidden');
  }

  /** 불러오기 실패 */
  showError(message: string, onBack: () => void): void {
    this.showPanel('플레이를 시작할 수 없어요', [el('p', { class: 'pl-dialog-text', text: message })], [{ label: '편집기로 돌아가기', primary: true, onClick: onBack }], 'pink');
  }

  /** 토글 버튼 하나 (켜짐/꺼짐 표시) */
  private toggleButton(label: string, on: boolean, onChange: (next: boolean) => void): HTMLElement {
    const button = el('button', { class: 'pl-toggle', attrs: { type: 'button' } });
    let state = on;
    const render = (): void => {
      button.textContent = `${label} ${state ? '켜짐' : '꺼짐'}`;
      button.classList.toggle('on', state);
      button.setAttribute('aria-pressed', String(state));
    };
    render();
    button.addEventListener('click', () => {
      state = !state;
      render();
      onChange(state);
    });
    return button;
  }

  /** 시작 준비 화면: 재생 속도·시작 위치·연습 모드를 고르고 [시작] */
  showStart(init: StartPanelInit): void {
    const choice: StartChoice = { rate: init.rate, startMs: init.startMs, practice: init.practice, screen: init.screen };
    const screenRow = el('div', { class: 'pl-choice-row' });
    const screenButtons = (
      [
        ['classic', '기존 화면'],
        ['v10c', '새 화면 10-C'],
      ] as const
    ).map(([value, label]) => {
      const button = el('button', { class: 'pl-choice', text: label, attrs: { type: 'button', 'data-screen': value } });
      button.addEventListener('click', () => {
        choice.screen = value;
        for (const other of screenButtons) other.classList.toggle('on', other === button);
      });
      button.classList.toggle('on', value === init.screen);
      return button;
    });
    screenRow.append(...screenButtons);
    const rateRow = el('div', { class: 'pl-choice-row' });
    const rateButtons = PLAY_TEST_CONFIG.rates.map((rate) => {
      const button = el('button', { class: 'pl-choice', text: `${rate}배`, attrs: { type: 'button', 'data-rate': String(rate) } });
      button.addEventListener('click', () => {
        choice.rate = rate;
        for (const other of rateButtons) other.classList.toggle('on', other === button);
      });
      button.classList.toggle('on', rate === init.rate);
      return button;
    });
    rateRow.append(...rateButtons);

    const startRow = el('div', { class: 'pl-choice-row' });
    const startOptions: Array<{ label: string; ms: number; key: string }> = [{ label: '처음부터', ms: 0, key: 'start' }];
    if (init.editorPositionMs !== null && init.editorPositionMs > 500) {
      startOptions.push({ label: `편집기 위치(${formatTime(init.editorPositionMs)})부터`, ms: Math.min(init.durationMs, Math.round(init.editorPositionMs)), key: 'editor' });
    }
    const startButtons = startOptions.map((option) => {
      const button = el('button', { class: 'pl-choice', text: option.label, attrs: { type: 'button', 'data-start': option.key } });
      button.addEventListener('click', () => {
        choice.startMs = option.ms;
        for (const other of startButtons) other.classList.toggle('on', other === button);
      });
      button.classList.toggle('on', option.ms === init.startMs);
      return button;
    });
    startRow.append(...startButtons);
    // 요청이 준 시작 위치가 위 선택지에 없으면 안내 글자로 보여 준다
    const customStart = startOptions.some((option) => option.ms === init.startMs) ? null : el('p', { class: 'pl-dialog-note', text: `${formatTime(init.startMs)} 부터 시작합니다.` });

    const practiceToggle = this.toggleButton('연습 모드(실패 없음)', init.practice, (next) => {
      choice.practice = next;
    });
    const warnings = init.warnings.map((w) => el('p', { class: 'pl-dialog-note', text: w }));
    // 08: 입력 보정(ms) 숫자 칸 + [싱크 맞추기]
    const delayInput = el('input', {
      class: 'pl-sync-input',
      attrs: { type: 'number', min: String(SYNC_CONFIG.min), max: String(SYNC_CONFIG.max), step: '1', inputmode: 'numeric', 'aria-label': '입력 보정(ms)' },
    }) as HTMLInputElement;
    delayInput.value = String(init.inputDelayMs);
    delayInput.addEventListener('change', () => {
      const v = clampDelayMs(Number(delayInput.value), init.inputDelayMs);
      delayInput.value = String(v);
      init.onInputDelayChange(v);
    });
    const calibrateButton = el('button', { class: 'pl-choice', text: '싱크 맞추기', attrs: { type: 'button' } });
    calibrateButton.addEventListener('click', () => init.onCalibrate({ ...choice }));
    const syncRow = el(
      'div',
      { class: 'pl-sync-row' },
      el('span', { class: 'pl-sync-label', text: '입력 보정' }),
      el('div', { class: 'pl-sync-num' }, delayInput, el('span', { text: 'ms' })),
      calibrateButton,
    );
    const syncNote = el('p', { class: 'pl-dialog-note', text: '블루투스는 소리가 늦게 들려요. 판정이 어긋나면 [싱크 맞추기]를 해 주세요.' });
    this.showPanel(
      '게임 화면 테스트',
      [
        el('p', { class: 'pl-dialog-text', text: `${init.title} · ${init.difficulty} · 노트 ${init.noteCount}개` }),
        el('p', { class: 'pl-dialog-label', text: '화면 모양' }),
        screenRow,
        el('p', { class: 'pl-dialog-label', text: '재생 속도' }),
        rateRow,
        el('p', { class: 'pl-dialog-label', text: '시작 위치' }),
        startRow,
        customStart,
        el('div', { class: 'pl-choice-row' }, practiceToggle),
        syncRow,
        syncNote,
        volumeControls(playVolume, 'overlay', '볼륨 (게임 화면 테스트)'),
        judgeSettingsPanel(playJudge, { timingNote: '바꾼 판정 설정은 [시작]을 누르면 이번 판부터 적용돼요. 플레이 도중에는 공정한 판정을 위해 바꿀 수 없어요.' }),
        ...warnings,
      ],
      [
        { label: '시작', primary: true, onClick: () => init.onStart({ ...choice }) },
        { label: '편집기로 돌아가기', onClick: init.onCancel },
      ],
      'mint',
      'pl-start',
    );
  }

  /** 08: [싱크 맞추기] 진행 화면. 돌려주는 함수에 지금까지 박에 붙은 누름 수를 넘기면 안내 글자가 바뀐다 */
  showSyncRunning(total: number, onCancel: () => void): (counted: number) => void {
    const status = el('p', { class: 'pl-dialog-text pl-sync-status', text: `0 / ${total}` });
    this.showPanel(
      '싱크 맞추기',
      [
        el('p', { class: 'pl-dialog-text', text: '박자 소리에 맞춰 화면 아무 곳이나 터치하세요. (스페이스·S·F 키도 돼요)' }),
        el('p', { class: 'pl-dialog-note', text: `${SYNC_CONFIG.bpm}BPM 박자 소리가 ${total}번 나요. 처음 ${SYNC_CONFIG.skip}번은 연습이라 계산에 쓰지 않아요.` }),
        status,
      ],
      [{ label: '취소', onClick: onCancel }],
      'mint',
      'pl-start pl-sync',
    );
    return (counted) => {
      status.textContent = `${counted} / ${total}`;
    };
  }

  /** 08: [싱크 맞추기] 결과 화면 */
  showSyncResult(result: CalibrationResult, currentMs: number, onApply: (ms: number) => void, onRetry: () => void, onCancel: () => void): void {
    const buttons: PanelButton[] = [];
    const body: Array<HTMLElement | null> = [];
    if (result.ok && result.suggestionMs !== null) {
      const s = result.suggestionMs;
      body.push(
        el('p', { class: 'pl-dialog-text', text: `제안하는 입력 보정: ${s > 0 ? '+' : ''}${s}ms` }),
        el('p', { class: 'pl-dialog-note', text: `지금 ${currentMs > 0 ? '+' : ''}${currentMs}ms · ${result.message} · 흩어짐 ${result.iqrMs}ms` }),
      );
      buttons.push({ label: '적용', primary: true, onClick: () => onApply(s) });
    } else {
      body.push(el('p', { class: 'pl-dialog-text', text: result.message }));
    }
    buttons.push({ label: '다시', onClick: onRetry }, { label: '취소', onClick: onCancel });
    this.showPanel('싱크 맞추기 결과', body, buttons, result.ok ? 'mint' : 'pink', 'pl-start pl-sync');
  }

  /** 08: 구석 작은 글자("기기 소리 지연 약 N ms · 최근 판정 평균 ±N ms"). 빈 글자면 숨긴다 */
  setSyncInfo(text: string): void {
    this.syncInfo.textContent = text;
  }

  /** 숫자 조절 한 줄 (− 값 +) */
  private stepper(label: string, unit: string, value: number, step: number, min: number, max: number, signed: boolean, onChange: (next: number) => void): HTMLElement {
    let current = value;
    const valueEl = el('b', { class: 'pl-stepper-value' });
    const render = (): void => {
      valueEl.textContent = `${signed && current > 0 ? '+' : ''}${current}${unit}`;
    };
    const change = (delta: number): void => {
      current = Math.min(max, Math.max(min, current + delta));
      render();
      onChange(current);
    };
    const minus = el('button', { class: 'pl-step-btn', text: '−', attrs: { type: 'button', 'aria-label': `${label} 줄이기` } });
    const plus = el('button', { class: 'pl-step-btn', text: '+', attrs: { type: 'button', 'aria-label': `${label} 늘리기` } });
    minus.addEventListener('click', () => change(-step));
    plus.addEventListener('click', () => change(step));
    render();
    return el('div', { class: 'pl-stepper' }, el('span', { text: label }), el('div', { class: 'pl-stepper-ctl' }, minus, valueEl, plus));
  }

  /** 일시정지 화면: 입력 지연·낙하 시간·효과음·판정 표시를 바로 바꿀 수 있다 */
  showPause(settings: PauseSettings, onChange: (patch: Partial<PauseSettings>) => void, buttons: PanelButton[], openJudge = false): void {
    const cfg = PLAY_TEST_CONFIG;
    this.showPanel(
      '일시정지',
      [
        this.stepper('입력 지연 보정', 'ms', settings.inputDelayMs, cfg.delayStepMs, cfg.delayRange.min, cfg.delayRange.max, true, (v) => onChange({ inputDelayMs: v })),
        this.stepper('낙하 시간', 'ms', settings.fallTimeMs, cfg.fallStepMs, cfg.fallRange.min, cfg.fallRange.max, false, (v) => onChange({ fallTimeMs: v })),
        el(
          'div',
          { class: 'pl-choice-row' },
          this.toggleButton('효과음', settings.hitSound, (v) => onChange({ hitSound: v })),
          this.toggleButton('빠름/느림 표시', settings.showJudgeDetail, (v) => onChange({ showJudgeDetail: v })),
        ),
        volumeControls(playVolume, 'overlay', '볼륨 (바로 적용돼요)'),
        judgeSettingsPanel(playJudge, {
          open: openJudge,
          timingNote: '판정 설정은 플레이 도중에는 바뀌지 않아요. 바꾼 값은 [처음부터 다시]를 누를 때부터 적용돼요(이어하기에는 적용되지 않아요).',
        }),
        el('p', { class: 'pl-dialog-note', text: '바꾼 값은 편집기 [테스트]와 같은 설정에 저장돼요. Esc 를 다시 누르면 이어하기예요.' }),
      ],
      buttons,
      'mint',
      'pl-pause-dialog',
    );
  }

  /** 결과 화면: 점수·판정별 개수·최대 콤보·평균 오차·MISS 목록 */
  showResult(init: ResultPanelInit, buttons: PanelButton[]): void {
    const { summary } = init;
    const counts = summary.counts;
    const countRow = (grade: Grade): HTMLElement =>
      el('div', { class: 'pl-count' }, el('span', { text: PLAY_CONFIG.gradeLabels[grade], style: { color: PLAY_CONFIG.gradeColors[grade] } }), el('b', { text: String(counts[grade] ?? 0) }));
    const mean = summary.meanErrorMs;
    const hasError = summary.earlyCount + summary.lateCount > 0;
    const meanWord = Math.abs(mean) < PLAY_TEST_CONFIG.detailMinMs ? '거의 정확' : mean < 0 ? `빠름 ${Math.round(-mean)}ms` : `느림 ${Math.round(mean)}ms`;
    const meanText = hasError ? `평균 오차 ${meanWord} (빠르게 ${summary.earlyCount}번 · 늦게 ${summary.lateCount}번)` : '평균 오차 -';

    const missBox = el('div', { class: 'pl-missbox' });
    if (summary.missList.length === 0) {
      missBox.append(el('p', { class: 'pl-dialog-note', text: 'MISS 가 하나도 없어요!' }));
    } else {
      missBox.append(el('p', { class: 'pl-dialog-label', text: `MISS ${summary.missList.length}개 (누르면 편집기에서 그 노트로 이동)` }));
      const list = el('ul', { class: 'pl-misslist' });
      const shown = summary.missList.slice(0, PLAY_TEST_CONFIG.missListShow);
      for (const miss of shown) {
        const item = el('li');
        const button = el('button', { class: 'pl-miss', attrs: { type: 'button', 'data-note-id': String(miss.noteId) } }, el('span', { text: formatTime(miss.timeMs) }), el('b', { text: TYPE_LABELS[miss.type] ?? miss.type }));
        if (miss.noteId < 0) {
          button.disabled = true;
          button.title = '이 노트는 편집기 번호를 알 수 없어 이동할 수 없어요.';
        } else {
          button.addEventListener('click', () => init.onMissClick(miss.noteId));
        }
        item.append(button);
        list.append(item);
      }
      missBox.append(list);
      if (summary.missList.length > shown.length) missBox.append(el('p', { class: 'pl-dialog-note', text: `외 ${summary.missList.length - shown.length}개` }));
    }

    const title = summary.failed ? '실패...' : init.practice ? '연습 결과' : 'CLEAR!';
    this.showPanel(
      title,
      [
        init.judgeNote ? el('p', { class: 'pl-dialog-note pl-judge-note', text: init.judgeNote }) : null,
        el(
          'div',
          { class: 'pl-result-main' },
          el('div', { class: 'pl-result-rank' }, el('span', { text: 'RANK' }), el('b', { text: summary.failed ? '-' : summary.rank })),
          el('div', { class: 'pl-result-score' }, el('span', { text: 'SCORE' }), el('b', { text: formatScore(summary.score) })),
        ),
        el('div', { class: 'pl-counts' }, countRow('perfect'), countRow('great'), countRow('good'), countRow('bad'), countRow('miss')),
        el('p', { class: 'pl-dialog-text', text: `최대 콤보 ${summary.maxCombo} · 노트 ${summary.totalNotes}개` }),
        el('p', { class: 'pl-dialog-text pl-mean', text: meanText }),
        summary.failed ? el('p', { class: 'pl-dialog-note', text: '부정수치가 100%가 되어 실패했어요. 연습 모드를 켜면 끝까지 칠 수 있어요.' }) : null,
        missBox,
      ],
      buttons,
      summary.failed ? 'pink' : 'mint',
      'pl-result',
    );
  }
}
