/**
 * 데이터 코어 테스트: 원본 tests\test_core_*.py, test_v011.py 의 케이스를 같은 범위로 옮겼다.
 * (tick↔ms 왕복, 격자, 검증 규칙별 통과/실패, 판정 규칙, v1→v2 변환, 저장 왕복, Unity 내보내기, 샘플 채보, retime)
 */
import { describe, expect, it } from 'vitest';
import {
  BpmMap,
  ChartFormatError,
  GridMap,
  KEEP_BEAT,
  KEEP_SOUND,
  TimingError,
  buildSampleChart,
  chartFromJson,
  chartMs,
  chartToJson,
  convertV1ToV2,
  exportEditJson,
  exportUnity,
  exportUnitySplit,
  hasErrors,
  judge,
  judgeBurst,
  judgeHold,
  judgeTap,
  loadChartData,
  makeNote,
  msToTicks,
  newChart,
  retime,
  retimeChart,
  ticksToMs,
  validateChart,
  validateIssues,
} from '../src/core/index.ts';
import type { BpmEntry, ChartNote, ChartV2 } from '../src/core/index.ts';

// ---------- 타이밍 ----------
const SINGLE: BpmEntry[] = [{ tick: 0, bpm: 120.0, beats_per_bar: 4 }];
const MIDDLE: BpmEntry[] = [
  { tick: 0, bpm: 120.0, beats_per_bar: 4 },
  { tick: 7680, bpm: 175.5, beats_per_bar: 4 },
];
const LAST: BpmEntry[] = [
  { tick: 0, bpm: 93.7, beats_per_bar: 4 },
  { tick: 3840, bpm: 140.0, beats_per_bar: 3 },
  { tick: 20000, bpm: 66.6, beats_per_bar: 4 },
  { tick: 96000, bpm: 201.25, beats_per_bar: 4 },
];

describe('tick ↔ ms 변환', () => {
  for (const [name, entries] of [
    ['단일', SINGLE],
    ['중간변속', MIDDLE],
    ['마지막변속', LAST],
  ] as [string, BpmEntry[]][]) {
    it(`왕복 오차 0.01ms 이하 (${name})`, () => {
      const m = new BpmMap(entries);
      const ticks: number[] = [7680, 20000, 96000, 96001];
      for (let t = 0; t < 200000; t += 777) ticks.push(t);
      for (const tick of ticks) {
        const back = m.msToTick(m.tickToMs(tick));
        expect(Math.abs(back - tick) * m.msPerTick(m.indexByTick(tick))).toBeLessThan(0.01);
      }
      for (const ms of [0, 1.234, 500, 12345.678, 99999.9]) {
        expect(Math.abs(m.tickToMs(m.msToTick(ms)) - ms)).toBeLessThan(0.01);
      }
    });
  }

  it('기준값: 120BPM에서 1박 = 500ms, 변속 지점', () => {
    const m = new BpmMap(SINGLE);
    expect(m.tickToMs(960)).toBeCloseTo(500.0, 9);
    const m2 = new BpmMap(MIDDLE);
    expect(m2.tickToMs(7680)).toBeCloseTo(4000.0, 9);
    expect(m2.tickToMs(7680 + 960)).toBeCloseTo(4000 + 60000 / 175.5, 9);
    expect(ticksToMs(960, m)).toBeCloseTo(500, 9);
    expect(msToTicks(500, m)).toBeCloseTo(960, 9);
  });

  it('잘못된 BPM 맵은 오류', () => {
    expect(() => new BpmMap([])).toThrow(TimingError);
    expect(() => new BpmMap([{ tick: 10, bpm: 120 }])).toThrow(TimingError);
    expect(() => new BpmMap([{ tick: 0, bpm: 0 }])).toThrow(TimingError);
    expect(() =>
      new BpmMap([
        { tick: 0, bpm: 120 },
        { tick: 0, bpm: 130 },
      ]),
    ).toThrow(TimingError);
  });

  it('박자가 바뀌면 그 위치에서 새 마디', () => {
    const m = new BpmMap([
      { tick: 0, bpm: 120, beats_per_bar: 4 },
      { tick: 7680, bpm: 120, beats_per_bar: 3 },
    ]);
    expect(m.barLines(13000).map(([t]) => t)).toEqual([0, 3840, 7680, 10560]);
  });

  it('구간별 격자 스냅', () => {
    const g = new GridMap([
      { tick: 0, division: 16 },
      { tick: 3840, division: 12 },
      { tick: 7680, division: 'free' },
    ]);
    expect(g.snap(250)).toBe(240);
    expect(g.snap(3840 + 170)).toBe(3840 + 320);
    expect(g.stepAt(3840)).toBe(320);
    expect(g.snap(7680 + 123)).toBe(7680 + 123);
    expect(() => new GridMap([{ tick: 0, division: 7 as never }])).toThrow(TimingError);
  });

  it('chartMs: 채보 시간 + audio_offset', () => {
    expect(chartMs(new BpmMap(SINGLE), 960, 20)).toBeCloseTo(520.0, 9);
  });
});

// ---------- retime ----------
function chartWithNotes(): ChartV2 {
  const c = newChart('', '', '', 60000);
  c.timing.bpm_map = [{ tick: 0, bpm: 120.0, beats_per_bar: 4, beat_unit: 4 }];
  c.difficulties[0]!.notes = [makeNote(1, 'tap', 0, 960), makeNote(2, 'hold', 1, 1920, 960), makeNote(3, 'burst', 0, 4800, 1920, 10)];
  return c;
}
const MAP_A: BpmEntry[] = [
  { tick: 0, bpm: 120.0, beats_per_bar: 4, beat_unit: 4 },
  { tick: 7680, bpm: 175.5, beats_per_bar: 4, beat_unit: 4 },
];
const MAP_B: BpmEntry[] = [
  { tick: 0, bpm: 96.5, beats_per_bar: 3, beat_unit: 4 },
  { tick: 5760, bpm: 180.0, beats_per_bar: 4, beat_unit: 4 },
  { tick: 30000, bpm: 75.0, beats_per_bar: 4, beat_unit: 4 },
];
function makeChart(entries: BpmEntry[], offset = 0): ChartV2 {
  const c = newChart('', '', '', 120000, offset);
  c.timing.bpm_map = entries;
  const notes: ChartNote[] = [];
  for (let i = 0; i < 60; i++) notes.push(makeNote(notes.length + 1, 'tap', i % 2, i * 480));
  notes.push(makeNote(notes.length + 1, 'hold', 0, 30000, 960));
  notes.push(makeNote(notes.length + 1, 'burst', 1, 33000, 1920, 10));
  c.difficulties[0]!.notes = notes;
  c.sections = [
    { tick: 0, name: '시작', kind: 'intro' },
    { tick: 7680, name: '중간', kind: 'verse' },
  ];
  return c;
}

describe('retime (BPM·시작 위치 바꾸기)', () => {
  it('소리 위치 유지는 ms 가 같다', () => {
    const c = chartWithNotes();
    const { chart: out } = retimeChart(c, [{ tick: 0, bpm: 150.0, beats_per_bar: 4, beat_unit: 4 }], 0, KEEP_SOUND);
    const oldMap = new BpmMap(c.timing.bpm_map);
    const newMap = new BpmMap(out.timing.bpm_map);
    c.difficulties[0]!.notes.forEach((a, i) => {
      const b = out.difficulties[0]!.notes[i]!;
      expect(Math.abs(oldMap.tickToMs(a.tick) - newMap.tickToMs(b.tick))).toBeLessThan(newMap.msPerTick(0));
    });
    expect(c.timing.bpm_map[0]!.bpm).toBe(120.0); // 원본은 그대로
  });

  it('박자 위치 유지는 tick 이 같다', () => {
    const out = retime(chartWithNotes(), { bpm_map: [{ tick: 0, bpm: 150.0 }], audio_offset_ms: 30, mode: KEEP_BEAT });
    expect(out.difficulties[0]!.notes.map((n) => n.tick)).toEqual([960, 1920, 4800]);
    expect(out.song.audio_offset_ms).toBe(30);
  });

  it('offset 변경 시 소리 위치 유지', () => {
    const c = chartWithNotes();
    const out = retime(c, { audio_offset_ms: 500, mode: KEEP_SOUND });
    expect(out.difficulties[0]!.notes[0]!.tick).toBe(0);
  });

  for (const [name, entries] of [
    ['변속A', MAP_A],
    ['변속B', MAP_B],
  ] as [string, BpmEntry[]][]) {
    it(`offset 을 뒤로 옮겨도 노트가 유실·중복되지 않는다 (${name})`, () => {
      const c = makeChart(entries);
      const oldMap = new BpmMap(entries);
      const { chart: out, messages } = retimeChart(c, entries.map((e) => ({ ...e })), 1500, KEEP_SOUND);
      const oldNotes = c.difficulties[0]!.notes;
      const newNotes = out.difficulties[0]!.notes;
      expect(newNotes.map((n) => n.id)).toEqual(oldNotes.map((n) => n.id));
      expect(Math.min(...newNotes.map((n) => n.tick))).toBeGreaterThanOrEqual(0);
      expect(hasErrors(validateIssues(out))).toBe(false);
      expect(new Set(newNotes.map((n) => `${n.lane}|${n.tick}`)).size).toBe(newNotes.length);
      const newMap = new BpmMap(out.timing.bpm_map);
      oldNotes.forEach((a, i) => {
        const b = newNotes[i]!;
        const sOld = oldMap.tickToMs(a.tick) + c.song.audio_offset_ms;
        const sNew = newMap.tickToMs(b.tick) + out.song.audio_offset_ms;
        expect(Math.abs(sOld - sNew)).toBeLessThan(2 * newMap.msPerTick(0));
      });
      expect(out.song.audio_offset_ms).toBeLessThanOrEqual(0);
      expect(messages.some((m) => m.includes('앞당겼'))).toBe(true);
      expect(out.sections[0]!.tick).toBeGreaterThanOrEqual(0);
      expect(c.song.audio_offset_ms).toBe(0); // 원본 불변
    });
  }

  it('음수가 없으면 앞당기지 않는다', () => {
    const c = makeChart(MAP_A, 800);
    const { chart: out, messages } = retimeChart(c, MAP_A, 0, KEEP_SOUND);
    expect(out.song.audio_offset_ms).toBe(0);
    expect(messages.some((m) => m.includes('앞당겼'))).toBe(false);
    expect(hasErrors(validateIssues(out))).toBe(false);
  });

  it('재계산 뒤 새로 생긴 오류만 안내한다', () => {
    const c = newChart('', '', '', 60000);
    c.timing.bpm_map = [{ tick: 0, bpm: 120.0, beats_per_bar: 4, beat_unit: 4 }];
    c.difficulties[0]!.notes = [makeNote(1, 'tap', 0, 960), makeNote(2, 'tap', 0, 961)];
    const { chart: out, messages } = retimeChart(c, [{ tick: 0, bpm: 40.0, beats_per_bar: 4, beat_unit: 4 }], 0, KEEP_SOUND);
    expect(messages.some((m) => m.includes('[재계산 후 오류]') && m.includes('#1') && m.includes('#2'))).toBe(true);
    expect(validateIssues(out).some((i) => i.level === 'error' && i.code === 'duplicate')).toBe(true);
  });

  it('이미 있던 문제는 다시 알리지 않는다', () => {
    const c = newChart('', '', '', 60000);
    c.difficulties[0]!.notes = [makeNote(1, 'tap', 0, 960), makeNote(2, 'tap', 0, 960)];
    const { messages } = retimeChart(c, c.timing.bpm_map, 0, KEEP_SOUND);
    expect(messages.some((m) => m.includes('재계산 후'))).toBe(false);
  });
});

// ---------- 검증 ----------
function chartWith(notes: unknown[], durationMs = 60000): ChartV2 {
  const c = newChart('', '', '', durationMs);
  c.difficulties[0]!.notes = notes as ChartNote[];
  return c;
}
function codes(chart: ChartV2, level?: string, cfg?: Parameters<typeof validateIssues>[1]): string[] {
  return validateIssues(chart, cfg)
    .filter((i) => level === undefined || i.level === level)
    .map((i) => i.code);
}
const CFG = { opposite_lane_policy: 'allow', max_burst_per_sec: 12, max_same_lane_run: 8, max_nps: 10, max_simultaneous_ratio: 0.4, min_hold_beats: 0.25 };

describe('검증 규칙', () => {
  it('정상 채보는 오류 없음', () => {
    expect(codes(chartWith([makeNote(1, 'tap', 0, 0), makeNote(2, 'tap', 1, 960), makeNote(3, 'hold', 0, 1920, 960)]), 'error')).toEqual([]);
  });
  it('같은 레인 같은 위치 중복', () => {
    expect(codes(chartWith([makeNote(1, 'tap', 0, 960), makeNote(2, 'tap', 0, 960)]), 'error')).toContain('duplicate');
    expect(codes(chartWith([makeNote(1, 'tap', 0, 960), makeNote(2, 'tap', 1, 960)]))).not.toContain('duplicate');
  });
  it('길이와 연타 횟수 범위', () => {
    expect(codes(chartWith([makeNote(1, 'hold', 0, 0, 0)]), 'error')).toContain('bad_length');
    expect(codes(chartWith([makeNote(1, 'hold', 0, 0, -5)]), 'error')).toContain('bad_length');
    expect(codes(chartWith([makeNote(1, 'burst', 0, 0, 960, 2)]), 'error')).toContain('bad_count');
    expect(codes(chartWith([makeNote(1, 'burst', 0, 0, 960, 101)]), 'error')).toContain('bad_count');
    for (const cnt of [3, 100]) expect(codes(chartWith([makeNote(1, 'burst', 0, 0, 96000, cnt)]))).not.toContain('bad_count');
  });
  it('곡 길이 초과', () => {
    expect(codes(chartWith([makeNote(1, 'tap', 0, 9600)], 4000), 'error')).toContain('over_duration');
    expect(codes(chartWith([makeNote(1, 'hold', 0, 5760, 3840)], 4900), 'error')).toContain('over_duration');
    expect(codes(chartWith([makeNote(1, 'tap', 0, 5760)], 5000))).not.toContain('over_duration');
  });
  it('audio_offset 과 decoder_delay 도 곡 길이 검사에 반영', () => {
    const c = chartWith([makeNote(1, 'tap', 0, 5760)], 3200);
    c.song.audio_offset_ms = 500;
    expect(codes(c, 'error')).toContain('over_duration');
    const d = chartWith([makeNote(1, 'tap', 0, 5760)], 3020);
    expect(codes(d)).not.toContain('over_duration');
    d.song.decoder_delay_ms = 35;
    expect(codes(d, 'error')).toContain('over_duration');
  });
  it('알 수 없는 종류·레인', () => {
    expect(codes(chartWith([{ id: 1, type: 'slide', lane: 0, tick: 0 }]), 'error')).toContain('bad_type');
    for (const lane of [2, -1, 'left', true]) {
      expect(codes(chartWith([{ id: 1, type: 'tap', lane, tick: 0 }]), 'error')).toContain('bad_lane');
    }
  });
  it('긴 노트 구간 안 겹침', () => {
    expect(codes(chartWith([makeNote(1, 'hold', 0, 0, 1920), makeNote(2, 'tap', 0, 960)]), 'error')).toContain('overlap_same_lane');
    expect(codes(chartWith([makeNote(1, 'burst', 1, 0, 1920, 10), makeNote(2, 'tap', 1, 1000)]), 'error')).toContain('burst_overlap');
    expect(codes(chartWith([makeNote(1, 'hold', 0, 0, 960), makeNote(2, 'tap', 0, 960)]))).not.toContain('overlap_same_lane');
  });
  it('반대 레인 정책(허용·경고·오류)', () => {
    const c = chartWith([makeNote(1, 'hold', 0, 0, 1920), makeNote(2, 'tap', 1, 960)]);
    expect(codes(c)).not.toContain('opposite_lane');
    expect(codes(c, 'warning', { ...CFG, opposite_lane_policy: 'warn' })).toContain('opposite_lane');
    expect(codes(c, 'error', { ...CFG, opposite_lane_policy: 'error' })).toContain('opposite_lane');
  });
  it('연타 너무 빠름 / 롱노트 너무 짧음', () => {
    expect(codes(chartWith([makeNote(1, 'burst', 0, 0, 960, 50)]), 'warning')).toContain('burst_too_fast');
    expect(codes(chartWith([makeNote(1, 'burst', 0, 0, 3840, 10)]))).not.toContain('burst_too_fast');
    expect(codes(chartWith([makeNote(1, 'hold', 0, 0, 100)]), 'warning')).toContain('hold_too_short');
    expect(codes(chartWith([makeNote(1, 'hold', 0, 0, 240)]))).not.toContain('hold_too_short');
  });
  it('같은 레인 연속', () => {
    const run = chartWith(Array.from({ length: 8 }, (_, i) => makeNote(i + 1, 'tap', 0, i * 960)));
    expect(codes(run, 'warning')).toContain('same_lane_run');
    const short = chartWith(Array.from({ length: 7 }, (_, i) => makeNote(i + 1, 'tap', 0, i * 960)));
    expect(codes(short)).not.toContain('same_lane_run');
  });
  it('초당 노트 과다·동시 입력 과다', () => {
    const dense = chartWith(Array.from({ length: 14 }, (_, i) => makeNote(i + 1, 'tap', i % 2, i * 80)));
    expect(codes(dense, 'warning')).toContain('too_dense');
    const notes: ChartNote[] = [];
    for (let i = 0; i < 6; i++) {
      notes.push(makeNote(notes.length + 1, 'tap', 0, i * 960));
      notes.push(makeNote(notes.length + 1, 'tap', 1, i * 960));
    }
    expect(codes(chartWith(notes), 'warning')).toContain('too_many_simultaneous');
  });
  it('메시지에 노트 id 가 들어간다', () => {
    const issues = validateIssues(chartWith([makeNote(7, 'tap', 0, 0), makeNote(9, 'tap', 0, 0)]));
    const dup = issues.find((i) => i.code === 'duplicate')!;
    expect(dup.note_ids).toEqual([7, 9]);
    expect(dup.message).toContain('#7');
    expect(dup.message).toContain('#9');
  });
  it('깨진 데이터도 멈추지 않는다', () => {
    expect(validateIssues(chartWith([{ id: 1 }, { id: 2, type: 'tap', lane: 0, tick: 'x' }])).length).toBeGreaterThanOrEqual(2);
  });
  it('디코더 지연 범위 경고, validateChart 요약', () => {
    const c = buildSampleChart();
    for (const [v, expectWarn] of [
      [500, false],
      [-500, false],
      [501, true],
      [-900, true],
    ] as [number, boolean][]) {
      c.song.decoder_delay_ms = v;
      expect(validateChart(c).issues.some((i) => i.code === 'decoder_delay' && i.level === 'warning')).toBe(expectWarn);
    }
    const r = validateChart(chartWith([makeNote(1, 'tap', 0, 0), makeNote(2, 'tap', 0, 0)]));
    expect(r.errors).toBeGreaterThan(0);
    expect(r.errors + r.warnings).toBe(r.issues.length);
  });
});

// ---------- 판정 ----------
describe('판정 규칙', () => {
  it('단타 등급 (폭은 config\\judge.json)', () => {
    expect(judgeTap(1000, 1030).result).toBe('perfect');
    expect(judgeTap(1000, 1070).result).toBe('great');
    expect(judgeTap(1000, 860).result).toBe('good');
    expect(judgeTap(1000, 1200).result).toBe('miss');
    expect(judgeTap(1000, null).success).toBe(false);
  });
  it('롱노트: 끝까지 유지하면 성공, 끝 이후 손떼기는 판정 안 함, 중간 이탈은 miss', () => {
    const r = judgeHold(1000, 2000, 1020, null);
    expect(r.success && r.result === 'perfect').toBe(true);
    for (const rel of [3000, 3050, 3500]) {
      const x = judgeHold(1000, 2000, 1020, rel);
      expect(x.success && x.result === 'perfect').toBe(true);
    }
    const bad = judgeHold(1000, 2000, 1020, 2500);
    expect(bad.success).toBe(false);
    expect(bad.result).toBe('miss');
  });
  it('롱노트: 첫 판정 등급 승계', () => {
    expect(judgeHold(1000, 2000, 1070, null).result).toBe('great');
    expect(judgeHold(1000, 2000, 1140, null).result).toBe('good');
    expect(judgeHold(1000, 2000, 1400, null).result).toBe('miss');
    expect(judgeHold(1000, 2000, null, null).result).toBe('miss');
    expect(judge('tap', 1000, 0, 1030, null).result).toBe('perfect');
  });
  it('연타: 미달·충족·초과, 구간 밖 터치는 세지 않음', () => {
    const presses = Array.from({ length: 10 }, (_, i) => 1000 + i * 100);
    expect(judgeBurst(1000, 1500, presses, 20).result).toBe('miss');
    expect(judgeBurst(1000, 1500, presses, 6).success).toBe(true);
    expect(judgeBurst(1000, 1500, presses, 3).success).toBe(true);
    const r = judgeBurst(1000, 1500, [900, 2600], 3);
    expect(r.touches).toBe(0);
    expect(r.success).toBe(false);
    expect(judgeBurst(1000, 1500, { '0': [1000, 1100], '1': [1200, 1300] }, 4).success).toBe(true);
  });
});

// ---------- 저장·불러오기·변환·내보내기 ----------
const V1 = {
  schema_version: 'two-key-chart.v1', title: '옛 곡', audio_file: 'old.mp3', bpm: 120, beat_offset: 0.3, grid_division: 8, meter: '4',
  analysis_mode: 'hybrid', difficulty: 'HARD', duration: 20, buttons: ['left', 'right'],
  notes: [
    { time: 0.1, lane: 0, type: 'tap' },
    { time: 0.8, lane: 1, type: 'tap' },
    { time: 1.3, lane: 'left', type: 'tap' },
    { time: 2.0, lane: 5, type: 'tap' },
    { time: 3.0, lane: 1, type: 'slide' },
  ],
};

describe('채보 저장·불러오기·변환', () => {
  it('v1 변환: 모든 소리 위치가 초 단위 원본과 일치', () => {
    const [chart, log] = convertV1ToV2(V1);
    const diff = chart.difficulties[0]!;
    expect(diff.name).toBe('HARD');
    expect(chart.schema_version).toBe(2);
    const m = new BpmMap(chart.timing.bpm_map);
    const off = chart.song.audio_offset_ms;
    expect(diff.notes.map((n) => Math.round(m.tickToMs(n.tick) + off))).toEqual([100, 800, 1300]);
    expect(chart.timing.grid_map[0]!.division).toBe(8);
    expect(off).toBeLessThanOrEqual(0);
    expect(log.some((x) => x.includes('레인'))).toBe(true);
    expect(log.some((x) => x.includes('단타'))).toBe(true);
  });
  it('v1 자동 변환 불러오기(JSON 문자열)', () => {
    const res = chartFromJson(JSON.stringify(V1));
    expect(res.converted_from).toBe(1);
    expect(res.chart.schema_version).toBe(2);
    expect(res.conversion_notes.length).toBeGreaterThan(0);
  });
  it('v1 중복·길이 초과는 검증에서 보고', () => {
    const res = loadChartData({ ...V1, notes: [{ time: 1.0, lane: 0 }, { time: 1.0, lane: 0 }, { time: 99.0, lane: 1 }] });
    const codeSet = new Set(res.issues.map((i) => i.code));
    expect(codeSet.has('duplicate')).toBe(true);
    expect(codeSet.has('over_duration')).toBe(true);
  });
  it('v2 저장 → 불러오기 왕복 동일', () => {
    const chart = buildSampleChart();
    const res = chartFromJson(chartToJson(chart));
    expect(res.converted_from).toBe(0);
    expect(res.chart.difficulties).toEqual(chart.difficulties);
    expect(res.chart.timing).toEqual(chart.timing);
    expect(res.chart.sections).toEqual(chart.sections);
    expect(res.chart.song).toEqual(chart.song);
    expect(res.chart.meta.editor_version).toBe('0.2.1');
    expect(typeof res.chart.meta.saved_at).toBe('string');
  });
  it('새 버전·이상한 파일은 안내', () => {
    expect(() => loadChartData({ schema_version: 3 })).toThrow(ChartFormatError);
    expect(() => loadChartData({ foo: 1 })).toThrow(ChartFormatError);
    expect(() => loadChartData([1, 2])).toThrow(ChartFormatError);
    expect(() => chartFromJson('{깨진')).toThrow(ChartFormatError);
  });
  it('연타노트 옛 형식(레인 0/1)은 both 로 자동 변환', () => {
    const c = chartWith([{ id: 1, type: 'burst', lane: 1, tick: 0, length_tick: 960, count: 5 }]);
    const res = loadChartData(c);
    expect(res.converted_from).toBe(2);
    expect(res.chart.difficulties[0]!.notes[0]!.lane).toBe('both');
  });
  it('필드 없는 기존 v2 는 0으로 읽는다, v1 변환은 decoder_delay 0', () => {
    const c = buildSampleChart() as unknown as { song: Record<string, unknown> };
    delete c.song.decoder_delay_ms;
    const res = loadChartData(c);
    expect(res.chart.song.decoder_delay_ms).toBe(0);
    expect(hasErrors(res.issues)).toBe(false);
    const [v1c] = convertV1ToV2({ bpm: 120, beat_offset: 0.2, notes: [{ time: 1.0, lane: 0 }], duration: 10 });
    expect(v1c.song.decoder_delay_ms).toBe(0);
  });
});

describe('Unity 내보내기', () => {
  it('ms 정수, audio_offset 합산, 필드 모양', () => {
    const chart = buildSampleChart();
    chart.song.audio_offset_ms = 25;
    const data = exportUnity(chart);
    const m = new BpmMap(chart.timing.bpm_map);
    const normal = data.difficulties.find((d) => d.name === 'NORMAL')!.notes;
    const src = [...chart.difficulties[1]!.notes].sort((a, b) => a.tick - b.tick || (a.lane === 'both' ? -1 : (a.lane as number)) - (b.lane === 'both' ? -1 : (b.lane as number)));
    expect(normal.length).toBe(src.length);
    normal.forEach((out, i) => {
      const n = src[i]!;
      expect(Number.isInteger(out.time_ms)).toBe(true);
      expect(out.time_ms).toBe(Math.round(m.tickToMs(n.tick) + 25));
      expect(Object.keys(out).sort()).toEqual(['count', 'duration_ms', 'lane', 'time_ms', 'type']);
      if (n.type === 'tap') expect(out.duration_ms === 0 && out.count === 0).toBe(true);
      if (n.type === 'burst') expect(out.count === n.count && out.duration_ms > 0).toBe(true);
    });
    expect(data.format).toBe('two-key-unity.v2');
  });
  it('decoder_delay 는 Unity 내보내기에만 합산', () => {
    const c = buildSampleChart();
    c.song.audio_offset_ms = 20;
    const base = exportUnity(c);
    c.song.decoder_delay_ms = 35;
    const moved = exportUnity(c);
    base.difficulties.forEach((d0, di) => {
      d0.notes.forEach((a, ni) => {
        const b = moved.difficulties[di]!.notes[ni]!;
        expect(b.time_ms - a.time_ms).toBe(35);
        expect(a.duration_ms).toBe(b.duration_ms);
      });
    });
    expect(chartMs(new BpmMap(c.timing.bpm_map), 960, c.song.audio_offset_ms)).toBeCloseTo(520.0, 9);
    expect(JSON.parse(exportEditJson(c)).song.decoder_delay_ms).toBe(35);
  });
  it('난이도 하나만 내보내기 / 난이도별 분리', () => {
    const one = exportUnity(buildSampleChart(), 'EASY');
    expect(one.difficulties.length).toBe(1);
    expect(one.difficulties[0]!.name).toBe('EASY');
    expect(() => exportUnity(buildSampleChart(), '없는난이도')).toThrow(ChartFormatError);
    const parts = exportUnitySplit(buildSampleChart());
    expect(parts.length).toBe(2);
    for (const p of parts) expect(p.difficulties.length).toBe(1);
  });
  it('겹친 노트는 검증에 표시하고 Unity용과 편집용 양쪽에 보존한다', () => {
    const chart = buildSampleChart();
    const notes = chart.difficulties[0]!.notes;
    notes.push({ ...notes[0]!, id: 999 });
    expect(hasErrors(validateIssues(chart))).toBe(true);
    expect(exportUnity(chart).difficulties[0]!.notes).toHaveLength(notes.length);
    expect(exportEditJson(chart).length).toBeGreaterThan(10);
  });
});

describe('4키 이전 형식 가져오기', () => {
  it('버전 번호와 무관하게 4키 편집용 채보의 타이밍과 노트를 보존한다', () => {
    const original = buildSampleChart();
    const old = { ...original, schema_version: 'four-key-chart.v1', lanes: 4 };
    const result = loadChartData(old);
    expect(result.chart).toMatchObject({
      schema_version: 2, keyMode: 4, lanes: 4,
      timing: original.timing, difficulties: original.difficulties,
    });
    expect(loadChartData({ ...old, schema_version: 99 }).chart).toEqual(result.chart);
  });

  it('예전 Unity 4키 JSON의 음수 시작 시각과 롱노트 길이를 보존한다', () => {
    const notes = [
      { type: 'tap', lane: 0, time_ms: -23, duration_ms: 0, count: 0 },
      { type: 'hold', lane: 3, time_ms: 311, duration_ms: 217, count: 0 },
      { type: 'burst', lane: 'both', time_ms: 3057, duration_ms: 500, count: 8 },
    ];
    const { chart } = loadChartData({
      format: 'four-key-unity.v1',
      difficulties: [{ name: 'Glitch', level: 9, notes }],
    });
    expect(exportUnity(chart).difficulties).toEqual([{ name: 'GLIITCH', level: 9, notes }]);
  });
});

describe('샘플 채보', () => {
  it('단타·롱노트·연타노트를 모두 포함하고 오류가 없다', () => {
    const res = chartFromJson(chartToJson(buildSampleChart()));
    const types = new Set(res.chart.difficulties.flatMap((d) => d.notes.map((n) => n.type)));
    expect([...types].sort()).toEqual(['burst', 'hold', 'tap']);
    expect(hasErrors(res.issues)).toBe(false);
  });
});
