/**
 * 터치 편집(모바일·태블릿): 세로 편집기(#vertical)에 손가락 조작을 더한다.
 *  - 탭: 선택한 도구로 놓기(단타) / 선택·선택 해제 / 붙여넣기 확정 / 지우개로 지우기
 *  - 한 손가락 드래그: 스크롤(선택·단타·지우개 도구) / 구간 만들기(롱노트·연타 도구)
 *  - 길게 누른 뒤 끌기: 범위 선택(빈 곳) 또는 노트 옮기기(노트 위)
 *  - 두 손가락 핀치: 확대·축소(두 손가락을 같이 끌면 스크롤)
 * 마우스·키보드 동작은 원본 그대로 두고, 손가락(pointerType 'touch') 입력만 가로채서 처리한다.
 * 편집·판정 규칙(editor/js)은 고치지 않는다: 원본 VerticalEditor 의 onDown/onMove/onUp 에 같은 모양의 값을 넘겨 부르기만 한다.
 */
import { actionOnMove, distanceOf, dragScroll, pinchView, startPinch, TOUCH_CONFIG, type PinchAnchor } from './layoutLogic';

/** 원본 편집기 모듈에서 쓰는 부분(타입 검사 대상이 아니라서 필요한 모양만 적는다) */
interface EditorState {
  tool: string;
  paste: unknown;
  clip: unknown;
  selectedIds: number[];
  view: { start: number; span: number };
}
interface VerticalLike {
  canvas: HTMLCanvasElement;
  h: number;
  drag: unknown;
  onDown(e: unknown): void;
  onMove(e: unknown): void;
  onUp(e: unknown): void | Promise<void>;
  hitTest(x: number, y: number): { note: { id: number } } | null;
  clampView(): void;
  stopAutoScroll(): void;
}
interface EditorModules {
  S: EditorState;
  on(name: string, fn: () => void): void;
  emit(name: string): void;
  select(id: number): void;
  actions: {
    A: { vertical: VerticalLike | null };
    copySelected(): void;
    cutSelected(): void;
    startPaste(flip?: boolean): void;
    cancelPaste(): boolean;
    deleteSelected(): void;
    undoAction(): void;
    redoAction(): void;
    selectAll(): void;
    clearSelection(): void;
  };
}

/** 손가락 하나의 기록 */
interface Finger {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
}

type Phase = 'idle' | 'pending' | 'scroll' | 'vdrag' | 'pinch' | 'after-pinch';

/** 손가락 조작 상태를 점검 화면에서 읽을 수 있게 내놓는 모양 */
export interface TouchEditHandle {
  /** 지우개 모드 켜짐 여부 */
  eraser(): boolean;
  /** 지금 손가락 조작 단계 */
  phase(): string;
}

/** 편집기 모듈을 불러온다(편집기 시작 뒤에 호출해야 같은 상태 객체를 공유한다) */
async function loadEditor(): Promise<EditorModules> {
  // @ts-ignore 편집기 JS(타입 검사 제외)
  const state = await import('../../editor/js/state.js');
  // @ts-ignore 편집기 JS(타입 검사 제외)
  const actions = await import('../../editor/js/actions.js');
  return { S: state.S, on: state.on, emit: state.emit, select: state.select, actions };
}

/** 터치 편집을 붙인다. 세로 편집기가 아직 없으면 잠시 기다린다. */
export async function initTouchEdit(isTouchLayout: () => boolean): Promise<TouchEditHandle> {
  const ed = await loadEditor();
  const { S, actions } = ed;
  const canvas = document.getElementById('vertical') as HTMLCanvasElement | null;
  const handle: TouchEditHandle = { eraser: () => false, phase: () => 'idle' };
  if (!canvas) return handle;

  const vertical = (): VerticalLike | null => actions.A.vertical;
  const fingers = new Map<number, Finger>();
  let phase: Phase = 'idle';
  let eraser = false;
  let longTimer = 0;
  let scrollStart = 0;
  let anchor: PinchAnchor | null = null;

  handle.eraser = () => eraser;
  handle.phase = () => phase;

  // ------------------------------------------------------------ 지우개 버튼 + 선택 막대 만들기
  const toolsSeg = document.querySelector<HTMLElement>('#tools .seg');
  const eraserBtn = document.createElement('button');
  eraserBtn.type = 'button';
  eraserBtn.className = 'tool-erase';
  eraserBtn.textContent = '지우개';
  eraserBtn.title = '지우개: 노트를 탭하면 지웁니다 (되돌리기로 복원)';
  eraserBtn.setAttribute('aria-pressed', 'false');
  toolsSeg?.append(eraserBtn);
  const setEraser = (on: boolean): void => {
    eraser = on;
    eraserBtn.classList.toggle('active', on);
    eraserBtn.setAttribute('aria-pressed', String(on));
    if (on) for (const b of document.querySelectorAll('#tools .tool')) b.classList.remove('active');
    else {
      const current = document.querySelector(`#tools .tool[data-tool="${S.tool}"]`);
      current?.classList.add('active');
    }
  };
  eraserBtn.addEventListener('click', () => {
    if (eraser) {
      setEraser(false);
      return;
    }
    // 선택 도구로 바꾼 뒤 지우개 표시를 켠다(스크롤 등 나머지 동작은 선택 도구와 같다)
    document.querySelector<HTMLElement>('#tools .tool[data-tool="select"]')?.click();
    setEraser(true);
  });
  for (const b of document.querySelectorAll<HTMLElement>('#tools .tool')) b.addEventListener('click', () => setEraser(false));

  // 04b: 선택 막대 버튼 id 는 tb 로 시작한다(검사 카드의 선택 패널이 selCopy·selDelete 등 같은 id 를 이미 쓰고, 원본 배치 복원으로 그 카드가 DOM 에서 먼저 나오기 때문)
  const selBar = document.getElementById('selBar');
  const buttons: { label: string; title: string; run: () => void; danger?: boolean; id: string }[] = [
    { id: 'tbCopy', label: '복사', title: '선택한 노트를 복사 (Ctrl+C)', run: () => actions.copySelected() },
    { id: 'tbPaste', label: '붙여넣기', title: '붙일 위치를 손가락으로 끌어 놓고 떼세요 (Ctrl+V)', run: () => actions.startPaste(false) },
    { id: 'tbPasteFlip', label: '반전 붙여넣기', title: '좌우를 뒤집어 붙이기 (Shift+Ctrl+V)', run: () => actions.startPaste(true) },
    { id: 'tbDelete', label: '삭제', title: '선택한 노트 삭제 (Delete)', run: () => actions.deleteSelected(), danger: true },
    { id: 'tbUndo', label: '되돌리기', title: '되돌리기 (Ctrl+Z)', run: () => actions.undoAction() },
    { id: 'tbCut', label: '잘라내기', title: '선택한 노트를 잘라내기 (Ctrl+X)', run: () => actions.cutSelected() },
    { id: 'tbAll', label: '전체 선택', title: '모든 노트 선택 (Ctrl+A)', run: () => actions.selectAll() },
    { id: 'tbRedo', label: '다시하기', title: '다시하기 (Ctrl+Y)', run: () => actions.redoAction() },
  ];
  const info = document.createElement('span');
  info.className = 'selinfo';
  let cancelBtn: HTMLButtonElement | null = null;
  if (selBar) {
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.id = b.id;
      el.textContent = b.label;
      el.title = b.title;
      if (b.danger) el.className = 'danger';
      el.addEventListener('click', b.run);
      selBar.append(el);
    }
    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'selCancelPaste';
    cancelBtn.textContent = '붙여넣기 취소';
    cancelBtn.addEventListener('click', () => actions.cancelPaste());
    selBar.append(cancelBtn, info);
  }

  /** 선택 막대 표시를 현재 상태에 맞춘다: 노트가 선택됐거나, 복사해 둔 것이 있거나, 붙여넣는 중이면 보인다 */
  const refreshBar = (): void => {
    if (!selBar) return;
    const count = S.selectedIds.length;
    const show = isTouchLayout() && (count > 0 || !!S.clip || !!S.paste);
    selBar.hidden = !show;
    info.textContent = S.paste ? '붙일 위치에 손가락을 끌어 놓고 떼세요' : count > 0 ? `${count}개 선택` : '선택 없음';
    const has = (id: string): HTMLButtonElement | null => document.getElementById(id) as HTMLButtonElement | null;
    for (const id of ['tbCopy', 'tbCut', 'tbDelete']) {
      const b = has(id);
      if (b) b.disabled = count === 0 || !!S.paste;
    }
    const paste = has('tbPaste');
    const flip = has('tbPasteFlip');
    if (paste) paste.disabled = !S.clip;
    if (flip) flip.disabled = !S.clip;
    if (cancelBtn) cancelBtn.hidden = !S.paste;
  };
  for (const name of ['select', 'paste', 'change']) ed.on(name, refreshBar);
  window.matchMedia('(max-width: 1023px)').addEventListener('change', refreshBar);
  refreshBar();

  // ------------------------------------------------------------ 손가락 조작
  /** 원본 VerticalEditor 가 받는 모양의 가짜 이벤트(마우스 왼쪽 버튼 + 캔버스 안 좌표) */
  const fake = (f: Finger, id: number): Record<string, unknown> => ({ button: 0, pointerId: id, offsetX: f.x, offsetY: f.y, shiftKey: false, pointerType: 'mouse' });

  const localPoint = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clearLong = (): void => {
    window.clearTimeout(longTimer);
    longTimer = 0;
  };

  /** 지금 하던 원본 드래그(구간 만들기·범위 선택 등)를 저장 없이 버린다 */
  const abortVerticalDrag = (): void => {
    const v = vertical();
    if (!v) return;
    v.drag = null;
    v.stopAutoScroll?.();
  };

  /** 두 손가락 거리·가운데 */
  const pair = (): { a: Finger; b: Finger; dist: number; midY: number } | null => {
    const list = [...fingers.values()];
    if (list.length < 2) return null;
    const a = list[0]!;
    const b = list[1]!;
    return { a, b, dist: distanceOf(a, b), midY: (a.y + b.y) / 2 };
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const v = vertical();
    if (!v) return;
    const p = localPoint(e);
    fingers.set(e.pointerId, { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 이미 잡혀 있음 */
    }
    if (fingers.size >= 2) {
      // 두 번째 손가락: 하던 한 손가락 조작을 버리고 핀치로 바꾼다
      clearLong();
      if (phase === 'vdrag') abortVerticalDrag();
      const pr = pair();
      if (pr) anchor = startPinch(S.view, pr.midY, v.h, pr.dist);
      phase = 'pinch';
      return;
    }
    phase = 'pending';
    clearLong();
    // 길게 누르기: 선택 도구에서만 의미가 있다(범위 선택 / 노트 옮기기)
    if (S.tool === 'select' && !eraser && !S.paste) {
      longTimer = window.setTimeout(() => {
        const f = fingers.get(e.pointerId);
        if (!f || phase !== 'pending') return;
        if (Math.hypot(f.x - f.x0, f.y - f.y0) > TOUCH_CONFIG.tapSlopPx) return;
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(15); // 손가락으로 만진 적이 있을 때만 짧게 진동
        const vv = vertical();
        if (!vv) return;
        vv.onDown(fake({ ...f, x: f.x0, y: f.y0 }, e.pointerId));
        phase = 'vdrag';
      }, TOUCH_CONFIG.longPressMs);
    }
    if (S.paste) {
      // 붙여넣기 미리보기: 손가락 위치를 따라다닌다
      v.onMove(fake(fingers.get(e.pointerId)!, e.pointerId));
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const f = fingers.get(e.pointerId);
    if (!f) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const p = localPoint(e);
    f.x = p.x;
    f.y = p.y;
    const v = vertical();
    if (!v) return;
    if (phase === 'pinch') {
      const pr = pair();
      if (pr && anchor) {
        const next = pinchView(anchor, pr.dist, pr.midY, v.h);
        S.view.span = next.span;
        S.view.start = next.start;
        v.clampView();
        ed.emit('view');
      }
      return;
    }
    if (phase === 'pending') {
      if (Math.hypot(f.x - f.x0, f.y - f.y0) <= TOUCH_CONFIG.tapSlopPx) {
        if (S.paste) v.onMove(fake(f, e.pointerId));
        return;
      }
      clearLong();
      const action = actionOnMove(S.tool, !!S.paste);
      if (action === 'paste-preview') {
        phase = 'vdrag';
        v.onMove(fake(f, e.pointerId));
      } else if (action === 'drag-create' && !eraser) {
        v.onDown(fake({ ...f, x: f.x0, y: f.y0 }, e.pointerId));
        phase = 'vdrag';
        v.onMove(fake(f, e.pointerId));
      } else {
        phase = 'scroll';
        scrollStart = S.view.start;
      }
      return;
    }
    if (phase === 'scroll') {
      S.view.start = dragScroll(scrollStart, S.view.span, f.y - f.y0, v.h);
      v.clampView();
      ed.emit('view');
      return;
    }
    if (phase === 'vdrag') v.onMove(fake(f, e.pointerId));
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const f = fingers.get(e.pointerId);
    if (!f) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    clearLong();
    fingers.delete(e.pointerId);
    const v = vertical();
    const cancelled = e.type === 'pointercancel';
    if (phase === 'pinch') {
      phase = fingers.size === 0 ? 'idle' : 'after-pinch';
      anchor = null;
      return;
    }
    if (phase === 'after-pinch') {
      if (fingers.size === 0) phase = 'idle';
      return;
    }
    const was = phase;
    phase = fingers.size === 0 ? 'idle' : 'after-pinch';
    if (!v || cancelled) {
      if (was === 'vdrag' && v) abortVerticalDrag();
      return;
    }
    if (was === 'vdrag') {
      // 붙여넣기 미리보기 중이었다면 손을 뗀 자리에 붙인다
      if (S.paste) {
        v.onMove(fake(f, e.pointerId));
        v.onDown(fake(f, e.pointerId));
      } else void v.onUp(fake(f, e.pointerId));
      return;
    }
    if (was === 'pending') {
      // 움직이지 않고 뗐다 = 탭
      if (S.paste) {
        v.onMove(fake(f, e.pointerId));
        v.onDown(fake(f, e.pointerId));
        return;
      }
      if (eraser) {
        const hit = v.hitTest(f.x, f.y);
        if (hit) {
          ed.select(hit.note.id);
          actions.deleteSelected();
        }
        return;
      }
      // 일반 탭: 원본 클릭과 같게 처리(단타 놓기·노트 선택·빈 곳 탭으로 선택 해제·왼쪽 눈금 탭으로 재생 위치 이동)
      v.onDown(fake(f, e.pointerId));
      void v.onUp(fake(f, e.pointerId));
    }
  };

  // 캡처 단계에서 먼저 받아 원본 편집기의 마우스용 처리가 손가락 입력에 반응하지 않게 한다
  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove, { capture: true });
  canvas.addEventListener('pointerup', onUp, { capture: true });
  canvas.addEventListener('pointercancel', onUp, { capture: true });
  // 페이지가 같이 끌려가거나 두 번 탭으로 확대되지 않게(에디터 캔버스 영역에만)
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  return handle;
}
