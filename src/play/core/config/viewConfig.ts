// 화면(스테이지) 크기와 모바일 대응 계산 (한 곳). 순수 함수만 있어서 자동 테스트할 수 있다.
// 04-L: 기준 화면은 세로 720x1280 (9:16). 숫자를 다른 곳에 직접 쓰지 않고 여기서만 읽는다.

/** 화면 기준 크기. 메뉴와 플레이가 모두 이 크기를 쓴다 */
export const STAGE_VIEW = { width: 720, height: 1280 } as const;

/** 모바일 대응 수치 [임시: 사용자 확인 전 값] */
export const MOBILE_CONFIG = {
  /** 터치 기기 첫 실행 때 그래픽 기본값: 화면 픽셀 배율(devicePixelRatio) 상한 */
  touchPixelRatioCap: 2,
  /** 터치 기기 첫 실행 때 이펙트 양 기본값 */
  touchEffectLevel: 'normal',
  /** PC 에서 쓰는 화면 픽셀 배율 상한 (고해상도 모니터에서 과하게 커지지 않게) */
  desktopPixelRatioCap: 1.5,
  /** 안내 문구(탭 영역)가 보이는 시간 (ms) */
  tapHintMs: 4500,
  /** 터치 최소 크기 (CSS px). 이보다 작은 버튼을 만들지 않는다 */
  minTouchPx: 44,
} as const;

/** 창 안에서 스테이지를 놓는 방법 */
export interface StageFit {
  /** 스테이지 한 칸이 화면 몇 px 인지 (CSS px) */
  scale: number;
  /** 스테이지 왼쪽 위 모서리의 창 안 위치 (CSS px) */
  left: number;
  top: number;
}

/** 창 크기에 맞춰 스테이지를 비율대로 키우거나 줄이고 가운데에 놓는다. 창이 더 가로로 길면 좌우 여백, 더 세로로 길면 위아래 여백이 생긴다. */
export function fitStage(windowWidth: number, windowHeight: number, stageWidth: number = STAGE_VIEW.width, stageHeight: number = STAGE_VIEW.height): StageFit {
  if (!(windowWidth > 0) || !(windowHeight > 0)) return { scale: 1, left: 0, top: 0 };
  const scale = Math.min(windowWidth / stageWidth, windowHeight / stageHeight);
  return { scale, left: (windowWidth - stageWidth * scale) / 2, top: (windowHeight - stageHeight * scale) / 2 };
}

/** 기기 안전 영역(노치·홈 바) 값 (CSS px, 창 기준) */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * 안전 영역을 스테이지 칸 단위로 바꾼다. 스테이지가 창 가장자리에서 이미 떨어져 있으면(위아래·좌우 여백)
 * 그만큼은 안전 영역에서 빼 준다 (여백이 곧 안전 영역이라 UI 를 더 밀 필요가 없다).
 */
export function stageSafeInsets(fit: StageFit, windowWidth: number, windowHeight: number, insets: SafeInsets, stageWidth: number = STAGE_VIEW.width, stageHeight: number = STAGE_VIEW.height): SafeInsets {
  const scale = fit.scale > 0 ? fit.scale : 1;
  const rightGap = windowWidth - (fit.left + stageWidth * scale);
  const bottomGap = windowHeight - (fit.top + stageHeight * scale);
  const toStage = (insetPx: number, gapPx: number): number => Math.max(0, insetPx - Math.max(0, gapPx)) / scale;
  return {
    top: toStage(insets.top, fit.top),
    right: toStage(insets.right, rightGap),
    bottom: toStage(insets.bottom, bottomGap),
    left: toStage(insets.left, fit.left),
  };
}

/** "폰을 세로로 돌려 주세요" 안내를 보일지: 터치 기기이고 창이 가로로 더 길 때만. PC 창에서는 보이지 않는다 */
export function shouldShowRotateNotice(isTouch: boolean, windowWidth: number, windowHeight: number): boolean {
  return isTouch && windowWidth > windowHeight;
}

/** 터치 기기인지 (주 입력이 손가락이면 true). 마우스가 주 입력이면 false */
export function detectTouchDevice(win: { matchMedia?: (query: string) => { matches: boolean }; navigator?: { maxTouchPoints?: number } } = window): boolean {
  const coarse = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (coarse) return true;
  const hover = win.matchMedia?.('(hover: hover)').matches ?? true;
  return !hover && (win.navigator?.maxTouchPoints ?? 0) > 0;
}

/**
 * 플레이 화면(WebGL) 안쪽 그림 크기 배율. 화면에 실제로 보이는 크기(스테이지 칸 × 화면 배율 × 픽셀 배율)에 맞춘다.
 * 픽셀 배율은 상한(pixelRatioCap)을 넘기지 않는다. 너무 작거나 크지 않게 범위를 둔다.
 */
export function renderPixelScale(stageScale: number, devicePixelRatio: number, pixelRatioCap: number): number {
  const ratio = Math.min(Math.max(devicePixelRatio, 1), pixelRatioCap);
  const value = stageScale * ratio;
  return Math.min(1.5, Math.max(0.5, value));
}
