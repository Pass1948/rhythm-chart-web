// 10단계 단위 테스트(순수 계산, 브라우저 없음): ① 2키 호환 ② 4키 JSON 검증 ③ 4키 생성 규칙 ⑤ 입력 매핑 ⑥ 레인 4개 위치
import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import type { AnalysisResult } from '../src/analysis/types.ts';
import { chartFromJson, chartToJson, exportUnity, newChart, validateChart } from '../src/core/index.ts';
import type { ChartNote, ChartV2 } from '../src/core/index.ts';
import { generateChart } from '../src/generate/index.ts';
import { toPlayChart } from '../src/chartPlay/toPlayChart.ts';
import { FOUR_KEY_CODES, fourKeyZoneBounds, fourKeyZoneOf, laneFromKey, laneFromPointer } from '../src/play/inputMapper.ts';
import { PLAY_CONFIG } from '../src/play/playConfig.ts';
import { createRailShape, judgeCircleCenter, laneCenterX, laneOffsetRatio } from '../src/play/railGeometry.ts';
import { JudgeEngine } from '../src/play/core/rules/judge/judgeEngine.ts';
import { makeSyntheticDrums } from '../tools/lib.ts';

const tap = (id: number, lane: number, tick: number): ChartNote => ({ id, type: 'tap', lane, tick });
const hold = (id: number, lane: number, tick: number, len: number): ChartNote => ({ id, type: 'hold', lane, tick, length_tick: len });
const burst = (id: number, tick: number, len: number): ChartNote => ({ id, type: 'burst', lane: 'both', tick, length_tick: len, count: 8 });

function chartWith(notes: ChartNote[], keyMode?: number, lanes?: number): ChartV2 {
  const c = newChart('t', 'a', 'a.wav', 600000);
  c.difficulties = [{ name: 'NORMAL', level: 0, notes }];
  if (keyMode !== undefined) c.keyMode = keyMode;
  if (lanes !== undefined) c.lanes = lanes;
  return c;
}
const codes = (c: ChartV2): string[] => validateChart(c).issues.filter((i) => i.level === 'error').map((i) => i.code);

describe('① 2키 호환', () => {
  it('keyMode 가 없는 옛 채보는 오류 없이 열리고 JSON 왕복에도 keyMode 가 생기지 않는다', () => {
    const c = chartWith([tap(1, 0, 0), tap(2, 1, 960), hold(3, 1, 1920, 960), burst(4, 4000, 1920)]);
    expect('keyMode' in c).toBe(false);
    const r = chartFromJson(chartToJson(c));
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect('keyMode' in r.chart).toBe(false);
    expect(r.chart.lanes).toBe(2);
  });
  it('keyMode 2 는 2키와 같고, 2키에서 레인 2는 여전히 오류', () => {
    expect(codes(chartWith([tap(1, 0, 0)], 2))).toEqual([]);
    expect(codes(chartWith([tap(1, 2, 0)]))).toContain('bad_lane');
    expect(exportUnity(chartWith([tap(1, 0, 0)])).format).toBe('two-key-unity.v2');
  });
});

describe('② 4키 JSON 검증', () => {
  it('4키 채보: 레인 0~3 통과, 4 이상은 오류, JSON 왕복에 keyMode 유지', () => {
    const c = chartWith([tap(1, 0, 0), tap(2, 3, 960)], 4, 4);
    expect(codes(c)).toEqual([]);
    expect(codes(chartWith([tap(1, 4, 0)], 4, 4))).toContain('bad_lane');
    const r = chartFromJson(chartToJson(c));
    expect(r.chart.keyMode).toBe(4);
    expect(r.chart.lanes).toBe(4);
    expect(r.issues.length).toBe(0);
  });
  it('keyMode 와 lanes 가 다르거나 모르는 keyMode 면 오류 (옛 앱은 lanes 4 를 거부)', () => {
    expect(codes(chartWith([tap(1, 0, 0)], 4, 2))).toContain('lanes');
    expect(codes(chartWith([tap(1, 0, 0)], undefined, 4))).toContain('lanes');
    expect(codes(chartWith([tap(1, 0, 0)], 3, 3))).toContain('key_mode');
  });
  it('4키 동시 입력: 같은 위치 3개, 롱노트 유지 포함 합 2개 초과는 오류([13])', () => {
    expect(codes(chartWith([tap(1, 0, 960), tap(2, 1, 960), tap(3, 2, 960)], 4, 4))).toContain('too_many_at_once');
    expect(codes(chartWith([tap(1, 0, 960), tap(2, 3, 960)], 4, 4))).toEqual([]);
    // [13] 롱노트 1 + 다른 손 단타 1 = 2 이면 통과, 롱노트 1 + 동시 단타 2 = 3 이면 오류
    expect(codes(chartWith([hold(1, 0, 0, 4000), tap(2, 2, 960)], 4, 4))).toEqual([]);
    expect(codes(chartWith([hold(1, 0, 0, 4000), tap(2, 1, 960), tap(3, 2, 960)], 4, 4))).toContain('too_many_held');
    expect(codes(chartWith([hold(1, 0, 0, 4000), hold(2, 1, 0, 4000), tap(3, 2, 960), tap(4, 3, 960)], 4, 4))).toContain('too_many_held');
  });
  it('4키 내보내기 형식과 게임용 변환', () => {
    const unity = exportUnity(chartWith([tap(1, 0, 960), tap(2, 3, 1920), burst(3, 4000, 1920)], 4, 4));
    expect(unity.format).toBe('four-key-unity.v2');
    expect(unity.key_mode).toBe(4);
    expect(unity.lanes).toBe(4);
    expect(unity.difficulties[0]!.notes.map((n) => n.lane)).toEqual([0, 3, 'both']);
    const play = toPlayChart(unity, 'NORMAL');
    expect(play.keyMode).toBe(4);
    expect(play.notes[1]!.lane).toBe(3);
  });
});

describe('③ 4키 생성 규칙', () => {
  const synth = makeSyntheticDrums({ bpm: 120, seconds: 60, startMs: 300 });
  let analysis: AnalysisResult;
  const make = async (extra = {}) => {
    if (!analysis) analysis = { ...(await analyzeAudio(synth.samples, {})), song: '합성곡' };
    return generateChart(analysis, { difficulty: 'HARD', key_mode: 4, ...extra });
  };
  it('4키로 만들면 채보에 keyMode 4·lanes 4, 모든 노트 레인 0~3 (연타는 both), 검증 오류 0', async () => {
    const r = await make();
    expect(r.chart.keyMode).toBe(4);
    expect(r.chart.lanes).toBe(4);
    expect(r.notes.length).toBeGreaterThan(20);
    for (const n of r.notes) expect(n.type === 'burst' ? n.lane === 'both' : [0, 1, 2, 3].includes(n.lane as number)).toBe(true);
    expect(r.validation.error_count).toBe(0);
  });
  it('같은 곡·같은 설정이면 항상 같은 결과', async () => {
    const a = await make();
    const b = await make();
    expect(JSON.stringify(a.notes)).toBe(JSON.stringify(b.notes));
  });
  it('사용 레인 분포가 한쪽에 몰리지 않고 같은 레인 3연속이 없다', async () => {
    const r = await make();
    const singles = r.notes.filter((n) => n.type !== 'burst');
    const counts = [0, 1, 2, 3].map((l) => singles.filter((n) => n.lane === l).length);
    for (const c of counts) expect(c / singles.length).toBeGreaterThan(0.12);
    let run = 1;
    for (let i = 1; i < singles.length; i++) {
      run = singles[i]!.lane === singles[i - 1]!.lane && singles[i]!.tick !== singles[i - 1]!.tick ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(2);
    }
  });
  it('2키로 만든 결과는 keyMode 필드가 없고 레인 0·1 만 쓴다', async () => {
    const r = await make({ key_mode: 2 });
    expect('keyMode' in r.chart).toBe(false);
    expect(r.chart.lanes).toBe(2);
    for (const n of r.notes) if (n.type !== 'burst') expect([0, 1]).toContain(n.lane);
  });
});

describe('⑤ 입력 매핑 / ⑥ 레인 4개 위치', () => {
  const input = { keyboardEnabled: true, mouseEnabled: true, keyLeft: 'KeyS', keyRight: 'KeyF' };
  it('4키는 S D K L = 레인 0~3, 다른 키는 무시, 2키는 그대로 (S·설정 오른쪽 키)', () => {
    expect(FOUR_KEY_CODES.map((c) => laneFromKey(c, input, 4))).toEqual([0, 1, 2, 3]);
    expect(laneFromKey('KeyF', input, 4)).toBeNull();
    expect(laneFromKey('KeyF', input)).toBe(1);
    expect(laneFromKey('KeyD', input)).toBeNull();
    expect(laneFromKey('KeyS', { ...input, keyboardEnabled: false }, 4)).toBeNull();
  });
  it('터치 4구역: 가장 가까운 레인 가운데 사이가 경계, 양끝은 화면 가장자리까지', () => {
    const [a, b, c] = fourKeyZoneBounds();
    expect(b).toBeCloseTo(0.5, 6);
    expect(a).toBeLessThan(0.5);
    expect(c).toBeGreaterThan(0.5);
    expect([0, a - 0.001, a + 0.001, b - 0.001, b + 0.001, c - 0.001, c + 0.001, 1].map((x) => fourKeyZoneOf(x))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(laneFromPointer(0.1, input, 4)).toBe(0);
    expect(laneFromPointer(0.9, input, 4)).toBe(3);
    expect(laneFromPointer(0.4, input)).toBe(0); // 2키: 절반 기준 그대로
    expect(laneFromPointer(0.6, input)).toBe(1);
    expect(laneFromPointer(0.1, { ...input, mouseEnabled: false }, 4)).toBeNull();
  });
  it('레인 4개 위치: 레일 폭을 같은 간격으로 4등분, 2키 위치는 그대로', () => {
    const shape = createRailShape();
    const xs = [0, 1, 2, 3].map((l) => judgeCircleCenter(shape, l, 4).x);
    const gap = xs[1]! - xs[0]!;
    expect(xs[2]! - xs[1]!).toBeCloseTo(gap, 6);
    expect(xs[3]! - xs[2]!).toBeCloseTo(gap, 6);
    expect(gap).toBeCloseTo(PLAY_CONFIG.rail.judgeWidth / 4, 6);
    expect((xs[0]! + xs[3]!) / 2).toBeCloseTo(PLAY_CONFIG.rail.centerX, 6);
    expect(judgeCircleCenter(shape, 0).x).toBeCloseTo(PLAY_CONFIG.rail.centerX - PLAY_CONFIG.rail.judgeWidth / 4, 6);
    expect(laneOffsetRatio(0, 2)).toBe(-0.5);
    expect(laneCenterX(shape, 3, 0.5, 4)).toBeGreaterThan(laneCenterX(shape, 2, 0.5, 4));
  });
  it('판정: 4레인 독립, 동시 2개 입력 모두 인식, 연타는 어느 레인이든', () => {
    const cfg = { perfectMs: 45, greatMs: 95, goodMs: 150, badMs: 200, autoMissAfterMs: 300, holdCompleteRatio: 0.95, holdTickSubdivision: 4, holdMinTickIntervalMs: 60 };
    const notes = [
      { type: 'tap', lane: 0, timeMs: 1000, durationMs: 0, count: 0 },
      { type: 'tap', lane: 3, timeMs: 1000, durationMs: 0, count: 0 },
      { type: 'burst', lane: 'both', timeMs: 3000, durationMs: 1000, count: 3 },
    ] as const;
    const j = new JudgeEngine(notes as never, cfg as never);
    const e1 = j.pressLane(0, 1000);
    const e2 = j.pressLane(3, 1010);
    expect(e1.filter((e) => e.kind === 'resolved').length + e2.filter((e) => e.kind === 'resolved').length).toBe(2);
    j.releaseLane(0, 1100);
    j.releaseLane(3, 1100);
    j.pressLane(1, 3100);
    j.pressLane(2, 3200);
    j.pressLane(3, 3300);
    const done = j.advance(4500).filter((e) => e.noteType === 'burst');
    expect(done[0]!.grade).toBe('great');
  });
});
