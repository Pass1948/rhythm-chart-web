/**
 * 반응형 UI 시작점(04단계): 편집기 화면이 문서에 들어간 뒤 app\main.ts 가 한 번 부른다.
 * 배치 제어(layoutController)와 터치 편집(touchEdit)을 연결하고, 점검용 읽기 도구 window.__rcwLayout 을 내놓는다.
 */
import { initLayoutController, type LayoutHandle } from './layoutController';
import { initTouchEdit, type TouchEditHandle } from './touchEdit';
import { initEditorResizer, type ResizerHandle } from './editorResizer';

/** 점검용 읽기 도구 모양 */
export interface LayoutDebug {
  layout: LayoutHandle;
  touch: TouchEditHandle | null;
  /** 08: PC 채보 편집 폭 손잡이 */
  resizer: ResizerHandle | null;
}

/** 편집기 반응형 배치와 터치 편집을 켠다 */
export async function initEditorLayout(): Promise<void> {
  const layout = initLayoutController();
  const debug: LayoutDebug = { layout, touch: null, resizer: initEditorResizer() };
  (window as unknown as { __rcwLayout?: LayoutDebug }).__rcwLayout = debug;
  debug.touch = await initTouchEdit(() => layout.isTouchLayout());
}
