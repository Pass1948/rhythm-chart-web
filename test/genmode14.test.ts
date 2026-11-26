import { describe,expect,it } from 'vitest';
import {sanitizeGenOverrides} from '../src/generate/ruleFields.ts';
import {loadSettings,saveSettings,SETTINGS_KEY} from '../src/storage/settingsStore.ts';
describe('저장·불러오기·되돌리기 (이 기기 설정)', () => {
  const mem = (): { store: Record<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
    const store: Record<string, string> = {};
    return { store, getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  };
  it('모드·난이도별로 바꾼 값만 저장되고 다시 읽힌다(새로고침 뒤에도)', () => {
    const st = mem();
    st.setItem(SETTINGS_KEY, JSON.stringify({ genOverrides: { unified: { HARD: { hold_beats: 2, rules: { max_nps: 4 } } }, reference: { EASY: { density: 70 } } } }));
    const back = loadSettings(st).genOverrides;
    expect(back).toEqual({HARD:{rules:{nps:4}}});
    expect(sanitizeGenOverrides(back)).toEqual(back);
  });
  it('잘못된 값 거부와 초기화', () => {
    expect(sanitizeGenOverrides({ unified: { HARD: {rules:{max_nps:99,same_lane_gap_ms:120}}}})).toEqual({HARD:{rules:{laneGap:120}}});
    const st = mem();
    saveSettings({ genOverrides: { HARD: { density: 80 } } }, st);
    saveSettings({ genOverrides: {} }, st);
    expect(loadSettings(st).genOverrides).toEqual({});
  });
});
