// 화면 모드(화이트 / 다크 / 컴퓨터 설정 따름) 선택과 저장. 값은 settingsStore(localStorage 키 rcw.settings.v1)의 theme 에 저장한다.
// 저장소가 막혀 있으면 그 세션 동안만 유지하고 기본은 화이트(04b: 원본 동작). 최종 적용값은 <html data-theme="light|dark"> 로 표시한다.
import { refreshTheme } from './theme.js';
import { SETTINGS_KEY, loadSettings, saveSettings } from '../../storage/settingsStore.ts';

export const THEME_KEY = SETTINGS_KEY;
const MODES = ['light', 'dark', 'system'];
let sessionMode = null; // 저장소를 못 쓸 때 이번 세션의 선택

// 저장된 모드 (없거나 이상하면 화이트)
export function readMode() {
  try {
    const v = loadSettings().theme;
    if (MODES.includes(v)) return v;
  } catch (e) {
    return sessionMode || 'light';
  }
  return sessionMode || 'light';
}

// 모드 → 실제 적용값 (system 은 컴퓨터 설정을 따른다)
export function resolveMode(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'system') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }
  return 'light';
}

let current = 'light';
const listeners = [];

// 화면에 적용하고 Canvas 색을 다시 읽는다 (그리기는 매 프레임이라 새로고침 없이 바로 바뀐다)
export function applyMode(mode) {
  current = mode;
  document.documentElement.setAttribute('data-theme', resolveMode(mode));
  refreshTheme();
  for (const f of listeners) f(mode);
}

export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  sessionMode = mode;
  try {
    saveSettings({ theme: mode });
  } catch (e) {
    /* 저장소가 막혀 있어도 이번 세션 동안은 선택이 유지된다 */
  }
  applyMode(mode);
}

export function getMode() {
  return current;
}

// 시작할 때 한 번 호출: 저장된 모드 적용, 컴퓨터 설정 변경·다른 창(메인↔테스트 팝업)의 변경을 따라간다
export function initThemeMode(onChange) {
  if (onChange) listeners.push(onChange);
  applyMode(readMode());
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (current === 'system') applyMode('system'); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  } catch (e) {
    /* matchMedia 가 없으면 컴퓨터 설정 따름은 화이트로 보인다 */
  }
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) applyMode(readMode());
  });
}
