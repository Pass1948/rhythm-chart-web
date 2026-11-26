/**
 * 반응형 배치의 순수 계산(화면 요소를 만지지 않는 함수만). 자동 테스트(test\layout.test.ts)가 이 파일을 직접 검사한다.
 * 기준값은 계약 7번(04b 단일 기준): 폭 1024px 이상이면 PC 배치(맨 위 곡 등록 줄 + 3열), 그보다 좁으면 하단 탭 바.
 * 아래 질의문(TAB_QUERY)은 layout.css 의 미디어 쿼리와 같은 글자여야 한다(CSS 와 자바스크립트가 같은 판단을 하도록).
 */
import { fitStage, STAGE_VIEW, type StageFit } from '../../play/core/config/viewConfig';

/** 화면 크기 기준 숫자(한 곳) */
export const BREAKPOINTS = { sm: 640, pc: 1024, landscapeMaxWidth: 1023, shortHeight: 500 } as const;

/**
 * 좁은 화면(탭 배치)의 탭별 카드(07, 00 공통규칙 6절). 실제 표시는 index.html 의 카드 `data-tab` 와 layout.css 가 하고,
 * 배치 검사(test\layoutSkeletonCheck.mjs)가 화면의 실제 구성이 이 표와 같은지 확인한다. 같은 탭 안의 순서는 화면 위→아래 순서다.
 * [플레이] 탭은 화면을 바꾸지 않고 게임 화면 테스트를 연다.
 */
export const TAB_CARDS = {
  song: ['dropBar', 'cardSong'],
  analyze: ['cardAnalyze', 'cardAudio', 'cardTempo', 'cardGen'],
  edit: ['cardEdit'],
  inspect: ['rightCol'],
} as const;

/** 탭 배치로 바뀌는 조건(CSS 미디어 쿼리와 같은 질의문) */
export const TAB_QUERY = '(max-width: 1023px)';

/** mobile / tablet 은 모두 하단 탭 배치(카드 구성은 같고, 폰 가로·세로 구분은 플레이 화면 배치용), pc 는 맨 위 곡 등록 줄 + 3열 배치 */
export type LayoutMode = 'mobile' | 'tablet' | 'pc';

/** 창 크기로 편집기 배치 종류를 정한다 */
export function layoutModeOf(width: number, height: number): LayoutMode {
  if (width < BREAKPOINTS.sm) return 'mobile';
  if (width < BREAKPOINTS.pc) return height < BREAKPOINTS.shortHeight ? 'mobile' : 'tablet';
  return 'pc';
}

/** 가로로 돌린 폰인지(높이가 낮고 폭은 1024 미만) */
export function isPhoneLandscape(width: number, height: number): boolean {
  return height < BREAKPOINTS.shortHeight && width <= BREAKPOINTS.landscapeMaxWidth;
}

// ---------------------------------------------------------------- 세로 편집기 손가락 조작 계산

/** 세로 편집기가 보는 구간 */
export interface ViewSpan {
  start: number;
  span: number;
}

/** 보는 구간의 길이 한계(ms). 마우스 휠 확대(vertical.js)와 같은 값 */
export const VIEW_SPAN_LIMITS = { min: 1500, max: 40000 } as const;

/** 위·아래 여백(vertical.js 의 PAD_TOP + PAD_BOTTOM) */
export const VERTICAL_PADDING = 14 + 22;

/** 구간 길이를 한계 안으로 */
export function clampSpan(span: number): number {
  return Math.max(VIEW_SPAN_LIMITS.min, Math.min(VIEW_SPAN_LIMITS.max, span));
}

/**
 * 한 손가락으로 끌어 스크롤: 손가락 밑의 곡 시각이 그대로 손가락 밑에 남도록 시작 시각을 옮긴다.
 * 손가락을 아래로 끌면(dy>0) 더 나중(위쪽) 구간이 보인다.
 */
export function dragScroll(startAtDown: number, span: number, dy: number, canvasHeight: number): number {
  const plot = Math.max(1, canvasHeight - VERTICAL_PADDING);
  return startAtDown + (dy / plot) * span;
}

/** 두 손가락 한 쌍의 상태 */
export interface PinchAnchor {
  /** 시작할 때 두 손가락 가운데 점 밑의 곡 시각(ms) */
  anchorMs: number;
  /** 시작할 때 구간 길이 */
  spanStart: number;
  /** 시작할 때 두 손가락 사이 거리(px) */
  distStart: number;
}

/** 핀치를 시작할 때의 기준을 잡는다 */
export function startPinch(view: ViewSpan, midY: number, canvasHeight: number, dist: number): PinchAnchor {
  const t = verticalFraction(midY, canvasHeight);
  return { anchorMs: view.start + t * view.span, spanStart: view.span, distStart: Math.max(1, dist) };
}

/** 화면 y 위치가 캔버스 아래(0)에서 위(1) 사이 어디인지 */
export function verticalFraction(y: number, canvasHeight: number): number {
  const plot = Math.max(1, canvasHeight - VERTICAL_PADDING);
  return (canvasHeight - 22 - y) / plot;
}

/**
 * 핀치 중인 구간: 손가락 사이가 벌어지면(dist 커짐) 구간이 짧아져 확대되고, 모이면 길어져 축소된다.
 * 가운데 점이 같은 곡 시각을 계속 가리키도록 시작 시각을 맞춘다(두 손가락으로 같이 끌면 스크롤도 된다).
 */
export function pinchView(anchor: PinchAnchor, dist: number, midY: number, canvasHeight: number): ViewSpan {
  const span = clampSpan(anchor.spanStart * (anchor.distStart / Math.max(1, dist)));
  const t = verticalFraction(midY, canvasHeight);
  return { span, start: anchor.anchorMs - t * span };
}

/** 두 점 사이 거리 */
export function distanceOf(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 손가락 조작 기준값(한 곳) */
export const TOUCH_CONFIG = {
  /** 이 거리(px) 안에서 떼면 '탭'으로 본다 */
  tapSlopPx: 10,
  /** 이 시간(ms) 이상 움직이지 않고 누르면 '길게 누르기' */
  longPressMs: 420,
} as const;

/** 한 손가락 조작 종류 */
export type OneFingerAction = 'scroll' | 'drag-create' | 'paste-preview';

/** 손가락이 기준 거리 넘게 움직였을 때 도구에 따라 무엇을 할지 */
export function actionOnMove(tool: string, pasting: boolean): OneFingerAction {
  if (pasting) return 'paste-preview';
  return tool === 'hold' || tool === 'burst' ? 'drag-create' : 'scroll';
}

// ---------------------------------------------------------------- 플레이 화면 배치

/** 안전 영역(노치·홈 바) 여백(px) */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type PlayLayoutMode = 'pc' | 'tablet' | 'phone' | 'phone-landscape';

/** 플레이 화면 배치 결과 */
export interface PlayLayoutResult {
  mode: PlayLayoutMode;
  /** 무대(720x1280)를 놓는 방법 (창 왼쪽 위 기준 px) */
  fit: StageFit;
  /** 무대 폭·높이(px) */
  stageWidth: number;
  stageHeight: number;
  /** PC 에서 무대 양옆 정보 패널 폭(px), 아니면 0 */
  sidePanelWidth: number;
  /** 태블릿에서 아래 얇은 HUD 높이(px), 아니면 0 */
  bottomBarHeight: number;
}

/** 플레이 화면 수치(한 곳) */
export const PLAY_LAYOUT_CONFIG = {
  /** 태블릿 아래 얇은 HUD 높이 */
  bottomBarPx: 44,
  /** PC 양옆 패널 최소 폭: 이보다 좁으면 패널을 만들지 않는다 */
  minSidePanelPx: 180,
  /** PC 양옆 패널 최대 폭 */
  maxSidePanelPx: 360,
  /** 패널과 무대 사이 간격 */
  panelGapPx: 16,
} as const;

/** 창 크기와 안전 영역으로 플레이 화면 배치를 정한다. 무대는 항상 세로 720x1280 비율을 지킨다. */
export function computePlayLayout(width: number, height: number, insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }): PlayLayoutResult {
  const cfg = PLAY_LAYOUT_CONFIG;
  const mode: PlayLayoutMode = isPhoneLandscape(width, height) ? 'phone-landscape' : width >= BREAKPOINTS.pc ? 'pc' : width >= BREAKPOINTS.sm ? 'tablet' : 'phone';
  const areaW = Math.max(1, width - insets.left - insets.right);
  const bottomBarHeight = mode === 'tablet' ? cfg.bottomBarPx : 0;
  const areaH = Math.max(1, height - insets.top - insets.bottom - bottomBarHeight);
  const base = fitStage(areaW, areaH);
  const fit: StageFit = { scale: base.scale, left: base.left + insets.left, top: base.top + insets.top };
  const stageWidth = STAGE_VIEW.width * base.scale;
  const stageHeight = STAGE_VIEW.height * base.scale;
  let sidePanelWidth = 0;
  if (mode === 'pc') {
    const gap = (width - stageWidth) / 2 - cfg.panelGapPx * 2;
    sidePanelWidth = gap >= cfg.minSidePanelPx ? Math.min(cfg.maxSidePanelPx, Math.floor(gap)) : 0;
  }
  return { mode, fit, stageWidth, stageHeight, sidePanelWidth, bottomBarHeight };
}
