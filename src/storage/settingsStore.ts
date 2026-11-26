/**
 * 사용자 설정(settingsStore): localStorage 키 `rcw.settings.v1` 한 곳. 편집기 [테스트]와 플레이 화면이 같은 값을 쓴다.
 * 계약 5번의 모양 {inputDelayMs, keys:{left,right}, fallTimeMs, hitSound, showJudgeDetail, theme} 에
 * 음악 볼륨 `musicVolume`(0~100)을 호환 추가했다(원본 테스트 팝업이 이 값을 저장했기 때문).
 * 04b: 게임 화면 테스트 전용 항목 `sfxVolume`(효과음 볼륨, 기본 80)과 `playJudge`(판정 폭·점수 비율, 기본 원본 값)를 호환 추가했다.
 * 화면 모드 기본값은 화이트(원본 동작).
 */
import { defaultPlayJudge, sanitizePlayJudge, type PlayJudgeOptions } from '../play/playOptions.ts';
import { sanitizeGenOverrides, type GenOverrides } from '../generate/ruleFields.ts';

export const SETTINGS_KEY = 'rcw.settings.v1';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  /** 입력 지연 보정(ms). 판정할 때 누른 시각에서 뺀다 (−300~300) */
  inputDelayMs: number;
  /** 키 설정(event.code) */
  keys: { left: string; right: string };
  /** 노트가 판정선까지 내려오는 시간(ms, 500~2000) */
  fallTimeMs: number;
  /** 히트 사운드 */
  hitSound: boolean;
  /** 판정 때 빠름/느림 ms 표시 */
  showJudgeDetail: boolean;
  /** 화면 모드 */
  theme: ThemeMode;
  /** 테스트 음악 볼륨(0~100) — 계약에 더한 항목 */
  musicVolume: number;
  /** [04b] 게임 화면 테스트 효과음 볼륨(0~100, 기본 80) */
  sfxVolume: number;
  /** [04b] 게임 화면 테스트 판정 설정(기본 원본 값). 편집기 [테스트]·채보 파일·내보내기에는 쓰이지 않는다 */
  playJudge: PlayJudgeOptions;
  /** [04d] 편집 화면 노트 모양: 동그라미(circle) / 가로 막대(bar). 편집 화면에서만 쓰이고 채보 데이터·테스트·플레이에는 영향 없음 */
  editNoteShape: 'circle' | 'bar';
  /** [04e] 편집 화면 오른쪽 파형 띠 켜기. null 이면 기기에 맞춰(PC 켬, 폰 끔) 정한다. 옛 showFreq(04d) 값이 있으면 이어받는다 */
  showWave: boolean | null;
  /** [08] PC 오른쪽 채보 편집 열 폭(px). null 이면 기본 폭. 범위 안으로 맞추는 일은 화면(ui/layout/editorWidth.ts)이 한다 */
  editorWidthPx: number | null;
  /** [11] 게임 화면 모양: 기존(Three.js, classic) / 새 화면 10-C(v10c). 기본은 기존 화면 */
  playScreen: 'classic' | 'v10c';
  /** [11] 새 화면 10-C의 노트 속도(낙하 시간, ms, 500~2000, 기본 1400). 기존 화면의 fallTimeMs 와 따로 보관한다 */
  fallTimeMs10c: number;
  /** [13] 4키 생성 조절 값(난이도별, 사용자가 바꾼 것만). 없으면 config\presets.json four_key 의 난이도 기본값 */
  fourKeyGen: Record<string, { density?: number; simultaneous?: number }>;
  /** [14] 노트 생성 조절 칸: 디자인 모드·난이도별로 사용자가 규칙 기본값에서 바꾼 값만 (공통 칸 + [고급 규칙]) */
  genOverrides: GenOverrides;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  inputDelayMs: 0,
  keys: { left: 'KeyS', right: 'KeyF' },
  fallTimeMs: 1800,
  hitSound: true,
  showJudgeDetail: true,
  theme: 'light',
  musicVolume: 80,
  sfxVolume: 80,
  playJudge: defaultPlayJudge(),
  editNoteShape: 'circle',
  showWave: null,
  editorWidthPx: null,
  playScreen: 'classic',
  fallTimeMs10c: 1400,
  fourKeyGen: {},
  genOverrides: {},
};

/** 원본 테스트 팝업이 쓰는 설정 이름(user_settings) */
export interface UserSettingsShape {
  latency_ms: number;
  key_left: string;
  key_right: string;
  show_diff: boolean;
  lead_ms: number;
  volume: number;
}

/** 값 저장소(localStorage 모양). 테스트에서는 메모리 객체를 넣는다. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 브라우저 localStorage (막혀 있으면 null) */
function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 저장소를 못 쓸 때 이번 세션 동안만 유지하는 값 */
let sessionCopy: AppSettings | null = null;

/** 숫자를 범위 안으로 맞춘다. 숫자가 아니면 기본값 */
function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** 키로 쓸 수 없는 것: 화면 조작에 쓰는 키와 조합 키 (원본 user_settings.py 와 같다) */
const RESERVED = new Set(['Space', 'Escape', 'Enter', 'NumpadEnter', 'Tab', 'Backspace', 'CapsLock', 'ContextMenu', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
for (let i = 1; i <= 12; i++) RESERVED.add('F' + i);

/** 키를 쓸 수 없으면 이유(쉬운 한국어), 쓸 수 있으면 null */
export function keyProblem(code: unknown): string | null {
  if (typeof code !== 'string' || !code) return '키 정보를 읽지 못했습니다.';
  if (RESERVED.has(code)) return '이 키는 화면 조작에 쓰여서 지정할 수 없습니다 (Space, Esc, Enter, Tab, Ctrl/Alt/Shift, F1~F12).';
  return null;
}

function keyOk(code: unknown): code is string {
  return typeof code === 'string' && code.length > 0 && !RESERVED.has(code);
}

/** 저장된 값을 점검해 쓸 수 있는 설정으로 만든다. 이상한 값은 기본값으로 바꾸고 안내 문구를 모은다. */
export function sanitizeAppSettings(raw: unknown): { settings: AppSettings; notes: string[] } {
  const d = DEFAULT_APP_SETTINGS;
  const out: AppSettings = { ...d, keys: { ...d.keys }, playJudge: defaultPlayJudge() };
  const notes: string[] = [];
  if (!raw || typeof raw !== 'object') return { settings: out, notes: [] };
  const r = raw as Record<string, unknown>;
  if (r.inputDelayMs !== undefined) {
    const c = clampNum(r.inputDelayMs, -500, 500, d.inputDelayMs);
    if (c !== r.inputDelayMs) notes.push('입력 지연 보정은 −500~+500ms 범위만 쓸 수 있어 가까운 값으로 맞췄습니다.');
    out.inputDelayMs = c;
  }
  const keys = (r.keys ?? {}) as Record<string, unknown>;
  if (keyOk(keys.left)) out.keys.left = keys.left;
  if (keyOk(keys.right)) out.keys.right = keys.right;
  if (out.keys.left === out.keys.right) {
    out.keys = { ...d.keys };
    notes.push('왼쪽·오른쪽에 같은 키가 저장돼 있어 기본 키(S/F)로 되돌렸습니다.');
  }
  if (r.fallTimeMs !== undefined) out.fallTimeMs = clampNum(r.fallTimeMs, 500, 2000, d.fallTimeMs);
  if (typeof r.hitSound === 'boolean') out.hitSound = r.hitSound;
  if (typeof r.showJudgeDetail === 'boolean') out.showJudgeDetail = r.showJudgeDetail;
  if (r.theme === 'light' || r.theme === 'dark' || r.theme === 'system') out.theme = r.theme;
  if (r.musicVolume !== undefined) out.musicVolume = clampNum(r.musicVolume, 0, 100, d.musicVolume);
  if (r.sfxVolume !== undefined) out.sfxVolume = clampNum(r.sfxVolume, 0, 100, d.sfxVolume);
  if (r.editNoteShape === 'circle' || r.editNoteShape === 'bar') out.editNoteShape = r.editNoteShape;
  if (r.editorWidthPx === null) out.editorWidthPx = null;
  else if (typeof r.editorWidthPx === 'number' && Number.isFinite(r.editorWidthPx) && r.editorWidthPx > 0) out.editorWidthPx = Math.round(Math.min(4000, Math.max(100, r.editorWidthPx)));
  if (r.fourKeyGen && typeof r.fourKeyGen === 'object') {
    const fk: AppSettings['fourKeyGen'] = {};
    for (const [diff, v] of Object.entries(r.fourKeyGen as Record<string, unknown>)) {
      if (!['EASY', 'NORMAL', 'HARD', 'CUSTOM'].includes(diff) || !v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      const item: { density?: number; simultaneous?: number } = {};
      if (typeof o.density === 'number' && Number.isFinite(o.density)) item.density = Math.round(Math.min(1.6, Math.max(1.0, o.density)) * 100) / 100;
      if (typeof o.simultaneous === 'number' && Number.isFinite(o.simultaneous)) item.simultaneous = Math.round(Math.min(30, Math.max(0, o.simultaneous)));
      fk[diff] = item;
    }
    out.fourKeyGen = fk;
  }
  if (r.genOverrides !== undefined) out.genOverrides = sanitizeGenOverrides(r.genOverrides);
  if (r.playScreen === 'classic' || r.playScreen === 'v10c') out.playScreen = r.playScreen;
  if (r.fallTimeMs10c !== undefined) out.fallTimeMs10c = clampNum(r.fallTimeMs10c, 500, 2000, d.fallTimeMs10c);
  if (typeof r.showWave === 'boolean') out.showWave = r.showWave;
  else if (typeof r.showFreq === 'boolean') out.showWave = r.showFreq; // 04d 에서 저장한 값을 이어받는다
  if (r.playJudge !== undefined) {
    const fixed = sanitizePlayJudge(r.playJudge);
    out.playJudge = fixed.value;
    notes.push(...fixed.notes);
  }
  return { settings: out, notes };
}

/** 설정을 읽는다(없거나 깨졌으면 기본값). 저장소를 못 쓰는 환경이면 이번 세션에 바꾼 값을 돌려준다. */
export function loadSettings(storage: KeyValueStorage | null = browserStorage()): AppSettings {
  if (!storage) return sessionCopy ?? sanitizeAppSettings(null).settings;
  try {
    const text = storage.getItem(SETTINGS_KEY);
    if (text) return sanitizeAppSettings(JSON.parse(text)).settings;
  } catch {
    /* 읽기·해석에 실패하면 기본값으로 */
  }
  return sanitizeAppSettings(null).settings;
}

/** 설정을 읽고, 깨진 값을 고친 내용(안내 문구)도 함께 돌려준다. 플레이 화면이 "복구했습니다" 안내를 보일 때 쓴다. */
export function loadSettingsWithNotes(storage: KeyValueStorage | null = browserStorage()): { settings: AppSettings; notes: string[] } {
  if (!storage) return { settings: sessionCopy ?? sanitizeAppSettings(null).settings, notes: [] };
  try {
    const text = storage.getItem(SETTINGS_KEY);
    if (text) return sanitizeAppSettings(JSON.parse(text));
  } catch {
    return { settings: sanitizeAppSettings(null).settings, notes: ['저장된 설정을 읽지 못해 기본값을 썼습니다.'] };
  }
  return { settings: sanitizeAppSettings(null).settings, notes: [] };
}

/** 바꾼 항목만 합쳐 저장한다. 저장소가 막혀 있으면 이번 세션 동안만 유지한다. 합쳐진 설정과 안내를 돌려준다. */
export function saveSettings(patch: Partial<AppSettings>, storage: KeyValueStorage | null = browserStorage()): { settings: AppSettings; notes: string[] } {
  const cur = loadSettings(storage);
  const merged = { ...cur, ...patch, keys: { ...cur.keys, ...(patch.keys ?? {}) } };
  const clean = sanitizeAppSettings(merged);
  try {
    if (!storage) throw new Error('저장소 없음');
    storage.setItem(SETTINGS_KEY, JSON.stringify(clean.settings));
    sessionCopy = null;
  } catch {
    sessionCopy = clean.settings; // 저장소가 막혀 있어도 이번 세션 동안은 유지된다
  }
  return clean;
}

/** 설정 → 원본 테스트 팝업이 읽는 모양 */
export function toUserSettings(s: AppSettings): UserSettingsShape {
  return { latency_ms: s.inputDelayMs, key_left: s.keys.left, key_right: s.keys.right, show_diff: s.showJudgeDetail, lead_ms: s.fallTimeMs, volume: s.musicVolume };
}

/** 원본 테스트 팝업이 보내는 바뀐 항목 → 설정 조각 */
export function fromUserSettingsPatch(patch: Partial<UserSettingsShape>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  if (patch.latency_ms !== undefined) out.inputDelayMs = patch.latency_ms;
  if (patch.key_left !== undefined || patch.key_right !== undefined) {
    const cur = loadSettings();
    out.keys = { left: patch.key_left ?? cur.keys.left, right: patch.key_right ?? cur.keys.right };
  }
  if (patch.show_diff !== undefined) out.showJudgeDetail = patch.show_diff;
  if (patch.lead_ms !== undefined) out.fallTimeMs = patch.lead_ms;
  if (patch.volume !== undefined) out.musicVolume = patch.volume;
  return out;
}
