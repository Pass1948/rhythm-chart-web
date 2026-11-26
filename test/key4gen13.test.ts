// 13단계 단위 테스트: 4키 전용 생성(모바일 양손 엄지) — 2키 불변, 밀도 배율, 동시 노트, 손 규칙, 패턴, 편집·검사 규칙
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import type { AnalysisResult } from '../src/analysis/types.ts';
import { BpmMap, newChart, validateChart } from '../src/core/index.ts';
import type { ChartNote } from '../src/core/index.ts';
import { loadPresets } from '../src/core/config.ts';
import { generateChart } from '../src/generate/index.ts';
import type { GenerateOptions, NotePlan } from '../src/generate/index.ts';
import { PATTERNS, buildFourKeyNotes, checkRules4, fourKeyConfig, handOf } from '../src/generate/lanes4.ts';
import { sanitizeAppSettings } from '../src/storage/settingsStore.ts';
// @ts-expect-error 편집기 JS 모듈(타입 선언 없음)
import { setKeyMode, tryAdd, tryUpdate } from '../src/editor/js/edit_rules.js';
import { makeSyntheticDrums } from '../tools/lib.ts';

/** 13단계 작업 전에 같은 입력으로 만든 2키 결과 (노트 목록 sha1 앞 16자리 : 노트 수) */
const BASE_2KEY: Record<string, string> = {
  classic_EASY: 'e335d3a0246ed76c:57', classic_NORMAL: '8ebd88b3337b4e9f:111', classic_HARD: '4003ceae962ea802:140',
  reference_EASY: '3a56adab38f930eb:77', reference_NORMAL: '1739148f44ee0899:170', reference_HARD: '1b137fd15d08975c:210',
  unified_EASY: '2854e90018047612:82', unified_NORMAL: 'f8ad7c18d517d9ff:118', unified_HARD: 'e7790904ddf97533:150',
};
const MODES = ['classic', 'reference', 'unified'] as const;
const DIFFS = ['EASY', 'NORMAL', 'HARD'] as const;
const FAST = 220;
const SAME_HAND = 150;

let analysis: AnalysisResult;
const bpm = new BpmMap([{ tick: 0, bpm: 120, beats_per_bar: 4, beat_unit: 4 }]);
const ms = (tick: number): number => bpm.tickToMs(tick);
const gen = (o: GenerateOptions) => generateChart(analysis, o);
const singles = (notes: ChartNote[]): ChartNote[] => notes.filter((n) => n.type !== 'burst');

beforeAll(async () => {
  const synth = makeSyntheticDrums({ bpm: 120, seconds: 60, startMs: 300 });
  analysis = { ...(await analyzeAudio(synth.samples, {})), song: '합성곡' };
});
afterEach(() => setKeyMode(2));

describe('2키 결과 불변 (세 디자인 모드)', () => {
  for (const m of MODES) {
    it(`${m}: 쉬움·보통·어려움 모두 13단계 이전과 같은 노트`, () => {
      for (const d of DIFFS) {
        const r = gen({ design_mode: m, difficulty: d });
        const h = createHash('sha1').update(JSON.stringify(r.notes)).digest('hex').slice(0, 16) + ':' + r.notes.length;
        expect(h).toBe(BASE_2KEY[`${m}_${d}`]);
      }
    });
  }
});

describe('4키 생성 (세 모드 공통 규칙)', () => {
  it('4키 밀도 배율: 보통·어려움은 세 모드 모두 2키보다 노트가 많다', () => {
    for (const m of MODES) for (const d of ['NORMAL', 'HARD']) {
      expect(gen({ design_mode: m, difficulty: d, key_mode: 4 }).notes.length).toBeGreaterThan(gen({ design_mode: m, difficulty: d }).notes.length);
    }
  });
  it('배율 칸을 올리면 노트가 늘어난다 (1.0 < 1.6)', () => {
    const lo = gen({ difficulty: 'NORMAL', key_mode: 4, four_key_density: 1.0 }).notes.length;
    const hi = gen({ difficulty: 'NORMAL', key_mode: 4, four_key_density: 1.6 }).notes.length;
    expect(hi).toBeGreaterThan(lo);
  });
  it('동시 노트 비율: 0% 이면 동시 노트 없음, 20% 이면 10% 보다 많고 목표 근처', () => {
    const count = (notes: ChartNote[]): number => {
      const m = new Map<number, number>();
      for (const n of singles(notes)) m.set(n.tick, (m.get(n.tick) ?? 0) + 1);
      return [...m.values()].filter((v) => v === 2).length;
    };
    const r0 = gen({ difficulty: 'HARD', key_mode: 4, four_key_simultaneous: 0 });
    const r10 = gen({ difficulty: 'HARD', key_mode: 4, four_key_simultaneous: 10 });
    const r20 = gen({ difficulty: 'HARD', key_mode: 4, four_key_simultaneous: 20 });
    expect(count(r0.notes)).toBe(0);
    expect(count(r20.notes)).toBeGreaterThan(count(r10.notes));
    expect(r10.messages[0]).toContain('동시 노트 목표 10%');
  });
  it('동시 노트는 최대 2개이고 항상 양손에 하나씩 (세 모드)', () => {
    for (const m of MODES) {
      const r = gen({ design_mode: m, difficulty: 'HARD', key_mode: 4, four_key_simultaneous: 25 });
      const by = new Map<number, ChartNote[]>();
      for (const n of singles(r.notes)) by.set(n.tick, [...(by.get(n.tick) ?? []), n]);
      for (const g of by.values()) {
        expect(g.length).toBeLessThanOrEqual(2);
        if (g.length === 2) expect(handOf(g[0]!.lane as number)).not.toBe(handOf(g[1]!.lane as number));
      }
    }
  });
  it('롱노트를 누르는 손에는 끝날 때까지 노트가 없고, 롱노트 유지 + 새 노트는 2개 이하', () => {
    for (const m of MODES) {
      const r = gen({ design_mode: m, difficulty: 'HARD', key_mode: 4, four_key_simultaneous: 25, ratios: m === 'classic' ? { tap: 50, hold: 40, burst: 10 } : undefined });
      const s = singles(r.notes);
      for (const h of s.filter((n) => n.type === 'hold')) {
        const end = h.tick + (h.length_tick ?? 0);
        const inside = s.filter((n) => n !== h && n.tick >= h.tick && n.tick < end);
        for (const n of inside) expect(handOf(n.lane as number)).not.toBe(handOf(h.lane as number));
        const at = new Map<number, number>();
        for (const n of inside) at.set(n.tick, (at.get(n.tick) ?? 0) + 1);
        for (const c of at.values()) expect(1 + c).toBeLessThanOrEqual(2);
      }
    }
  });
  it('빠른 연속은 손 교대, 같은 손 연속은 150ms 이상 간격 (세 모드, 어려움)', () => {
    for (const m of MODES) {
      const s = singles(gen({ design_mode: m, difficulty: 'HARD', key_mode: 4, four_key_simultaneous: 0 }).notes);
      for (let i = 1; i < s.length; i++) {
        const gap = ms(s[i]!.tick) - ms(s[i - 1]!.tick);
        if (gap > 0 && gap < FAST) expect(handOf(s[i]!.lane as number)).not.toBe(handOf(s[i - 1]!.lane as number));
      }
      for (const hand of [0, 1]) {
        const hs = s.filter((n) => handOf(n.lane as number) === hand);
        for (let i = 1; i < hs.length; i++) expect(ms(hs[i]!.tick) - ms(hs[i - 1]!.tick + (hs[i - 1]!.length_tick ?? 0))).toBeGreaterThanOrEqual(SAME_HAND - 1e-6);
      }
    }
  });
  it('좌·우 손 비율이 40~60% 안 (세 모드)', () => {
    for (const m of MODES) for (const d of DIFFS) {
      const s = singles(gen({ design_mode: m, difficulty: d, key_mode: 4 }).notes);
      const left = s.filter((n) => handOf(n.lane as number) === 0).length / s.length;
      expect(left).toBeGreaterThan(0.4);
      expect(left).toBeLessThan(0.6);
    }
  });
  it('패턴: 계단(0→1→2→3 / 3→2→1→0) 또는 양손 트릴(0↔3, 1↔2) 모양이 결과에 나온다', () => {
    const lanes = singles(gen({ difficulty: 'HARD', key_mode: 4, four_key_simultaneous: 0 }).notes).map((n) => n.lane).join('');
    const found = ['0123', '3210', '0303', '3030', '1212', '2121', '0213', '1302'].filter((p) => lanes.includes(p));
    expect(found.length).toBeGreaterThan(0);
  });
  it('같은 곡·같은 설정이면 항상 같은 결과', () => {
    for (const m of MODES) {
      const a = gen({ design_mode: m, difficulty: 'HARD', key_mode: 4 });
      const b = gen({ design_mode: m, difficulty: 'HARD', key_mode: 4 });
      expect(JSON.stringify(a.notes)).toBe(JSON.stringify(b.notes));
    }
  });
  it('세 모드 모두 4키 검증 오류 0, 연타는 4레인 전체(both)이고 구간 안에 다른 노트 없음', () => {
    for (const m of MODES) for (const d of DIFFS) {
      const r = gen({ design_mode: m, difficulty: d, key_mode: 4, allow_burst: true });
      expect(r.validation.error_count).toBe(0);
      for (const b of r.notes.filter((n) => n.type === 'burst')) {
        expect(b.lane).toBe('both');
        expect(r.notes.some((n) => n !== b && n.tick >= b.tick && n.tick < b.tick + (b.length_tick ?? 0))).toBe(false);
      }
    }
  });
  it('잘못된 조절 값은 쉬운 한국어 오류', () => {
    expect(() => gen({ key_mode: 4, four_key_density: 2.0 })).toThrow('배율');
    expect(() => gen({ key_mode: 4, four_key_simultaneous: 50 })).toThrow('동시 노트');
  });
});

describe('손 모델 배정기 (순수 함수)', () => {
  const plan = (tick: number, type = 'tap', len = 0, strength = 1): NotePlan => ({ tick, type, strength, band: 'mid', length_tick: len, min_length_tick: 240, count: 0, origin: 'music' });
  const cfg = () => ({ ...fourKeyConfig(loadPresets(), 'HARD', null, 0) });
  it('난이도 기본값은 presets.json four_key 에서 읽는다 (쉬움 ×1.15·0%, 보통 ×1.25·5%, 어려움 ×1.3·10%)', () => {
    const p = loadPresets();
    expect([fourKeyConfig(p, 'EASY', null, null).density, fourKeyConfig(p, 'EASY', null, null).simultaneousPercent]).toEqual([1.15, 0]);
    expect([fourKeyConfig(p, 'NORMAL', null, null).density, fourKeyConfig(p, 'NORMAL', null, null).simultaneousPercent]).toEqual([1.25, 5]);
    expect([fourKeyConfig(p, 'HARD', null, null).density, fourKeyConfig(p, 'HARD', null, null).simultaneousPercent]).toEqual([1.3, 10]);
    expect(fourKeyConfig(p, 'HARD', 1.5, 20).density).toBe(1.5);
  });
  it('120ms 간격의 연속은 양손이 번갈아 받는다', () => {
    const plans = Array.from({ length: 16 }, (_, i) => plan(1920 + i * 240)); // 16분 = 125ms
    const r = buildFourKeyNotes(plans, bpm, cfg(), 7);
    expect(r.specs.length).toBe(16);
    for (let i = 1; i < r.specs.length; i++) expect(handOf(r.specs[i]![2])).not.toBe(handOf(r.specs[i - 1]![2]));
  });
  it('롱노트 중에는 다른 손만 쓰고, 그 사이 새 롱노트는 단타로 바뀐다', () => {
    const plans = [plan(0, 'hold', 3840), plan(960, 'hold', 960), plan(1440), plan(1920), plan(2880), plan(4800)];
    const r = buildFourKeyNotes(plans, bpm, cfg(), 3);
    const h = r.specs.find((s) => s[0] === 0)!;
    expect(h[1]).toBe('hold');
    for (const s of r.specs.filter((x) => x[0] > 0 && x[0] < 3840)) expect(handOf(s[2])).not.toBe(handOf(h[2]));
    expect(r.specs.find((s) => s[0] === 960)![1]).toBe('tap');
    expect(r.info.hold_to_tap).toBe(1);
  });
  it('느린 구간 패턴은 계단·점프, 빠른 구간은 손 교대·트릴 묶음에서 고른다', () => {
    const slow = buildFourKeyNotes(Array.from({ length: 32 }, (_, i) => plan(i * 960)), bpm, cfg(), 11);
    const fast = buildFourKeyNotes(Array.from({ length: 64 }, (_, i) => plan(i * 240)), bpm, cfg(), 11);
    expect(slow.patterns.every((n) => !PATTERNS[n]!.fast)).toBe(true);
    expect(fast.patterns.every((n) => PATTERNS[n]!.fast)).toBe(true);
  });
  it('통합 모드 점검(checkRules4): 동시 3개·같은 손 동시를 알린다', () => {
    const notes: ChartNote[] = [
      { id: 1, type: 'tap', lane: 0, tick: 0 }, { id: 2, type: 'tap', lane: 1, tick: 0 },
      { id: 3, type: 'hold', lane: 0, tick: 1920, length_tick: 1920 }, { id: 4, type: 'tap', lane: 2, tick: 2880 }, { id: 5, type: 'tap', lane: 3, tick: 2880 },
    ];
    const p = checkRules4(notes, bpm, 3000, 0, 1e9, 0).join(' ');
    expect(p).toContain('같은 손');
    expect(p).toContain('2개를 넘습니다');
  });
});

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
    expect(v.errors).toBe(0);
    expect(v.issues.some((i) => i.code === 'same_hand_at_once' && i.level === 'warning')).toBe(true);
    c.difficulties[0]!.notes = [{ id: 1, type: 'hold', lane: 0, tick: 0, length_tick: 3840 }, { id: 2, type: 'tap', lane: 2, tick: 960 }, { id: 3, type: 'tap', lane: 3, tick: 960 }];
    expect(validateChart(c).issues.some((i) => i.code === 'too_many_held')).toBe(true);
  });
  it('기기 설정: 4키 조절 값은 난이도별로 저장하고 범위 밖 값은 고친다', () => {
    const s = sanitizeAppSettings({ fourKeyGen: { HARD: { density: 3, simultaneous: -5 }, WRONG: { density: 1.2 } } }).settings;
    expect(s.fourKeyGen).toEqual({ HARD: { density: 1.6, simultaneous: 0 } });
    expect(sanitizeAppSettings(null).settings.fourKeyGen).toEqual({});
  });
});
