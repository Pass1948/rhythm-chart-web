/**
 * 04e 단위 테스트(합성 데이터만): 변속 구간 계산, 자동 찾기, 노트 생성, 저장/ZIP 왕복, 게임 화면용 변환.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildTempoEntries, findTempoChanges } from '../src/analysis/tempoChanges.ts';
import { BpmMap, buildSampleChart, chartFromJson, chartToJson, exportUnity, retimeChart } from '../src/core/index.ts';
import type { ChartV2 } from '../src/core/index.ts';
import { addSection, barBeatToTick, checkSections, removeSection, resetToSingle, setSectionBpm, setSectionBpmKeepAfter, setSectionMeter, setSectionStart } from '../src/core/tempoSections.ts';
import { generateChart } from '../src/generate/index.ts';
import { toPlayChart } from '../src/chartPlay/toPlayChart.ts';
import { buildExportFiles } from '../src/storage/exportFiles.ts';
import { readBundle } from '../src/storage/bundle.ts';
import { candidatesFromBeats, beatTimes, jitter, makeAnalysis, singleBpmAnalysis } from './synth04e.ts';
// @ts-ignore 편집기 쪽 JS(타입 검사 제외 대상)
import { S, commit, rebuildTiming, setChart, snapshot, undo, redo } from '../src/editor/js/state.js';

const SECTIONS = [
  { bpm: 100, beats: 20 },
  { bpm: 130, beats: 24 },
  { bpm: 110, beats: 16 },
];
const BEATS = beatTimes(SECTIONS, 500); // 60박, 첫 박 500ms
const beatEntry = (tick: number, bpm: number) => ({ tick, bpm, beats_per_bar: 4, beat_unit: 4 });
// 곡 시작(tick 0)부터 100BPM 20박 → 130BPM 24박 → 110BPM 16박
const ENTRIES = [beatEntry(0, 100), beatEntry(960 * 20, 130), beatEntry(960 * 44, 110)];
// 합성 박(첫 박 500ms)이 tick 960 에 오도록 한 칸 앞에서 시작하는 구간
const GEN_ENTRIES = [beatEntry(0, 100), beatEntry(960 * 21, 130), beatEntry(960 * 45, 110)];

describe('변속 계산 (100BPM 20박 → 130BPM 24박 → 110BPM 16박)', () => {
  const map = new BpmMap(ENTRIES);
  it('박·구간 경계 시각이 정확하다', () => {
    expect(map.tickToMs(0)).toBe(0);
    expect(map.tickToMs(960 * 20)).toBeCloseTo(20 * 600, 6); // 100BPM 20박
    expect(map.tickToMs(960 * 44)).toBeCloseTo(20 * 600 + 24 * (60000 / 130), 6);
    expect(map.tickToMs(960 * 60)).toBeCloseTo(20 * 600 + 24 * (60000 / 130) + 16 * (60000 / 110), 6);
    expect(map.entries.length).toBe(3);
    expect(map.msToTick(map.tickToMs(960 * 33 + 120))).toBeCloseTo(960 * 33 + 120, 6);
  });
  it('마디선은 구간마다 새로 시작하는 박자를 따른다', () => {
    const e = [beatEntry(0, 100), { tick: 3840, bpm: 130, beats_per_bar: 3, beat_unit: 4 }];
    const lines = new BpmMap(e).barLines(3840 + 2880 * 2);
    expect(lines.map((l) => l[0])).toEqual([0, 3840, 3840 + 2880, 3840 + 5760]);
    expect(lines.map((l) => l[1])).toEqual([1, 2, 3, 4]);
  });
  it('마디:박 → tick', () => {
    // 첫 구간이 4/4 → 3번째 마디 2박 = 2 마디 뒤 + 1박
    expect(barBeatToTick(ENTRIES, 1, 3, 2)).toBe(3840 * 2 + 960);
    expect(barBeatToTick(ENTRIES, 1, 3, 5)).toBeNull();
  });
});

describe('변속 구간 편집 규칙', () => {
  const base = [beatEntry(0, 120)];
  it('추가 → BPM 변경 → 삭제가 정확히 계산된다', () => {
    const a = addSection(base, 960 * 8);
    expect(a.ok && a.entries.map((x) => [x.tick, x.bpm])).toEqual([[0, 120], [7680, 120]]);
    const b = setSectionBpm((a as any).entries, 1, 140);
    expect(b.ok && b.entries[1]!.bpm).toBe(140);
    const c = removeSection((b as any).entries, 1);
    expect(c.ok && c.entries).toEqual(base.map((x) => ({ ...x })));
  });
  it('어긴 입력은 이유와 함께 거절한다', () => {
    const two = (addSection(base, 960 * 8) as any).entries;
    const reasons = [
      addSection(two, 960 * 8), // 같은 위치 중복
      addSection(two, 960 * 9), // 앞 구간과 1박 차이 (2박 미만)
      addSection(base, 960 * 8 + 100), // 박 위치가 아님
      addSection(base, 0), // 첫 구간 자리
      setSectionBpm(base, 0, 300.5), // BPM 범위
      setSectionBpm(base, 0, 39),
      removeSection(base, 0), // 첫 구간 삭제 불가
      setSectionStart(two, 0, 960 * 4), // 첫 구간 이동 불가
      setSectionStart(two, 1, 960), // 앞 구간과 너무 가까움
      setSectionMeter(base, 0, 9, 4),
    ];
    for (const r of reasons) {
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason.length).toBeGreaterThan(5);
    }
    expect(!addSection(two, 960 * 8).ok && (addSection(two, 960 * 8) as any).reason).toContain('같은 위치');
    expect((addSection(two, 960 * 9) as any).reason).toContain('최소 2박');
    expect((setSectionBpm(base, 0, 400) as any).reason).toContain('40~300');
  });
  it('구간은 최대 32개', () => {
    let e: any = base;
    for (let i = 1; i < 32; i++) {
      const r = addSection(e, 960 * 4 * i);
      expect(r.ok).toBe(true);
      e = (r as any).entries;
    }
    expect(e.length).toBe(32);
    const over = addSection(e, 960 * 4 * 32);
    expect(over.ok).toBe(false);
    expect((over as any).reason).toContain('32');
    expect(checkSections(e)).toBeNull();
  });
  it('곡 끝에 너무 가까운 위치도 거절', () => {
    expect(addSection(base, 960 * 10, { endTick: 960 * 11 }).ok).toBe(false);
    expect(addSection(base, 960 * 10, { endTick: 960 * 14 }).ok).toBe(true);
  });
  it('뒤 구간 소리 위치 유지: BPM 을 고쳐도 뒤 구간 시작이 가장 가까운 박으로 따라간다', () => {
    const oldMap = new BpmMap(ENTRIES);
    const r = setSectionBpmKeepAfter(ENTRIES, 0, 101);
    expect(r.ok).toBe(true);
    const e = (r as any).entries;
    const m = new BpmMap(e);
    for (const j of [1, 2]) expect(Math.abs(m.tickToMs(e[j].tick) - oldMap.tickToMs(ENTRIES[j]!.tick))).toBeLessThanOrEqual(60000 / 101 / 2 + 1);
    // 안 유지하면 뒤 구간 시작 tick 이 그대로
    expect((setSectionBpm(ENTRIES, 0, 101) as any).entries.map((x: any) => x.tick)).toEqual([0, 19200, 42240]);
  });
  it('한 BPM 으로 되돌리기', () => {
    const r = resetToSingle(ENTRIES);
    expect(r.ok && r.entries.length).toBe(1);
  });
});

describe('실행취소 한 번 단위 (편집기 상태)', () => {
  it('추가·BPM 변경·삭제를 retimeChart 로 적용하고 실행취소로 그대로 돌아간다', () => {
    const chart = buildSampleChart();
    chart.timing.bpm_map = [chart.timing.bpm_map[0]!]; // 구간 하나로 시작
    setChart(chart);
    const noteCount0 = S.chart.difficulties[0].notes.length;
    const original = JSON.stringify(S.chart.timing.bpm_map);
    const originalNotes = JSON.stringify(S.chart.difficulties[0].notes);
    const apply = (entries: any[]): void => {
      const before = snapshot();
      const out = retimeChart(S.chart, entries, S.chart.song.audio_offset_ms ?? 0, 'time');
      S.chart = out.chart;
      rebuildTiming();
      commit(before);
    };
    const bpm0 = S.chart.timing.bpm_map[0].bpm;
    let r: any = addSection(S.chart.timing.bpm_map, 960 * 16);
    expect(r.ok).toBe(true);
    apply(r.entries);
    const afterAdd = JSON.stringify(S.chart.timing.bpm_map);
    expect(S.chart.timing.bpm_map.length).toBe(2);
    r = setSectionBpm(S.chart.timing.bpm_map, 1, bpm0 + 20);
    apply(r.entries);
    expect(S.chart.timing.bpm_map[1].bpm).toBe(bpm0 + 20);
    const afterBpm = JSON.stringify(S.chart.timing.bpm_map);
    r = removeSection(S.chart.timing.bpm_map, 1);
    apply(r.entries);
    expect(S.chart.timing.bpm_map.length).toBe(1);
    // 실행취소 3번: 삭제 → BPM 변경 → 추가 순으로 정확히 되돌아간다
    expect(undo()).toBe(true);
    expect(JSON.stringify(S.chart.timing.bpm_map)).toBe(afterBpm);
    expect(undo()).toBe(true);
    expect(JSON.stringify(S.chart.timing.bpm_map)).toBe(afterAdd);
    expect(undo()).toBe(true);
    expect(JSON.stringify(S.chart.timing.bpm_map)).toBe(original);
    expect(JSON.stringify(S.chart.difficulties[0].notes)).toBe(originalNotes);
    expect(S.chart.difficulties[0].notes.length).toBe(noteCount0);
    expect(redo()).toBe(true);
    expect(JSON.stringify(S.chart.timing.bpm_map)).toBe(afterAdd);
  });
});

describe('노트 생성이 변속 구간을 따른다', () => {
  const entries = GEN_ENTRIES.map((e) => ({ ...e }));
  // 첫 박 500ms = tick 960 이 되도록 시작점을 정한다
  const offset = 500 - 600;
  const analysis = makeAnalysis(candidatesFromBeats(BEATS), 100, offset, 40000, BEATS);
  const melody = generateChart(analysis, { bpm_map: entries, audio_offset_ms: offset, ratios: { tap: 70, hold: 20, burst: 10 } });

  it('채보에 구간 전체가 그대로 남는다 (분석의 대표 BPM 으로 덮어쓰지 않음)', () => {
    expect(melody.chart.timing.bpm_map.map((e) => [e.tick, e.bpm])).toEqual([[0, 100], [20160, 130], [43200, 110]]);
    expect(melody.chart.song.audio_offset_ms).toBe(offset);
    expect(melody.notes.length).toBeGreaterThan(8);
  });
  it('모든 노트가 그 구간의 박 격자(8분) 위에 있고 소리와 ±20ms 안', () => {
    const map = new BpmMap(melody.chart.timing.bpm_map);
    // 합성 박 위치의 8분 격자 시각(음원 ms)
    const grid: number[] = [];
    for (let i = 0; i < BEATS.length; i++) {
      const interval = i+1 < BEATS.length ? BEATS[i+1]! - BEATS[i]! : BEATS[i]! - BEATS[i-1]!;
      grid.push(BEATS[i]!, BEATS[i]! + interval/2);
    }
    for (const n of melody.notes) {
      const ms = map.tickToMs(n.tick) + offset;
      const nearest = Math.min(...grid.map((g) => Math.abs(g - ms)));
      expect(nearest).toBeLessThanOrEqual(20);
      expect(n.tick % 120).toBe(0); // 16분 격자 이하 (tick 단위 정수)
    }
    // 세 구간 모두에 노트가 있다
    const times = melody.notes.map((n) => map.tickToMs(n.tick) + offset);
    expect(times.some((t) => t < 12500)).toBe(true);
    expect(times.some((t) => t > 12500 && t < 23600)).toBe(true);
    expect(times.some((t) => t > 23600)).toBe(true);
  });
  it('모든 디자인 모드에서 변속 곡 생성이 오류 없이 끝난다', () => {
    for (const mode of ['classic', 'reference', 'unified']) {
      const r = generateChart(analysis, { bpm_map: entries, audio_offset_ms: offset, design_mode: mode });
      expect(r.notes.length).toBeGreaterThan(10);
      expect(r.chart.timing.bpm_map.length).toBe(3);
    }
  });
});

describe('BPM 구간이 하나뿐인 곡은 이전과 결과가 완전히 같다', () => {
  // 04e 수정 전 코드로 같은 합성 입력에서 구한 값(노트 목록 + 타이밍 + 안내 문구의 해시)
  const BASELINE: Record<string, string> = {
    'classic/EASY': '70:64e975b7c23d369e',
    'classic/NORMAL': '137:a8aa7c1aae2e073d',
    'classic/HARD': '140:c00fde9604b4ed30',
    'reference/EASY': '73:59583e5ceedb2a5e',
    'reference/NORMAL': '136:e1100a2853501029',
    'reference/HARD': '140:b412969756daa38d',
    'unified/EASY': '66:881d078cf01959d2',
    'unified/NORMAL': '100:ec7f4909bb0f5b96',
    'unified/HARD': '124:20c419f9e553c351',
  };
  it('classic·reference·unified × 쉬움·보통·어려움 9가지 모두 예전과 같고, 채보에 저장된 구간을 넘겨도 같다', () => {
    for (const mode of ['classic', 'reference', 'unified']) {
      for (const diff of ['EASY', 'NORMAL', 'HARD']) {
        const opt = { design_mode: mode, difficulty: diff, ratios: { tap: 60, hold: 20, burst: 20 } };
        const plain = generateChart(singleBpmAnalysis(), opt);
        const viaChart = generateChart(singleBpmAnalysis(), { ...opt, bpm_map: [beatEntry(0, 120)], audio_offset_ms: 0 });
        const key = `${mode}/${diff}`;
        const sig = (r: typeof plain): string => `${r.notes.length}:${createHash('sha256').update(JSON.stringify(r.notes) + JSON.stringify(r.chart.timing) + JSON.stringify(r.messages)).digest('hex').slice(0, 16)}`;
        expect(sig(plain)).toBe(BASELINE[key]);
        expect(JSON.stringify(viaChart.notes)).toBe(JSON.stringify(plain.notes));
        expect(JSON.stringify(viaChart.chart.timing)).toBe(JSON.stringify(plain.chart.timing));
      }
    }
  });
});

describe('저장·ZIP 왕복·게임 화면용 변환', () => {
  const analysis = makeAnalysis(candidatesFromBeats(BEATS), 100, -100, 40000, BEATS);
  const gen = generateChart(analysis, { bpm_map: GEN_ENTRIES, audio_offset_ms: -100 });
  const chart: ChartV2 = gen.chart;
  chart.song.audio_file = 'test.wav';
  chart.song.title = '합성곡';

  it('JSON 저장→불러오기에서 구간이 그대로', () => {
    const back = chartFromJson(chartToJson(chart)).chart;
    expect(back.timing.bpm_map).toEqual(chart.timing.bpm_map);
    expect(back.song.audio_offset_ms).toBe(-100);
  });
  it('채보+음원 ZIP 왕복에서 구간이 그대로', async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });
    const { files } = { files: await buildExportFiles({ what: 'both', kind: 'edit', split: false, chart, audioBlob: audio, audioFileName: 'test.wav' }) };
    expect(files.length).toBe(1);
    const zip = new File([files[0]!.blob], files[0]!.name, { type: 'application/zip' });
    const bundle = await readBundle(zip);
    expect(bundle).not.toBeNull();
    const back = chartFromJson(bundle!.chartText!).chart;
    expect(back.timing.bpm_map).toEqual(chart.timing.bpm_map);
    expect(back.difficulties[0]!.notes.length).toBe(chart.difficulties[0]!.notes.length);
  });
  it('게임 화면용 변환(toPlayChart)의 시각이 구간마다 정확하다', () => {
    const unity = exportUnity(chart);
    const play = toPlayChart(unity, 'NORMAL');
    const map = new BpmMap(chart.timing.bpm_map);
    const source = [...chart.difficulties[0]!.notes].sort((a, b) => a.tick - b.tick);
    const kept = play.notes.filter((n) => n.timeMs >= 0);
    expect(kept.length).toBeGreaterThan(8);
    // 노트 i 의 시각 = round(tickToMs(tick) + offset)
    const expectedMs = source.map((n) => Math.round(map.tickToMs(n.tick) + -100)).filter((t) => t >= 0);
    const gotMs = kept.map((n) => Math.round(n.timeMs));
    for (let i = 0; i < Math.min(expectedMs.length, gotMs.length); i++) expect(Math.abs(gotMs[i]! - expectedMs[i]!)).toBeLessThanOrEqual(1);
    expect(Math.max(...gotMs)).toBeGreaterThan(23600); // 마지막 구간까지 변환됨
  });
});

describe('변속 자동 찾기', () => {
  const applyCheck = (beats: number[], r: ReturnType<typeof findTempoChanges>): void => {
    const sel = r.candidates.map((c) => c.section);
    const { entries, audio_offset_ms } = buildTempoEntries(r, sel);
    expect(checkSections(entries)).toBeNull();
    const map = new BpmMap(entries);
    // 찾은 박 전부가 적용한 구간 위의 박(tick 960 의 배수)과 ±20ms 안
    let tick = 960;
    let worst = 0;
    for (let b = 0; b < beats.length; b++) {
      const t = map.tickToMs(tick) + audio_offset_ms;
      worst = Math.max(worst, Math.abs(t - beats[b]!));
      tick += 960;
    }
    expect(worst).toBeLessThanOrEqual(20);
  };

  it('100→130→110 BPM: 변속 2곳을 박 1개 이내로 찾고 구간 BPM 이 1% 이내', () => {
    const r = findTempoChanges(BEATS, 'normal');
    expect(r.candidates.length).toBe(2);
    expect(Math.abs(r.candidates[0]!.beatIndex - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.candidates[1]!.beatIndex - 44)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.sections[0]!.bpm / 100 - 1)).toBeLessThan(0.01);
    expect(Math.abs(r.sections[1]!.bpm / 130 - 1)).toBeLessThan(0.01);
    expect(Math.abs(r.sections[2]!.bpm / 110 - 1)).toBeLessThan(0.01);
    expect(r.sections.map((s) => s.beats)).toEqual([20, 24, 15]);
    for (const c of r.candidates) expect(c.confidence).toBeGreaterThan(0.5);
  });
  it('적용하면 찾은 박 위치와 ±20ms 안 (박 흔들림 ±8ms 포함)', () => {
    const noisy = jitter(BEATS, 8, 21);
    const r = findTempoChanges(noisy, 'normal');
    expect(r.candidates.length).toBe(2);
    applyCheck(noisy, r);
    applyCheck(BEATS, findTempoChanges(BEATS, 'normal'));
  });
  it('한 BPM 곡(박 흔들림 ±15ms)은 후보 0개, 세 민감도 모두', () => {
    const flat = jitter(beatTimes([{ bpm: 120, beats: 120 }], 400), 15, 5);
    for (const s of ['strict', 'normal', 'sensitive'] as const) {
      const r = findTempoChanges(flat, s);
      expect(r.candidates.length).toBe(0);
      expect(r.message).toContain('변속이 확인되지 않았습니다');
    }
  });
  it('서서히 빨라지는 곡은 쪼개지 않고 연속 변화 가능성만 알린다', () => {
    const beats: number[] = [];
    let t = 300;
    for (let i = 0; i < 90; i++) {
      beats.push(t);
      t += 600 - ((600 - 428) * Math.min(i, 64)) / 64; // 100 → 140 BPM 로 64박에 걸쳐
    }
    for (const s of ['strict', 'normal', 'sensitive'] as const) {
      const r = findTempoChanges(beats, s);
      expect([s, r.candidates.length, r.candidates.map((c) => c.beatIndex)]).toEqual([s, 0, []]);
      expect(r.continuous).toBe(true);
      expect(r.message).toContain('연속 변화');
    }
  });
  it('옥타브 오류(박을 놓치거나 반 박을 잡음)가 섞여도 오탐이 없다', () => {
    const plain = beatTimes([{ bpm: 100, beats: 100 }], 500);
    const missed = plain.filter((_, i) => i % 7 !== 3); // 7박마다 1박을 놓침 → 간격 2배
    const doubled: number[] = [];
    plain.forEach((b, i) => {
      doubled.push(b);
      if (i >= 30 && i < 42) doubled.push(b + 300); // 12박 구간은 반 박까지 잡음 → 간격 반
    });
    for (const list of [missed, doubled, jitter(missed, 6, 3)]) {
      for (const s of ['normal', 'sensitive'] as const) expect(findTempoChanges(list.sort((a, b) => a - b), s).candidates.length).toBe(0);
    }
  });
  it('옥타브 오류가 섞여도 진짜 변속은 찾는다', () => {
    const base = beatTimes([{ bpm: 100, beats: 24 }, { bpm: 130, beats: 30 }], 500);
    const missed = base.filter((_, i) => i % 9 !== 4);
    const r = findTempoChanges(missed, 'normal');
    expect(r.candidates.length).toBe(1);
    expect(Math.abs(r.candidates[0]!.bpm / 130 - 1)).toBeLessThan(0.02);
  });
  it('민감도: 5% 가까운 작은 변화는 엄격에서는 못 찾고 보통·민감에서는 찾는다', () => {
    const beats = beatTimes([{ bpm: 100, beats: 24 }, { bpm: 104, beats: 24 }], 500); // 4% 빨라짐
    expect(findTempoChanges(beats, 'strict').candidates.length).toBe(0);
    expect(findTempoChanges(beats, 'normal').candidates.length).toBe(1);
    expect(findTempoChanges(beats, 'sensitive').candidates.length).toBe(1);
  });
  it('후보를 일부만 적용하면 합친 구간의 BPM 을 정수 박으로 역산한다', () => {
    const r = findTempoChanges(BEATS, 'normal');
    const { entries } = buildTempoEntries(r, [r.candidates[1]!.section]); // 두 번째 변속만
    expect(entries.length).toBe(2);
    const dur = BEATS[44]! - BEATS[0]!;
    expect(entries[0]!.bpm).toBeCloseTo((44 * 60000) / dur, 2);
    expect(entries[1]!.tick).toBe(960 + 44 * 960);
    expect(buildTempoEntries(r, []).entries.length).toBe(1);
  });
  it('박이 모자라면 안내하고 후보가 없다', () => {
    const r = findTempoChanges(beatTimes([{ bpm: 120, beats: 8 }]), 'normal');
    expect(r.candidates.length).toBe(0);
    expect(r.message).toContain('충분하지 않아');
  });
});
