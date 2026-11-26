/**
 * PC 오른쪽 "채보 편집" 열의 폭을 가운데 열과의 경계 손잡이로 끌어서 조절한다(08단계, 폭 1024px 이상만).
 *  - 끌기: 포인터 캡처로 마우스가 손잡이 밖으로 나가도 이어진다. 프레임마다 한 번만 폭을 바꿔 매끄럽게 그린다
 *    (편집 캔버스는 크기 변화를 스스로 알아채 새 폭으로 다시 그린다).
 *  - 더블클릭: 기본 폭으로 되돌린다. 키보드: 손잡이에 포커스 후 ←/→.
 *  - 정한 폭은 설정(rcw.settings.v1 의 editorWidthPx)에 저장해 다음에도 유지한다. 저장이 막혀 있어도 화면은 동작한다.
 * 계산은 editorWidth.ts(순수 함수).
 */
import { loadSettings, saveSettings } from '../../storage/settingsStore';
import { EDITOR_WIDTH_CONFIG, clampEditorWidth, widthFromPointer } from './editorWidth';

/** 점검용 읽기 도구 */
export interface ResizerHandle {
  /** 지금 정해 둔 폭(없으면 null = 기본 폭) */
  current(): number | null;
  /** 폭을 정한다(null 이면 기본 폭). 범위 밖이면 가까운 값으로 맞춘다 */
  setWidth(px: number | null, persist?: boolean): void;
}

export function initEditorResizer(): ResizerHandle | null {
  const cols = document.getElementById('cols');
  const left = document.getElementById('paneLeft');
  const right = document.getElementById('paneRight');
  const handle = document.getElementById('editResizer');
  if (!cols || !left || !right || !handle) return null;

  const isPc = (): boolean => window.innerWidth >= EDITOR_WIDTH_CONFIG.pcMinViewport;
  /** 열 사이 간격(px)과 바깥 여백(px) — CSS 변수 --card-gap 을 화면에서 읽는다 */
  const gaps = (): { gap: number; chrome: number } => {
    const cs = getComputedStyle(cols);
    const gap = parseFloat(cs.columnGap) || 12;
    const pad = parseFloat(cs.paddingLeft) || 12;
    return { gap, chrome: pad * 2 + gap * 2 };
  };
  const clampNow = (w: number): number | null => clampEditorWidth(w, window.innerWidth, left.getBoundingClientRect().width, gaps().chrome);

  let width: number | null = null;

  /** 손잡이를 가운데·오른쪽 열 사이 간격 한가운데에 놓는다 */
  const placeHandle = (): void => {
    if (!isPc()) return;
    const c = cols.getBoundingClientRect();
    const r = right.getBoundingClientRect();
    handle.style.left = `${r.left - c.left - gaps().gap / 2}px`;
  };

  /** 화면에 실제로 쓰는 폭: 정해 둔 폭을 지금 창 크기의 허용 범위로 맞춘 값(저장된 값은 그대로 둔다) */
  const apply = (): void => {
    const eff = width === null ? null : clampNow(width);
    if (isPc() && eff !== null) cols.style.setProperty('--editor-w', `${eff}px`);
    else cols.style.removeProperty('--editor-w');
    placeHandle();
  };

  const persist = (): void => {
    try {
      saveSettings({ editorWidthPx: width });
    } catch {
      /* 저장소가 막혀 있어도 화면은 동작한다 */
    }
  };

  const setWidth = (px: number | null, save = true): void => {
    width = px === null ? null : clampNow(px);
    apply();
    if (save) persist();
  };

  // 저장된 폭을 읽는다
  try {
    const saved = loadSettings().editorWidthPx;
    if (typeof saved === 'number') width = saved;
  } catch {
    width = null;
  }
  apply();

  // ---- 끌기
  let dragging = false;
  let pendingX = 0;
  let frame = 0;
  const flush = (): void => {
    frame = 0;
    if (!dragging) return;
    const edge = right.getBoundingClientRect().right;
    setWidth(widthFromPointer(pendingX, edge, gaps().gap), false);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (!isPc() || e.button > 0) return;
    dragging = true;
    pendingX = e.clientX;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pendingX = e.clientX;
    if (frame === 0) frame = requestAnimationFrame(flush);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    pendingX = e.clientX;
    flush();
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
      /* 이미 풀렸으면 무시 */
    }
    persist();
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // ---- 더블클릭: 기본 폭
  handle.addEventListener('dblclick', () => setWidth(null));

  // ---- 키보드: ←(넓게) →(좁게)
  handle.addEventListener('keydown', (e) => {
    if (!isPc() || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const now = width ?? right.getBoundingClientRect().width;
    setWidth(now + (e.key === 'ArrowLeft' ? 1 : -1) * EDITOR_WIDTH_CONFIG.keyStepPx);
    e.preventDefault();
  });

  // ---- 창 크기가 바뀌면 범위 안으로 다시 맞춘다
  window.addEventListener('resize', apply);
  new ResizeObserver(placeHandle).observe(cols);

  return { current: () => width, setWidth };
}
