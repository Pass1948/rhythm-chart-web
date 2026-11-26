import {afterEach, describe, expect, it} from 'vitest';
import {newChart,validateChart} from '../src/core/index.ts';
import {sanitizeAppSettings} from '../src/storage/settingsStore.ts';
// @ts-expect-error 편집기 JS
import {setKeyMode,tryAdd,tryUpdate} from '../src/editor/js/edit_rules.js';
afterEach(()=>setKeyMode(2));
describe('편집·검사 규칙 (4키)', () => {
  it('편집: 롱노트 유지 + 새 노트 2개(합 3)는 거절, 같은 손 두 레인 동시는 막지 않는다', () => {
    setKeyMode(4);
    const hold = { id: 1, type: 'hold', lane: 0, tick: 0, length_tick: 3840 };
    const r = tryAdd([hold, { id: 2, type: 'tap', lane: 2, tick: 960 }], { type: 'tap', lane: 3, tick: 960 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2개');
    expect(tryAdd([{ id: 1, type: 'tap', lane: 0, tick: 960 }], { type: 'tap', lane: 1, tick: 960 }).ok).toBe(true);
    expect(tryUpdate([hold, { id: 2, type: 'tap', lane: 2, tick: 960 }, { id: 3, type: 'tap', lane: 3, tick: 1920 }], 3, { tick: 960 }).ok).toBe(false);
  });
  it('검사: 같은 손 동시는 경고(same_hand_at_once), 롱노트 유지 + 2개는 오류', () => {
    const c = newChart('t', '', 'a.wav', 600000);
    c.keyMode = 4;
    c.lanes = 4;
    c.difficulties = [{ name: 'HARD', level: 0, notes: [{ id: 1, type: 'tap', lane: 0, tick: 960 }, { id: 2, type: 'tap', lane: 1, tick: 960 }] }];
    const v = validateChart(c);
    expect(v.errors).toBe(1);
    expect(v.issues.some((i) => i.code === 'same_hand_at_once' && i.level === 'error')).toBe(true);
    c.difficulties[0]!.notes = [{ id: 1, type: 'hold', lane: 0, tick: 0, length_tick: 3840 }, { id: 2, type: 'tap', lane: 2, tick: 960 }, { id: 3, type: 'tap', lane: 3, tick: 960 }];
    expect(validateChart(c).issues.some((i) => i.code === 'too_many_held')).toBe(true);
  });
  it('기기 설정: 4키 조절 값은 난이도별로 저장하고 범위 밖 값은 고친다', () => {
    const s = sanitizeAppSettings({ fourKeyGen: { HARD: { density: 3, simultaneous: -5 }, WRONG: { density: 1.2 } } }).settings;
    expect(s.fourKeyGen).toEqual({ HARD: { density: 1.6, simultaneous: 0 } });
    expect(sanitizeAppSettings(null).settings.fourKeyGen).toEqual({});
  });
});
