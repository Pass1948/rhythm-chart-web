/**
 * PC(폭 1024px 이상) 오른쪽 "채보 편집" 열 폭의 순수 계산(08단계). 화면 요소를 만지지 않으므로 Node 로 테스트한다.
 *  - 최소 380px
 *  - 최대 = 화면 폭의 65% 와 "가운데 열이 최소 420px 남는 폭" 중 작은 값 (최대가 최소보다 작아지면 최소로 고정)
 *  - 기본 폭 = 지금의 clamp(380px,28vw,520px), 1279px 이하는 clamp(300px,28vw,380px) (style.css 와 같은 값)
 */

/** 수치(한 곳) */
export const EDITOR_WIDTH_CONFIG = {
  minPx: 380,
  maxViewportRatio: 0.65,
  midMinPx: 420,
  /** 이 폭 이상일 때만 PC 배치(끌어서 조절 가능) */
  pcMinViewport: 1024,
  /** 기본 폭: 1280 이상 */
  defaultWide: { min: 380, vw: 0.28, max: 520 },
  /** 기본 폭: 1279 이하 */
  defaultNarrow: { min: 300, vw: 0.28, max: 380 },
  /** 키보드 화살표 한 번에 움직이는 폭 */
  keyStepPx: 16,
} as const;

/** 기본 폭(px): 설정이 없을 때 CSS 가 쓰는 값과 같다 */
export function defaultEditorWidth(viewportWidth: number): number {
  const d = viewportWidth >= 1280 ? EDITOR_WIDTH_CONFIG.defaultWide : EDITOR_WIDTH_CONFIG.defaultNarrow;
  return Math.min(d.max, Math.max(d.min, viewportWidth * d.vw));
}

/**
 * 오른쪽 열 폭의 허용 범위.
 * @param viewportWidth 화면(창) 폭
 * @param leftPx 왼쪽 열 폭
 * @param chromePx 열 사이 간격과 바깥 여백의 합(= 바깥 여백 2개 + 열 간격 2개)
 */
export function editorWidthRange(viewportWidth: number, leftPx: number, chromePx: number): { min: number; max: number } {
  const min = EDITOR_WIDTH_CONFIG.minPx;
  const byRatio = viewportWidth * EDITOR_WIDTH_CONFIG.maxViewportRatio;
  const byMid = viewportWidth - chromePx - leftPx - EDITOR_WIDTH_CONFIG.midMinPx;
  return { min, max: Math.max(min, Math.min(byRatio, byMid)) };
}

/** 폭을 허용 범위 안의 정수로 맞춘다. 숫자가 아니면 null (= 기본 폭을 쓴다) */
export function clampEditorWidth(width: number, viewportWidth: number, leftPx: number, chromePx: number): number | null {
  if (!Number.isFinite(width)) return null;
  const r = editorWidthRange(viewportWidth, leftPx, chromePx);
  return Math.round(Math.max(r.min, Math.min(r.max, width)));
}

/**
 * 끌기 중 포인터 x 좌표로 새 폭을 구한다. 오른쪽 열의 오른쪽 끝(rightEdge)은 움직이지 않고,
 * 가운데 열과 오른쪽 열 사이 간격(gapPx)의 한가운데가 포인터를 따라간다.
 */
export function widthFromPointer(pointerX: number, rightEdge: number, gapPx: number): number {
  return rightEdge - pointerX - gapPx / 2;
}
