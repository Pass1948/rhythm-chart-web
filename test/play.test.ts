/**
 * 03단계 테스트: 편집기 채보 → 게임 채보 변환, 판정 규칙(롱노트 틱·연타), 점수, 입력 지연 보정, startMs·rate 계산,
 * 올 퍼펙트·무입력 시뮬레이션, 결과 모으기(평균 오차·MISS 목록), 설정 연결.
 * 브라우저 화면(WebGL·소리)은 test\smoke03.mjs 가 따로 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import type { AnalysisResult } from '../src/analysis/types.ts';
import { allNotes } from './helpers03.ts';
import { exportUnity, buildSampleChart, buildUnityData, ticksToMs, BpmMap } from '../src/core/index.ts';
import type { ChartV2 } from '../src/core/schema.ts';
import { generateChart } from '../src/generate/index.ts';
import { simulateAllPerfect, simulateNoInput } from '../src/chartPlay/allPerfect.ts';
import { readEditorHints } from '../src/chartPlay/editorHints.ts';
import { noteIdsForDifficulty } from '../src/chartPlay/noteIds.ts';
import { PlayChartError, toPlayChart } from '../src/chartPlay/toPlayChart.ts';
import { GAME_CONFIG } from '../src/play/core/config/gameConfig.ts';
import { JudgeEngine, gradeFromDelta, holdTickCount, holdTickIntervalMs } from '../src/play/core/rules/judge/judgeEngine.ts';
import { RhythmSession } from '../src/play/core/rules/session/rhythmSession.ts';
import type { ChartNote } from '../src/play/core/chart/types.ts';
import { applyInputDelayRate, clampRate, leadInStartMs, planStart, playEndMs, songMsFromContext } from '../src/play/playClock.ts';
import { keyLabel, ruleDifficulty } from '../src/play/playController.ts';
import { RunStats, toPlayResult } from '../src/play/playResult.ts';
import { gameConfigFromSettings } from '../src/play/playSettings.ts';
import { DEFAULT_APP_SETTINGS } from '../src/storage/settingsStore.ts';
import { makeSyntheticDrums } from '../tools/lib.ts';

const cfg = GAME_CONFIG;

/** 테스트용 노트 만들기 */
function tap(timeMs: number, lane: 0 | 1 = 0): ChartNote {
  return { type: 'tap', lane, timeMs, durationMs: 0, count: 0 };
}
function hold(timeMs: number, durationMs: number, lane: 0 | 1 = 0): ChartNote {
  return { type: 'hold', lane, timeMs, durationMs, count: 0 };
}
function burst(timeMs: number, durationMs: number, count: number): ChartNote {
  return { type: 'burst', lane: 'both', timeMs, durationMs, count };
}

/** 합성 드럼 곡을 분석해 난이도별 채보(편집기 채보 v2)를 만든다. 노트 종류가 골고루 들어가도록 연타 허용 */
async function makeCharts(): Promise<Array<{ name: string; chart: ChartV2 }>> {
  const synth = makeSyntheticDrums({ bpm: 120, seconds: 60, startMs: 300 });
  const analysis: AnalysisResult = { ...(await analyzeAudio(synth.samples, {})), song: '합성곡' };
  const sets = [
    { name: 'NORMAL', options: { difficulty: 'NORMAL' } },
    { name: 'EASY', options: { difficulty: 'EASY', design_mode: 'reference' } },
    { name: 'HARD', options: { difficulty: 'HARD', design_mode: 'unified', allow_burst: true } },
  ] as const;
  return sets.map((s) => ({ name: s.name, chart: generateChart(analysis, s.options as never).chart }));
}

describe('편집기 채보 → 게임 채보 변환 (toPlayChart)', () => {
  it('겹친 노트는 안내와 함께 게임 테스트에 남긴다', () => {
    const chart = buildSampleChart();
    const difficulty = chart.difficulties[0]!;
    const first = difficulty.notes.find((note) => note.type === 'tap')!;
    const duplicate = { ...first, id: Math.max(...difficulty.notes.map((note) => note.id)) + 1 };
    difficulty.notes.push(duplicate);

    const ids = noteIdsForDifficulty(chart, difficulty.name)!;
    const built = toPlayChart(buildUnityData(chart), difficulty.name, { noteIds: ids });
    expect(built.notes).toHaveLength(difficulty.notes.length);
    expect(built.noteIds).toContain(duplicate.id);
    expect(built.warnings).toContainEqual(expect.stringContaining('노트 겹침'));
  });

  it('레인 값이 잘못된 노트만 빼고 남은 노트의 편집기 번호를 유지한다', () => {
    const chart = buildSampleChart();
    const name = chart.difficulties[0]!.name;
    const unity = buildUnityData(chart);
    const ids = noteIdsForDifficulty(chart, name)!;
    unity.difficulties[0]!.notes[0]!.lane = 99;

    const built = toPlayChart(unity, name, { noteIds: ids });
    expect(built.noteIds).toEqual(ids.slice(1));
    expect(built.warnings).toContainEqual(expect.stringContaining('노트 1개를 테스트에서 제외'));
  });

  it('샘플 채보: 노트 수와 시각(ms)이 내보내기 결과와 완전히 같다', () => {
    const chart = buildSampleChart();
    const name = chart.difficulties[0]!.name;
    const unity = exportUnity(chart, name);
    const built = toPlayChart(unity, name);
    const src = unity.difficulties[0]!.notes;
    expect(built.notes.length).toBe(src.length);
    expect(built.notes.map((n) => n.timeMs)).toEqual(src.map((n) => n.time_ms));
    expect(built.notes.map((n) => n.durationMs)).toEqual(src.map((n) => n.duration_ms));
    expect(built.notes.map((n) => n.type)).toEqual(src.map((n) => n.type));
    expect(built.droppedBeforeStart).toBe(0);
  });

  it('생성된 채보 3종: 변환 뒤 노트 수·시각 일치, 편집기 노트 번호가 같은 순서로 이어진다', async () => {
    for (const { name, chart } of await makeCharts()) {
      const unity = exportUnity(chart, name);
      const ids = noteIdsForDifficulty(chart, name)!;
      expect(ids.length).toBe(unity.difficulties[0]!.notes.length);
      const built = toPlayChart(unity, name, { noteIds: ids });
      expect(built.notes.length).toBe(ids.length);
      expect(built.noteIds).toEqual(ids);
      // 편집기 채보의 각 노트(id) 시각을 직접 계산해 게임 노트와 맞춰 본다
      const map = new BpmMap(chart.timing.bpm_map, chart.timing.resolution);
      const offset = (chart.song.audio_offset_ms || 0) + (chart.song.decoder_delay_ms || 0);
      const byId = new Map(allNotes(chart, name).map((n) => [n.id, n]));
      built.notes.forEach((note, i) => {
        const original = byId.get(ids[i]!)!;
        expect(note.timeMs).toBe(Math.round(ticksToMs(original.tick, map) + offset));
        expect(note.type).toBe(original.type);
      });
    }
  });

  it('곡 시작 전(음수 시간) 노트는 빼고 쉬운 한국어로 알린다', () => {
    const chart = buildSampleChart();
    const name = chart.difficulties[0]!.name;
    const unity = exportUnity(chart, name);
    unity.difficulties[0]!.notes[0]!.time_ms = -50;
    const built = toPlayChart(unity, name);
    expect(built.droppedBeforeStart).toBe(1);
    expect(built.notes.length).toBe(unity.difficulties[0]!.notes.length - 1);
    expect(built.warnings.some((w) => w.includes('곡이 시작되기 전'))).toBe(true);
  });

  it('startMs 앞의 노트는 빼고, 번호도 같은 순서로 남는다', () => {
    const chart = buildSampleChart();
    const name = chart.difficulties[0]!.name;
    const unity = exportUnity(chart, name);
    const ids = noteIdsForDifficulty(chart, name)!;
    const all = toPlayChart(unity, name, { noteIds: ids });
    const mid = all.notes[Math.floor(all.notes.length / 2)]!.timeMs;
    const part = toPlayChart(unity, name, { noteIds: ids, startMs: mid });
    expect(part.notes.every((n) => n.timeMs >= mid)).toBe(true);
    expect(part.notes.length).toBeLessThan(all.notes.length);
    expect(part.noteIds).toEqual(ids.slice(all.notes.length - part.notes.length));
    expect(() => toPlayChart(unity, name, { startMs: 10_000_000 })).toThrow(PlayChartError);
  });

  it('형식이 다르거나 노트가 없으면 쉬운 한국어 오류', () => {
    const chart = buildSampleChart();
    const name = chart.difficulties[0]!.name;
    const unity = exportUnity(chart, name);
    expect(() => toPlayChart({ ...unity, format: 'other' }, name)).toThrow('형식');
    expect(() => toPlayChart({ ...unity, difficulties: [] }, name)).toThrow('난이도');
    const empty = { ...unity, difficulties: [{ name, level: 1, notes: [] }] };
    expect(() => toPlayChart(empty, name)).toThrow('노트가 하나도');
  });

  it('요청한 난이도가 없으면 첫 난이도를 쓴다', () => {
    const chart = buildSampleChart();
    const unity = exportUnity(chart);
    const built = toPlayChart(unity, 'NOPE');
    expect(built.difficulty).toBe(unity.difficulties[0]!.name.toUpperCase());
  });
});

describe('편집기 상태 읽기 (readEditorHints)', () => {
  it('편집기가 없으면 모르는 값으로 채운다', () => {
    const h = readEditorHints('NORMAL', {});
    expect(h).toEqual({ bpm: null, beatOriginMs: 0, noteIds: null, positionMs: null });
  });
  it('편집기가 있으면 BPM·박 시작·노트 번호·위치를 읽는다', () => {
    const chart = buildSampleChart();
    const name = chart.difficulties[0]!.name;
    chart.song.audio_offset_ms = -120;
    chart.song.decoder_delay_ms = 20;
    const h = readEditorHints(name, { __editor: () => ({ A: { audio: { position: 4321 } }, S: { chart } }) });
    expect(h.bpm).toBe(120);
    expect(h.beatOriginMs).toBe(-100);
    expect(h.positionMs).toBe(4321);
    expect(h.noteIds!.length).toBe(chart.difficulties[0]!.notes.length);
  });
  it('편집기 함수가 오류를 던져도 안전하다', () => {
    const h = readEditorHints('NORMAL', { __editor: () => { throw new Error('x'); } });
    expect(h.bpm).toBeNull();
  });
});

describe('판정 규칙: 판정 폭·롱노트 틱·연타 (원본 규칙 그대로)', () => {
  it('판정 폭: perfect 45 / great 95 / good 150 / bad 200 / 그 밖 miss', () => {
    const j = cfg.judge;
    expect(gradeFromDelta(45, j)).toBe('perfect');
    expect(gradeFromDelta(46, j)).toBe('great');
    expect(gradeFromDelta(95, j)).toBe('great');
    expect(gradeFromDelta(96, j)).toBe('good');
    expect(gradeFromDelta(150, j)).toBe('good');
    expect(gradeFromDelta(151, j)).toBe('bad');
    expect(gradeFromDelta(200, j)).toBe('bad');
    expect(gradeFromDelta(201, j)).toBe('miss');
  });

  it('롱노트 틱: 간격 = 60000÷BPM÷4(최소 50ms), 틱 개수는 길이 안에 들어가는 수', () => {
    expect(holdTickIntervalMs(120, cfg.judge)).toBe(125);
    expect(holdTickIntervalMs(1000, cfg.judge)).toBe(50);
    expect(holdTickCount(1000, 125)).toBe(8);
    expect(holdTickCount(1000, 300)).toBe(3);
    expect(holdTickCount(100, 125)).toBe(0);
  });

  it('롱노트: 눌러서 끝까지 잡으면 시작 판정 + 틱 + 완료, 비중 합이 1', () => {
    const engine = new JudgeEngine([hold(1000, 500)], cfg.judge, 125);
    const events = [...engine.pressLane(0, 1000), ...engine.advance(1600), ...engine.releaseLane(0, 1500)];
    const started = events.filter((e) => e.kind === 'holdStarted');
    const ticks = events.filter((e) => e.kind === 'holdTick');
    const done = events.filter((e) => e.kind === 'resolved');
    expect(started.length).toBe(1);
    expect(ticks.length).toBe(4);
    expect(done.length).toBe(1);
    expect(done[0]!.weight).toBe(0);
    const total = [...started, ...ticks].reduce((sum, e) => sum + e.weight, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it('롱노트: 95% 지점 전에 떼면 MISS 한 번', () => {
    const engine = new JudgeEngine([hold(1000, 1000)], cfg.judge, 125);
    engine.pressLane(0, 1000);
    const events = engine.releaseLane(0, 1500);
    const done = events.filter((e) => e.kind === 'resolved');
    expect(done.length).toBe(1);
    expect(done[0]!.grade).toBe('miss');
  });

  it('롱노트: 95% 지점 이후에 떼면 정상 완료', () => {
    const engine = new JudgeEngine([hold(1000, 1000)], cfg.judge, 125);
    engine.pressLane(0, 1000);
    const events = engine.releaseLane(0, 1960);
    expect(events.find((e) => e.kind === 'resolved')!.grade).toBe('perfect');
  });

  it('연타: 구간 안에서 필요한 횟수를 두 레인 합쳐 세면 성공(great), 모자라면 miss', () => {
    const ok = new JudgeEngine([burst(1000, 800, 4)], cfg.judge, 125);
    for (let i = 0; i < 4; i += 1) {
      ok.pressLane((i % 2) as 0 | 1, 1100 + i * 100);
      ok.releaseLane((i % 2) as 0 | 1, 1130 + i * 100);
    }
    const okEvents = ok.advance(2000);
    expect(okEvents.find((e) => e.kind === 'resolved')!.grade).toBe('great');

    const bad = new JudgeEngine([burst(1000, 800, 4)], cfg.judge, 125);
    bad.pressLane(0, 1100);
    bad.releaseLane(0, 1130);
    expect(bad.advance(2000).find((e) => e.kind === 'resolved')!.grade).toBe('miss');
  });

  it('연타 끝 시각에 딱 맞닿은 롱노트·단타의 정확한 입력은 연타로 세지 않는다(웹 버전 수정)', () => {
    const engine = new JudgeEngine([burst(1000, 2000, 3), hold(3000, 250, 0)], cfg.judge, 125);
    for (let i = 0; i < 3; i += 1) {
      engine.pressLane((i % 2) as 0 | 1, 1200 + i * 500);
      engine.releaseLane((i % 2) as 0 | 1, 1230 + i * 500);
    }
    const events = [...engine.pressLane(0, 3000), ...engine.releaseLane(0, 3250), ...engine.advance(4000)];
    const burstDone = events.find((e) => e.kind === 'resolved' && e.noteType === 'burst');
    const holdDone = events.find((e) => e.kind === 'resolved' && e.noteType === 'hold');
    expect(burstDone?.grade).toBe('great');
    expect(holdDone?.grade).toBe('perfect');
  });

  it('단타: 놓친 노트는 노트 시간 + 200ms 뒤 자동 miss', () => {
    const engine = new JudgeEngine([tap(1000)], cfg.judge);
    expect(engine.advance(1199)).toEqual([]);
    const events = engine.advance(1201);
    expect(events.length).toBe(1);
    expect(events[0]!.grade).toBe('miss');
  });

  it('같은 레인 키를 누른 채 반복 입력해도 한 번만 센다', () => {
    const engine = new JudgeEngine([tap(1000), tap(1100)], cfg.judge);
    const a = engine.pressLane(0, 1000);
    const b = engine.pressLane(0, 1010);
    expect(a.length).toBe(1);
    expect(b.length).toBe(0);
  });
});

describe('점수·실패 규칙', () => {
  const notes = [tap(1000, 0), tap(1500, 1), hold(2000, 500, 0), burst(3000, 800, 4), tap(4200, 1)];

  it('전부 정확히 치면 만점 1,000,000 · 랭크 S · 부정수치 0', () => {
    const r = simulateAllPerfect(notes, 'NORMAL', cfg, 120);
    expect(r.score).toBe(1_000_000);
    expect(r.rank).toBe('S');
    expect(r.negativePercent).toBe(0);
    expect(r.missCount).toBe(0);
  });

  it('등급 가중치: great 0.7 · good 0.4 · bad 0.1 · miss 0', () => {
    const one = [tap(1000)];
    const score = (delta: number): number => {
      const s = new RhythmSession(one, 'NORMAL', cfg, 120);
      s.pressLane(0, 1000 + delta);
      s.finish();
      return s.result().score;
    };
    expect(score(0)).toBe(1_000_000);
    expect(score(60)).toBeCloseTo(700_000, 3);
    expect(score(120)).toBeCloseTo(400_000, 3);
    expect(score(180)).toBeCloseTo(100_000, 3);
    expect(score(400)).toBe(0);
  });

  it('무입력: 부정수치 100% 로 실패하고 점수 0', () => {
    const many = Array.from({ length: 40 }, (_, i) => tap(1000 + i * 400, (i % 2) as 0 | 1));
    const r = simulateNoInput(many, 'NORMAL', cfg, 120);
    expect(r.failed).toBe(true);
    expect(r.cleared).toBe(false);
    expect(r.score).toBe(0);
  });

  it('연습 모드(실패 없음): 무입력이어도 끝까지 진행되고 모든 노트가 MISS 로 센다', () => {
    const practice = structuredClone(cfg);
    practice.negative.failPercent = Number.POSITIVE_INFINITY;
    const r = simulateNoInput(notes, 'NORMAL', practice, 120);
    expect(r.failed).toBe(false);
    expect(r.missCount).toBe(notes.length);
    expect(r.totalNotes).toBe(notes.length);
  });

  it('원본 규칙(practice: false): 부정수치 100% 이면 그 뒤 입력은 무시된다', () => {
    const many = Array.from({ length: 30 }, (_, i) => tap(1000 + i * 400, (i % 2) as 0 | 1));
    const s = new RhythmSession(many, 'NORMAL', cfg, 120);
    s.advance(20000);
    expect(s.snapshot(20000).failed).toBe(true);
    expect(s.pressLane(0, 20010)).toEqual([]);
  });

  it('난이도 이름: EASY/HARD 외에는 NORMAL 규칙', () => {
    expect(ruleDifficulty('easy')).toBe('EASY');
    expect(ruleDifficulty('HARD')).toBe('HARD');
    expect(ruleDifficulty('ALL')).toBe('NORMAL');
  });
});

describe('올 퍼펙트·무입력 시뮬레이션: 편집기가 만든 채보 3종', () => {
  it('올 퍼펙트: 모든 노트 성공·MISS 0·클리어. 연타 없는 채보는 정확히 만점', async () => {
    for (const { name, chart } of await makeCharts()) {
      const built = toPlayChart(exportUnity(chart, name), name);
      expect(built.notes.length).toBeGreaterThan(20);
      const bpm = chart.timing.bpm_map[0]!.bpm;
      const bursts = built.notes.filter((n) => n.type === 'burst').length;
      const perfect = simulateAllPerfect(built.notes, name as 'EASY', cfg, bpm);
      expect(perfect.missCount).toBe(0);
      expect(perfect.failed).toBe(false);
      expect(perfect.cleared).toBe(true);
      // 원본 규칙: 연타는 성공해도 GREAT 이라 PERFECT 로 세지 않는다
      expect(perfect.perfectCount).toBe(built.notes.length - bursts);
      expect(perfect.score).toBeLessThanOrEqual(1_000_000);
      if (bursts === 0) expect(perfect.score).toBe(1_000_000);
      // 연타를 뺀 같은 채보는 정확히 만점
      const noBurst = built.notes.filter((n) => n.type !== 'burst');
      const full = simulateAllPerfect(noBurst, name as 'EASY', cfg, bpm);
      expect(full.score).toBe(1_000_000);
      expect(full.perfectCount).toBe(noBurst.length);
    }
  });

  it('무입력: 부정수치 100% 로 실패하고 점수 0, 연습 모드에서는 전부 MISS 로 끝까지 센다', async () => {
    for (const { name, chart } of await makeCharts()) {
      const built = toPlayChart(exportUnity(chart, name), name);
      const bpm = chart.timing.bpm_map[0]!.bpm;
      const none = simulateNoInput(built.notes, name as 'EASY', cfg, bpm);
      expect(none.failed).toBe(true);
      expect(none.score).toBe(0);
      const practice = structuredClone(cfg);
      practice.negative.failPercent = Number.POSITIVE_INFINITY;
      const all = simulateNoInput(built.notes, name as 'EASY', practice, bpm);
      expect(all.failed).toBe(false);
      expect(all.missCount).toBe(built.notes.length);
      expect(all.perfectCount).toBe(0);
    }
  });

  it('노트 종류가 단타·롱노트를 포함한다', async () => {
    const types = new Set<string>();
    for (const { name, chart } of await makeCharts()) {
      for (const n of toPlayChart(exportUnity(chart, name), name).notes) types.add(n.type);
    }
    expect(types.has('tap')).toBe(true);
    expect(types.has('hold')).toBe(true);
  });
});

describe('입력 지연 보정', () => {
  it('설정의 입력 지연(+30)이면 30ms 늦게 눌러도 정확한 판정이 난다', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, inputDelayMs: 30 };
    const config = gameConfigFromSettings(settings);
    expect(config.timing.inputDelayMs).toBe(30);
    const raw = 1000 + 30; // 실제로 눌린 곡 시간
    const corrected = applyInputDelayRate(raw, config.timing.inputDelayMs, 1);
    expect(corrected).toBe(1000);
    const s = new RhythmSession([tap(1000)], 'NORMAL', config, 120);
    s.pressLane(0, corrected);
    s.finish();
    expect(s.result().gradeCounts.perfect).toBe(1);
  });

  it('느린 재생(0.5배)에서는 곡 시간으로 rate 배만큼만 보정한다(지연은 실제 시간이므로)', () => {
    expect(applyInputDelayRate(1000, 40, 0.5)).toBe(980);
    expect(applyInputDelayRate(1000, 40, 1.25)).toBe(950);
    expect(applyInputDelayRate(1000, -40, 1)).toBe(1040);
  });

  it('설정이 같은 값으로 게임 수치에 들어간다(키·낙하 시간·음악 볼륨)', () => {
    const config = gameConfigFromSettings({ ...DEFAULT_APP_SETTINGS, inputDelayMs: -12, fallTimeMs: 1500, musicVolume: 55, keys: { left: 'KeyD', right: 'KeyK' } });
    expect(config.timing.inputDelayMs).toBe(-12);
    expect(config.timing.fallTimeMs).toBe(1500);
    expect(config.input.keyLeft).toBe('KeyD');
    expect(config.input.keyRight).toBe('KeyK');
    expect(config.audio.musicVolume).toBe(55);
    // 기본 수치 원본은 바뀌지 않는다
    expect(GAME_CONFIG.timing.inputDelayMs).toBe(0);
  });
});

describe('재생 시계: startMs · rate 계산', () => {
  it('rate 는 0.5~1.25 로 맞춘다', () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(3)).toBe(1.25);
    expect(clampRate(0.75)).toBe(0.75);
    expect(clampRate(undefined)).toBe(1);
    expect(clampRate(Number.NaN)).toBe(1);
  });

  it('곡 중간(5000ms)부터 시작: 음원 위치 5초, 시작 시각의 곡 시간이 5000ms', () => {
    const plan = planStart(5000, 1, 0, 10, 0.1);
    expect(plan.bufferOffsetSec).toBe(5);
    expect(plan.startContextSec).toBeCloseTo(10.1, 9);
    expect(songMsFromContext(plan.startContextSec, plan.zeroContextSec, 1, 0)).toBeCloseTo(5000, 6);
    expect(songMsFromContext(plan.startContextSec + 2, plan.zeroContextSec, 1, 0)).toBeCloseTo(7000, 6);
  });

  it('0.5배: 실제 2초가 지나면 곡은 1초(1000ms)만 흐른다', () => {
    const plan = planStart(4000, 0.5, 0, 0, 0.1);
    expect(songMsFromContext(plan.startContextSec, plan.zeroContextSec, 0.5, 0)).toBeCloseTo(4000, 6);
    expect(songMsFromContext(plan.startContextSec + 2, plan.zeroContextSec, 0.5, 0)).toBeCloseTo(5000, 6);
  });

  it('1.25배: 실제 2초가 지나면 곡은 2.5초 흐른다', () => {
    const plan = planStart(0, 1.25, 0, 0, 0.1);
    expect(songMsFromContext(plan.startContextSec + 2, plan.zeroContextSec, 1.25, 0)).toBeCloseTo(2500, 6);
  });

  it('곡 시작 전(음수)에서 시작: 처음부터 재생하되 실제 시간으로 rate 로 나눈 만큼 기다린다', () => {
    const plan = planStart(-1800, 0.5, 0, 0, 0.1);
    expect(plan.bufferOffsetSec).toBe(0);
    expect(plan.startContextSec).toBeCloseTo(0.1 + 3.6, 9);
    expect(songMsFromContext(plan.startContextSec, plan.zeroContextSec, 0.5, 0)).toBeCloseTo(0, 6);
    expect(songMsFromContext(0.1, plan.zeroContextSec, 0.5, 0)).toBeCloseTo(-1800, 6);
  });

  it('음원 시작 보정(audioStartOffsetMs)이 있으면 곡 시간이 그만큼 작아진다', () => {
    const plan = planStart(1000, 1, 50, 0, 0.1);
    expect(songMsFromContext(plan.startContextSec, plan.zeroContextSec, 1, 50)).toBeCloseTo(1000, 6);
  });

  it('시작 위치보다 낙하 시간만큼 먼저 시작하고, 끝은 마지막 노트 뒤', () => {
    expect(leadInStartMs(0, 1800)).toBe(-1800);
    expect(leadInStartMs(20000, 1500)).toBe(18500);
    expect(playEndMs([tap(1000), hold(2000, 700)], 800)).toBe(3500);
    expect(playEndMs([], 800)).toBe(800);
  });
});

describe('결과 모으기 (RunStats)', () => {
  const notes = [tap(1000, 0), tap(1500, 1), hold(2000, 400, 0), tap(3000, 1), burst(4000, 600, 4)];
  const ids = [11, 12, 13, 14, null];

  it('평균 오차(빠름/느림)·MISS 목록(편집기 노트 번호 포함)을 모은다', () => {
    const session = new RhythmSession(notes, 'NORMAL', structuredClone(cfg), 120);
    const stats = new RunStats(notes, ids);
    const feed = (events: ReturnType<RhythmSession['pressLane']>): void => events.forEach((e) => stats.add(e));
    feed(session.pressLane(0, 980)); // 20ms 빠름
    feed(session.releaseLane(0, 990));
    feed(session.pressLane(1, 1540)); // 40ms 느림
    feed(session.releaseLane(1, 1550));
    feed(session.pressLane(0, 2000)); // 롱노트 정확히
    feed(session.releaseLane(0, 2400));
    // 3000 단타는 치지 않음 → MISS, 연타도 치지 않음 → MISS
    feed(session.advance(5000));
    feed(session.finish());
    const summary = stats.summarize(session.result());
    expect(summary.meanErrorMs).toBeCloseTo((-20 + 40 + 0) / 3, 6);
    expect(summary.earlyCount).toBe(1);
    expect(summary.lateCount).toBe(1);
    expect(summary.earlyMeanMs).toBe(-20);
    expect(summary.lateMeanMs).toBe(40);
    expect(summary.missList.map((m) => [m.noteId, m.timeMs, m.type])).toEqual([
      [14, 3000, 'tap'],
      [-1, 4000, 'burst'],
    ]);
    expect(summary.counts.miss).toBe(2);
    expect(summary.totalNotes).toBe(5);
    const result = toPlayResult(summary);
    expect(result.counts).toEqual(summary.counts);
    expect(result.missList[0]).toEqual({ noteId: 14, timeMs: 3000, type: 'tap' });
    expect(result.maxCombo).toBeGreaterThanOrEqual(3);
  });

  it('치지 않으면 평균 오차는 0, 올 퍼펙트면 MISS 목록이 비어 있다', () => {
    const none = new RunStats(notes, ids);
    const s1 = new RhythmSession(notes, 'NORMAL', structuredClone(cfg), 120);
    s1.finish().forEach((e) => none.add(e));
    expect(none.summarize(s1.result()).meanErrorMs).toBe(0);
    expect(none.summarize(s1.result()).missList.length).toBe(5);
  });
});

describe('작은 도구', () => {
  it('키 이름을 짧게 보여 준다', () => {
    expect(keyLabel('KeyS')).toBe('S');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('Numpad4')).toBe('숫자 4');
  });
});
