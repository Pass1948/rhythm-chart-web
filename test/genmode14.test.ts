// 14단계 단위 테스트: 디자인 모드 조절 칸(A안) — 값을 안 바꾸면 결과 불변, 공통 칸·고급 규칙 덮어쓰기 반영, 범위 오류, 저장·되돌리기
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import type { AnalysisResult } from '../src/analysis/types.ts';
import { loadPresets } from '../src/core/config.ts';
import { generateChart, referenceRulesFor, resolveOptions, unifiedRulesFor } from '../src/generate/index.ts';
import type { GenerateOptions } from '../src/generate/index.ts';
import { RULE_FIELDS, applyRuleOverrides, commonDefaults, ruleValueProblem, sanitizeGenOverrides } from '../src/generate/ruleFields.ts';
import { loadSettings, saveSettings } from '../src/storage/settingsStore.ts';
import { makeSyntheticDrums } from '../tools/lib.ts';

/** 13·14단계 이전과 같은 입력으로 만든 결과 (노트 목록 sha1 앞 16자리 : 노트 수) */
const BASE: Record<string, string> = {
  classic_EASY: 'e335d3a0246ed76c:57', classic_NORMAL: '8ebd88b3337b4e9f:111', classic_HARD: '4003ceae962ea802:140',
  reference_EASY: '3a56adab38f930eb:77', reference_NORMAL: '1739148f44ee0899:170', reference_HARD: '1b137fd15d08975c:210',
  unified_EASY: '2854e90018047612:82', unified_NORMAL: 'f8ad7c18d517d9ff:118', unified_HARD: 'e7790904ddf97533:150',
};
const hash = (notes: unknown[]): string => createHash('sha1').update(JSON.stringify(notes)).digest('hex').slice(0, 16) + ':' + notes.length;

let analysis: AnalysisResult;
const gen = (o: GenerateOptions) => generateChart(analysis, o);
const holds = (o: GenerateOptions): number => gen(o).notes.filter((n) => n.type === 'hold').length;

beforeAll(async () => {
  const synth = makeSyntheticDrums({ bpm: 120, seconds: 60, startMs: 300 });
  analysis = { ...(await analyzeAudio(synth.samples, {})), song: '합성곡' };
});

/** 화면이 보내는 것처럼: 공통 칸에 그 모드·난이도의 규칙 기본값을 채워서 보낸다(바꾼 칸 없음) */
function asScreen(mode: 'reference' | 'unified', diff: string): GenerateOptions {
  const rules = mode === 'reference' ? referenceRulesFor(diff, loadPresets()) : unifiedRulesFor(diff, loadPresets());
  const d = commonDefaults(mode, rules);
  return { design_mode: mode, difficulty: diff, ratios: d.ratios, hold_beats: d.hold_beats, burst_count: d.burst_count };
}

describe('값을 안 바꾸면 이전과 같은 결과', () => {
  it('기존 방식: 세 난이도 그대로', () => {
    for (const d of ['EASY', 'NORMAL', 'HARD']) expect(hash(gen({ design_mode: 'classic', difficulty: d }).notes)).toBe(BASE[`classic_${d}`]);
  });
  it('레퍼런스: 규칙 기본값이 채워진 화면 그대로 보내도 같은 결과', () => {
    for (const d of ['EASY', 'NORMAL', 'HARD']) expect(hash(gen(asScreen('reference', d)).notes)).toBe(BASE[`reference_${d}`]);
  });
  it('통합: 규칙 기본값 그대로 보내면 같은 결과, 메시지는 "규칙 기본값 그대로"', () => {
    for (const d of ['EASY', 'NORMAL', 'HARD']) {
      const r = gen(asScreen('unified', d));
      expect(hash(r.notes)).toBe(BASE[`unified_${d}`]);
      expect(r.messages.join(' ')).toContain('규칙 기본값 그대로');
    }
  });
});

describe('공통 칸을 바꾸면 레퍼런스·통합에 반영', () => {
  it('레퍼런스: 롱노트 비율을 올리면 롱노트가 늘고, 메시지에 바꾼 항목 수', () => {
    const base = asScreen('reference', 'NORMAL');
    const r = gen({ ...base, ratios: { tap: 60, hold: 39, burst: 1 }, user_set: ['ratios'] });
    expect(r.notes.filter((n) => n.type === 'hold').length).toBeGreaterThan(holds(base));
    expect(r.messages.join(' ')).toContain('바꾼 항목 1개');
  });
  it('레퍼런스: 바꾼 칸(롱노트 길이·연타 횟수)만 규칙 값 위에 덮어쓰고, 안 바꾼 칸은 규칙 값', () => {
    const o = resolveOptions({ design_mode: 'reference', difficulty: 'NORMAL', hold_beats: 3, burst_count: 20, user_set: ['hold_beats'] });
    expect(o.hold_beats).toBe(3);
    expect(o.burst_count).toBe(8); // 연타 횟수는 바꾼 칸 목록에 없으니 규칙 값
    const d = resolveOptions({ design_mode: 'reference', difficulty: 'NORMAL', hold_beats: 3 });
    expect(d.hold_beats).toBe(1); // 바꾼 칸 목록이 없으면 규칙 기본값(보통 1박)
  });
  it('통합: 롱노트 비율을 올리면 롱노트가 늘어난다(늘어지는 소리 제한을 풀어 비율대로)', () => {
    const base = asScreen('unified', 'NORMAL');
    expect(holds({ ...base, ratios: { tap: 70, hold: 30, burst: 0 }, user_set: ['ratios'] })).toBeGreaterThan(holds(base));
  });
  it('통합: 노트 양 슬라이더 배율이 반영되고, 목표 초당 노트 수를 넣으면 그것이 우선', () => {
    const base = asScreen('unified', 'NORMAL');
    const n0 = gen(base).notes.length;
    expect(gen({ ...base, user_set: ['density'], density_scale: 1.8 }).notes.length).toBeGreaterThan(n0);
    expect(gen({ ...base, user_set: ['density'], density_scale: 0.4 }).notes.length).toBeLessThan(n0);
    const t = gen({ ...base, target_nps: 2.5 }).notes.length;
    expect(gen({ ...base, target_nps: 2.5, user_set: ['density'], density_scale: 0.4 }).notes.length).toBe(t);
  });
  it('통합: 연타 비율을 넣으면 연타가 생기고 다른 노트와 겹치지 않는다(검증 오류 0)', () => {
    const r = gen({ ...asScreen('unified', 'HARD'), ratios: { tap: 80, hold: 10, burst: 10 }, user_set: ['ratios'] });
    const bursts = r.notes.filter((n) => n.type === 'burst');
    expect(bursts.length).toBeGreaterThan(0);
    expect(r.validation.error_count).toBe(0);
  });
});

describe('[고급 규칙] 덮어쓰기', () => {
  it('통합: 최대 초당 노트 수를 낮추면 노트가 줄어든다', () => {
    const base = asScreen('unified', 'HARD');
    expect(gen({ ...base, rule_overrides: { max_nps: 2 } }).notes.length).toBeLessThan(gen(base).notes.length);
  });
  it('통합: 전체 최소 간격을 넓히면 노트가 줄어든다, 레퍼런스: 전환 확률을 바꾸면 레인 배치가 달라진다', () => {
    const u = asScreen('unified', 'HARD');
    expect(gen({ ...u, rule_overrides: { global_gap_ms: 400 } }).notes.length).toBeLessThan(gen(u).notes.length);
    const r = asScreen('reference', 'NORMAL');
    const lanes = (o: GenerateOptions): string => gen(o).notes.map((n) => n.lane).join('');
    expect(lanes({ ...r, rule_overrides: { switch_prob: 0.95 } })).not.toBe(lanes(r));
  });
  it('범위 밖·모르는 항목은 쉬운 한국어 오류', () => {
    expect(() => gen({ ...asScreen('unified', 'NORMAL'), rule_overrides: { max_nps: 99 } })).toThrow('최대 초당 노트 수');
    expect(() => gen({ ...asScreen('reference', 'NORMAL'), rule_overrides: { max_zigzag: 2.5 } })).toThrow('정수');
    expect(() => gen({ ...asScreen('reference', 'NORMAL'), rule_overrides: { nope: 1 } as Record<string, number> })).toThrow('알 수 없는');
  });
  it('칸 정의: 범위 검사와 dense_limits 안쪽 값 쓰기', () => {
    const f = RULE_FIELDS.unified.find((x) => x.key === 'same_lane_gap_ms')!;
    expect(ruleValueProblem(f, 600)).toContain('0~500');
    expect(ruleValueProblem(f, 120)).toBe('');
    const rules = referenceRulesFor('HARD', loadPresets());
    expect(applyRuleOverrides('reference', rules, { dense_sec: 4 })).toBe('');
    expect(rules.dense_limits[0][1]).toBe(4);
    expect(rules.dense_limits[1]).toEqual([0.26, 1.5]); // 둘째 줄은 그대로
  });
  it('규칙 기본값: 레퍼런스는 규칙 비율·길이·횟수, 통합은 롱노트 상한 %·연타 0, 기존 방식은 처음 값', () => {
    const p = loadPresets();
    expect(commonDefaults('reference', referenceRulesFor('EASY', p)).ratios).toEqual({ tap: 87, hold: 10, burst: 3 });
    expect(commonDefaults('unified', unifiedRulesFor('HARD', p)).ratios).toEqual({ tap: 90, hold: 10, burst: 0 });
    expect(commonDefaults('classic', null)).toEqual({ ratios: { tap: 70, hold: 20, burst: 10 }, hold_beats: 1, burst_count: 8, density: 55 });
  });
});

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
