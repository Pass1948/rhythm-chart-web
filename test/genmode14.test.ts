import { describe,expect,it } from 'vitest';
import {sanitizeGenOverrides} from '../src/generate/ruleFields.ts';
import {loadSettings,saveSettings} from '../src/storage/settingsStore.ts';
describe('저장·불러오기·되돌리기 (이 기기 설정)', () => {
  const mem = (): { store: Record<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
    const store: Record<string, string> = {};
    return { store, getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  };
  it('모드·난이도별로 바꾼 값만 저장되고 다시 읽힌다(새로고침 뒤에도)', () => {
    const st = mem();
    saveSettings({ genOverrides: { unified: { HARD: { hold_beats: 2, rules: { max_nps: 4 } } }, reference: { EASY: { density: 70 } } } }, st);
    const back = loadSettings(st).genOverrides;
    expect(back.unified!.HARD).toEqual({ hold_beats: 2, rules: { max_nps: 4 } });
    expect(back.reference!.EASY).toEqual({ density: 70 });
  });
  it('저장값 점검: 범위 밖 규칙·모르는 모드는 버리고, 되돌리기(빈 값)는 그 칸을 지운다', () => {
    const clean = sanitizeGenOverrides({ unified: { HARD: { rules: { max_nps: 99, same_lane_gap_ms: 120 } } }, wrong: { HARD: {} }, classic: { NORMAL: { rules: { max_nps: 3 } } } });
    expect(clean).toEqual({ unified: { HARD: { rules: { same_lane_gap_ms: 120 } } } });
    const st = mem();
    saveSettings({ genOverrides: { unified: { HARD: { hold_beats: 2 } } } }, st);
    saveSettings({ genOverrides: {} }, st);
    expect(loadSettings(st).genOverrides).toEqual({});
  });
});
