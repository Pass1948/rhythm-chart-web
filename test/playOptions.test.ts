// 04b 게임 플레이 옵션 자동 점검 (브라우저 없이 규칙·보관소·소리 연결을 확인)
// ① 판정 폭·점수 비율 검증/복구 ② +60ms 입력이 프리셋에 따라 등급이 바뀜 ③ 점수 비율 변경, 기본값 회귀
// ④ 연타 GREAT 고정 올 퍼펙트 ⑤ 볼륨 곡선·음소거·저장·복원·효과음/음악 게인 갱신 ⑥ 인접 노트 겹침 판정
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, type GameConfig } from '../src/play/core/config/gameConfig.ts';
import { JudgeEngine } from '../src/play/core/rules/judge/judgeEngine.ts';
import { RhythmSession } from '../src/play/core/rules/session/rhythmSession.ts';
import type { ChartNote } from '../src/play/core/chart/types.ts';
import { simulateAllPerfect } from '../src/chartPlay/allPerfect.ts';
import { buildInputs, runInputs } from '../src/play/core/testing/simulate.ts';
import {
  JUDGE_MS_LIMITS,
  VOLUME_CONFIG,
  adjustJudgeMsField,
  adjustWeightField,
  applyPlayJudgeToConfig,
  applyPreset,
  defaultPlayJudge,
  describePlayJudge,
  fitJudgeMs,
  isDefaultPlayJudge,
  judgePresets,
  musicGainOf,
  presetOf,
  sanitizePlayJudge,
  sfxLevelOf,
  validateJudgeMs,
  validateJudgeWeights,
  validatePlayJudge,
  volumeGain,
  type PlayJudgeOptions,
} from '../src/play/playOptions.ts';
import { JudgeStore, VolumeStore, type OptionsIo } from '../src/play/playOptionsStore.ts';
import { SegmentPlayer } from '../src/play/segmentPlayer.ts';
import { SfxPlayer } from '../src/play/sfx.ts';
import { gameConfigFromSettings } from '../src/play/playSettings.ts';
import { DEFAULT_APP_SETTINGS, loadSettings, loadSettingsWithNotes, saveSettings, SETTINGS_KEY, type KeyValueStorage } from '../src/storage/settingsStore.ts';

function tap(timeMs: number, lane: 0 | 1 = 0): ChartNote {
  return { type: 'tap', lane, timeMs, durationMs: 0, count: 0 };
}
function hold(timeMs: number, durationMs: number, lane: 0 | 1 = 0): ChartNote {
  return { type: 'hold', lane, timeMs, durationMs, count: 0 };
}
function burst(timeMs: number, durationMs: number, count: number): ChartNote {
  return { type: 'burst', lane: 'both', timeMs, durationMs, count };
}

/** 설정을 적용한 게임 수치 복사본 */
function configWith(judge: PlayJudgeOptions): GameConfig {
  const c = structuredClone(GAME_CONFIG);
  applyPlayJudgeToConfig(c, judge);
  return c;
}

/** 메모리 저장소 */
function memStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** 메모리 입출력 (보관소 시험용) */
function memIo(): OptionsIo & { saved: unknown[]; state: { musicVolume: number; sfxVolume: number; playJudge: PlayJudgeOptions } } {
  const state = { musicVolume: 80, sfxVolume: 80, playJudge: defaultPlayJudge() };
  const saved: unknown[] = [];
  return {
    saved,
    state,
    load: () => ({ ...state, playJudge: state.playJudge }),
    save: (patch) => {
      saved.push(patch);
      Object.assign(state, patch);
    },
  };
}

describe('판정 설정 검증·복구', () => {
  it('원본 기본값은 45/95/150/200 · 100/70/40/10/0 이고 검증을 통과한다', () => {
    const d = defaultPlayJudge();
    expect([d.perfectMs, d.greatMs, d.goodMs, d.badMs]).toEqual([45, 95, 150, 200]);
    expect(d.weights).toEqual({ perfect: 100, great: 70, good: 40, bad: 10, miss: 0 });
    expect('burstGrade' in d).toBe(false); // 04c: 연타 성공 등급 설정은 없다
    expect(validatePlayJudge(d)).toEqual([]);
    expect(isDefaultPlayJudge(d)).toBe(true);
    expect(describePlayJudge(d)).toBeNull();
  });

  it('프리셋 3종은 모두 범위·순서·간격 검증을 통과하고, 어느 프리셋인지 되알아낸다', () => {
    for (const p of judgePresets()) {
      expect(validateJudgeMs(p.ms)).toEqual([]);
      expect(validateJudgeWeights(p.weights)).toEqual([]);
    }
    const base = defaultPlayJudge();
    expect(presetOf(applyPreset(base, 'strict'))).toBe('strict');
    expect(presetOf(applyPreset(base, 'loose'))).toBe('loose');
    expect(presetOf(applyPreset(applyPreset(base, 'loose'), 'original'))).toBe('original');
    const strict = applyPreset(base, 'strict');
    expect([strict.perfectMs, strict.greatMs, strict.goodMs, strict.badMs]).toEqual([30, 65, 100, 140]);
    expect([strict.weights.perfect, strict.weights.great, strict.weights.good, strict.weights.bad]).toEqual([100, 60, 30, 5]);
    const loose = applyPreset(base, 'loose');
    expect([loose.perfectMs, loose.greatMs, loose.goodMs, loose.badMs]).toEqual([60, 120, 180, 240]);
    expect([loose.weights.great, loose.weights.good, loose.weights.bad]).toEqual([80, 50, 20]);
    // 값을 하나라도 고치면 '직접'
    const custom = adjustJudgeMsField(base, 'perfectMs', 50).judge;
    expect(presetOf(custom)).toBe('custom');
  });

  it('폭 검증: 범위를 벗어나면 안내, PERFECT < GREAT < GOOD < BAD 이고 5ms 간격', () => {
    const ok = { perfectMs: 45, greatMs: 95, goodMs: 150, badMs: 200 };
    expect(validateJudgeMs(ok)).toEqual([]);
    expect(validateJudgeMs({ ...ok, perfectMs: 5 }).join(' ')).toMatch(/PERFECT 폭은 10~80ms/);
    expect(validateJudgeMs({ ...ok, badMs: 300 }).join(' ')).toMatch(/BAD 폭은 100~260ms/);
    expect(validateJudgeMs({ ...ok, greatMs: 48 }).join(' ')).toMatch(/GREAT 폭은 PERFECT 폭보다 5ms 이상/);
    expect(validateJudgeMs({ ...ok, greatMs: 45 }).length).toBeGreaterThan(0);
    expect(validateJudgeMs({ perfectMs: 80, greatMs: 85, goodMs: 90, badMs: 95 }).join(' ')).toMatch(/BAD 폭은 100~260ms/);
    expect(JUDGE_MS_LIMITS.perfectMs).toEqual({ min: 10, max: 80 });
  });

  it('폭 하나를 직접 고치면 앞뒤 단계와의 간격까지 지켜서 가까운 값으로 맞추고 한국어로 알린다', () => {
    const d = defaultPlayJudge();
    const a = adjustJudgeMsField(d, 'perfectMs', 500);
    expect(a.judge.perfectMs).toBe(80);
    expect(a.note).toMatch(/10~80ms/);
    const b = adjustJudgeMsField(d, 'greatMs', 46);
    expect(b.judge.greatMs).toBe(50);
    expect(b.note).toMatch(/PERFECT 폭보다 5ms 이상 커야/);
    const c = adjustJudgeMsField(d, 'goodMs', 96);
    expect(c.judge.goodMs).toBe(100);
    const e = adjustJudgeMsField(d, 'perfectMs', 120);
    expect(e.judge.perfectMs).toBe(80);
    const f = adjustJudgeMsField(d, 'perfectMs', 90 - 45 + 45 - 5); // 85-?: 범위 안이지만 GREAT(95)와 5ms 이상 떨어져야 한다
    expect(f.judge.perfectMs).toBe(80);
    const g = adjustJudgeMsField({ ...d, greatMs: 60 }, 'perfectMs', 70);
    expect(g.judge.perfectMs).toBe(55);
    expect(g.note).toMatch(/GREAT 폭보다 5ms 이상 작아야/);
    const ok = adjustJudgeMsField(d, 'greatMs', 100);
    expect(ok.note).toBeNull();
    expect(ok.judge.greatMs).toBe(100);
    expect(validatePlayJudge(ok.judge)).toEqual([]);
  });

  it('점수 비율: PERFECT 100·MISS 0 고정, GREAT ≥ GOOD ≥ BAD, 0~100', () => {
    const d = defaultPlayJudge();
    expect(validateJudgeWeights({ ...d.weights, perfect: 90 }).join(' ')).toMatch(/PERFECT 점수 비율은 100%/);
    expect(validateJudgeWeights({ ...d.weights, miss: 5 }).join(' ')).toMatch(/MISS 점수 비율은 0%/);
    expect(validateJudgeWeights({ ...d.weights, good: 80 }).join(' ')).toMatch(/순서/);
    expect(validateJudgeWeights({ ...d.weights, great: 130 }).length).toBeGreaterThan(0);
    const a = adjustWeightField(d, 'great', 120);
    expect(a.judge.weights.great).toBe(100);
    expect(a.note).toMatch(/0~100%/);
    const b = adjustWeightField(d, 'great', 30);
    expect(b.judge.weights.great).toBe(40); // GOOD(40)보다 작아질 수 없다
    expect(b.note).toMatch(/순서/);
    const c = adjustWeightField(d, 'bad', 55);
    expect(c.judge.weights.bad).toBe(40);
    const ok = adjustWeightField(d, 'good', 50);
    expect(ok.note).toBeNull();
    expect(ok.judge.weights).toEqual({ perfect: 100, great: 70, good: 50, bad: 10, miss: 0 });
  });

  it('깨진 저장값·범위 밖 값은 기본값/가까운 값으로 복구하고 안내한다', () => {
    expect(sanitizePlayJudge(undefined)).toEqual({ value: defaultPlayJudge(), notes: [] });
    const broken = sanitizePlayJudge('엉망');
    expect(broken.value).toEqual(defaultPlayJudge());
    expect(broken.notes.length).toBe(1);
    const out = sanitizePlayJudge({ perfectMs: 500, greatMs: 5, goodMs: 'x', badMs: 9999, weights: { perfect: 50, great: 300, good: 90, bad: -4, miss: 20 }, burstGrade: 'perfect' });
    expect(validatePlayJudge(out.value)).toEqual([]);
    expect(out.value.weights.perfect).toBe(100);
    expect(out.value.weights.miss).toBe(0);
    expect('burstGrade' in out.value).toBe(false); // 옛 값은 무시
    expect(out.notes.length).toBeGreaterThan(0);
    const fit = fitJudgeMs({ perfectMs: 80, greatMs: 40, goodMs: 70, badMs: 100 }, defaultPlayJudge());
    expect(validateJudgeMs(fit)).toEqual([]);
  });

  it('settingsStore: 저장·불러오기, 깨진 파일 복구 안내, 화면 모드 기본은 화이트', () => {
    expect(DEFAULT_APP_SETTINGS.theme).toBe('light');
    expect(DEFAULT_APP_SETTINGS.sfxVolume).toBe(80);
    expect(DEFAULT_APP_SETTINGS.playJudge).toEqual(defaultPlayJudge());
    const st = memStorage();
    expect(loadSettings(st).playJudge).toEqual(defaultPlayJudge());
    const strict = applyPreset(defaultPlayJudge(), 'strict');
    saveSettings({ playJudge: strict, sfxVolume: 35, musicVolume: 55 }, st);
    const back = loadSettings(st);
    expect(back.playJudge.perfectMs).toBe(30);
    // 옛 저장 파일에 burstGrade 가 들어 있어도 오류 없이 읽히고, 다음 저장 때 사라진다
    st.data.set(SETTINGS_KEY, JSON.stringify({ playJudge: { ...strict, burstGrade: 'perfect' }, sfxVolume: 35 }));
    const legacy = loadSettingsWithNotes(st);
    expect(legacy.notes).toEqual([]);
    expect(legacy.settings.playJudge).toEqual(strict);
    expect('burstGrade' in legacy.settings.playJudge).toBe(false);
    saveSettings({ sfxVolume: 36 }, st);
    expect(String(st.data.get(SETTINGS_KEY))).not.toContain('burstGrade');
    saveSettings({ playJudge: strict, sfxVolume: 35, musicVolume: 55 }, st);
    expect(back.sfxVolume).toBe(35);
    expect(back.musicVolume).toBe(55);
    // 깨진 파일
    st.data.set(SETTINGS_KEY, JSON.stringify({ sfxVolume: 900, playJudge: { perfectMs: 1, greatMs: 2, goodMs: 3, badMs: 4, weights: {} } }));
    const fixed = loadSettingsWithNotes(st);
    expect(fixed.settings.sfxVolume).toBe(100);
    expect(validatePlayJudge(fixed.settings.playJudge)).toEqual([]);
    expect(fixed.notes.length).toBeGreaterThan(0);
    st.data.set(SETTINGS_KEY, '{깨진 json');
    expect(loadSettingsWithNotes(st).settings).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('설정이 게임 수치에 들어간다(폭·점수 비율·놓침 시간)', () => {
    const strict = applyPreset(defaultPlayJudge(), 'strict');
    const c = gameConfigFromSettings({ ...DEFAULT_APP_SETTINGS, playJudge: strict, sfxVolume: 33 });
    expect([c.judge.perfectMs, c.judge.greatMs, c.judge.goodMs, c.judge.badMs]).toEqual([30, 65, 100, 140]);
    expect(c.judge.autoMissAfterMs).toBe(140);
    expect('burstSuccessGrade' in c.judge).toBe(false);
    expect(c.scoreWeight).toEqual({ perfect: 1, great: 0.6, good: 0.3, bad: 0.05, miss: 0 });
    expect(c.audio.sfxVolume).toBe(33);
    // 원본 객체는 건드리지 않는다
    expect(GAME_CONFIG.judge.perfectMs).toBe(45);
    expect('burstSuccessGrade' in GAME_CONFIG.judge).toBe(false);
  });
});

describe('판정 등급이 설정에 따라 바뀐다', () => {
  /** 단타 하나를 delta(ms) 늦게 눌렀을 때의 등급 */
  function gradeAt(config: GameConfig, delta: number): string {
    const engine = new JudgeEngine([tap(1000)], config.judge, 125);
    const events = engine.pressLane(0, 1000 + delta);
    return events.find((e) => e.kind === 'resolved')?.grade ?? 'none';
  }

  it('같은 +60ms 입력: 원본 기본에서는 GREAT, 넉넉하게에서는 PERFECT, 엄격에서는 GOOD', () => {
    const base = defaultPlayJudge();
    expect(gradeAt(configWith(base), 60)).toBe('great');
    expect(gradeAt(configWith(applyPreset(base, 'loose')), 60)).toBe('perfect');
    expect(gradeAt(configWith(applyPreset(base, 'strict')), 60)).toBe('great'); // 엄격 GREAT 65ms
    expect(gradeAt(configWith(applyPreset(base, 'strict')), 70)).toBe('good');
    expect(gradeAt(configWith(base), 220)).toBe('miss'); // 원본 BAD 200ms 밖: 이미 놓침으로 확정된 뒤라 판정 등급이 되지 않는다
    expect(gradeAt(configWith(applyPreset(base, 'loose')), 220)).toBe('bad'); // 넉넉하게 BAD 240ms 안
  });

  it('놓침(자동 MISS) 시간도 BAD 폭을 따라간다', () => {
    const loose = configWith(applyPreset(defaultPlayJudge(), 'loose'));
    const engine = new JudgeEngine([tap(1000)], loose.judge, 125);
    expect(engine.advance(1000 + 230)).toEqual([]); // 아직 BAD 폭(240ms) 안
    const late = engine.advance(1000 + 250);
    expect(late.map((e) => e.grade)).toEqual(['miss']);
  });
});

describe('점수 비율·연타 등급', () => {
  const notes = [tap(1000, 0), tap(1500, 1), hold(2000, 500, 0), burst(3000, 800, 4), tap(4200, 1)];

  it('점수 비율을 바꾸면 계산이 기대값과 같다 (GREAT 100% → 만점)', () => {
    const one = [tap(1000)];
    const run = (judge: PlayJudgeOptions, delta: number): number => {
      const s = new RhythmSession(one, 'NORMAL', configWith(judge), 120);
      s.pressLane(0, 1000 + delta);
      s.finish();
      return s.result().score;
    };
    const base = defaultPlayJudge();
    expect(run(base, 60)).toBeCloseTo(700_000, 3);
    const half = adjustWeightField(base, 'great', 100).judge;
    expect(run(half, 60)).toBeCloseTo(1_000_000, 3);
    const strict = applyPreset(base, 'strict');
    expect(run(strict, 40)).toBeCloseTo(600_000, 3); // 엄격: PERFECT 30 < 40 → GREAT 60%
    expect(run(strict, 90)).toBeCloseTo(300_000, 3); // GOOD 30%
    expect(run(strict, 130)).toBeCloseTo(50_000, 3); // BAD 5%
    const loose = applyPreset(base, 'loose');
    expect(run(loose, 100)).toBeCloseTo(800_000, 3); // GREAT 80%
    expect(run(loose, 170)).toBeCloseTo(500_000, 3); // GOOD 50%
  });

  it('회귀: 기본값을 적용한 게임 수치는 원본 수치와 같은 점수·판정 집계를 낸다', () => {
    const deltas = [0, 12, -30, 44, 70, -88, 120, -160, 190, 230, 5, -15];
    const plan = (_note: ChartNote, index: number): number | null => (index === 6 ? null : deltas[index % deltas.length]!);
    const longChart: ChartNote[] = [];
    for (let i = 0; i < 40; i += 1) {
      const t = 1000 + i * 600;
      longChart.push(i % 9 === 4 ? hold(t, 400, (i % 2) as 0 | 1) : i % 13 === 7 ? burst(t, 480, 6) : tap(t, (i % 2) as 0 | 1));
    }
    const a = new RhythmSession(longChart, 'NORMAL', structuredClone(GAME_CONFIG), 120);
    runInputs(a, buildInputs(longChart, plan));
    const b = new RhythmSession(longChart, 'NORMAL', configWith(defaultPlayJudge()), 120);
    runInputs(b, buildInputs(longChart, plan));
    expect(b.result()).toEqual(a.result());
    // 기본값으로 만든 설정은 gameConfigFromSettings 를 거쳐도 같다
    const c = new RhythmSession(longChart, 'NORMAL', gameConfigFromSettings(DEFAULT_APP_SETTINGS), 120);
    runInputs(c, buildInputs(longChart, plan));
    expect(c.result()).toEqual(a.result());
  });

  it('올 퍼펙트: 연타가 있어도 연타 성공은 GREAT 고정이라 기본값 점수가 기존과 같다(피버 없는 조건 94만점, 04b 이전과 동일)', () => {
    const baseline = simulateAllPerfect(notes, 'NORMAL', GAME_CONFIG, 120);
    const viaDefault = simulateAllPerfect(notes, 'NORMAL', configWith(defaultPlayJudge()), 120);
    expect(viaDefault.score).toBe(baseline.score);
    // 피버 보너스(×1.5)가 만점 제한에 가려지지 않도록 피버 배율을 1로 둔 같은 조건에서 연타 한 개의 등급 차이를 본다
    const noFever = (judge: PlayJudgeOptions): GameConfig => {
      const c = configWith(judge);
      c.fever.scoreMultiplier = 1;
      return c;
    };
    const greatBurst = simulateAllPerfect(notes, 'NORMAL', noFever(defaultPlayJudge()), 120);
    expect(greatBurst.score).toBeCloseTo(1_000_000 * (4 / 5) + 1_000_000 * (1 / 5) * 0.7, 3); // 연타 1개만 GREAT(70%) → 940,000
    expect(greatBurst.score).toBeLessThan(1_000_000);
    // 연타는 GREAT 고정: PERFECT 로 치지 않고, 점수 비율의 GREAT 값을 따른다
    expect(greatBurst.perfectCount).toBe(4);
    expect(greatBurst.missCount).toBe(0);
    const j50 = applyPreset(defaultPlayJudge(), 'original');
    j50.weights.great = 50;
    const burst50 = simulateAllPerfect(notes, 'NORMAL', noFever(j50), 120);
    expect(burst50.score).toBeCloseTo(1_000_000 * (4 / 5) + 1_000_000 * (1 / 5) * 0.5, 3);
  });
});

describe('인접 노트가 한 번의 입력에 겹쳐 판정되지 않는다 (가장 가까운 노트 하나만)', () => {
  it('판정 폭이 넓어도 한 번 누르면 가장 가까운 같은 레인 노트 하나만 판정된다', () => {
    const loose = configWith(applyPreset(defaultPlayJudge(), 'loose'));
    const engine = new JudgeEngine([tap(1000), tap(1100), tap(1200)], loose.judge, 125);
    const first = engine.pressLane(0, 1090); // 1100 에 가장 가깝다
    const judged = first.filter((e) => e.kind === 'resolved');
    expect(judged.length).toBe(1);
    expect(judged[0]!.noteIndex).toBe(1);
    expect(judged[0]!.grade).toBe('perfect');
    engine.releaseLane(0, 1100);
    const second = engine.pressLane(0, 1110).filter((e) => e.kind === 'resolved'); // 남은 것 중 1000(Δ110) vs 1200(Δ90) → 1200
    expect(second.length).toBe(1);
    expect(second[0]!.noteIndex).toBe(2);
    engine.releaseLane(0, 1120);
    const third = engine.pressLane(0, 1130).filter((e) => e.kind === 'resolved');
    expect(third.map((e) => e.noteIndex)).toEqual([0]);
  });

  it('다른 레인 노트와는 섞이지 않는다', () => {
    const loose = configWith(applyPreset(defaultPlayJudge(), 'loose'));
    const engine = new JudgeEngine([tap(1000, 0), tap(1010, 1)], loose.judge, 125);
    const ev = engine.pressLane(1, 1005).filter((e) => e.kind === 'resolved');
    expect(ev.map((e) => e.noteIndex)).toEqual([1]);
  });
});

describe('볼륨', () => {
  it('곡선은 (v/100)^2, 0 은 완전 무음, 범위 밖 값은 맞춘다', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(100)).toBe(1);
    expect(volumeGain(50)).toBeCloseTo(0.25, 10);
    expect(volumeGain(80)).toBeCloseTo(0.64, 10);
    expect(volumeGain(-20)).toBe(0);
    expect(volumeGain(500)).toBe(1);
    expect(volumeGain(Number.NaN)).toBe(0);
    expect(VOLUME_CONFIG.smoothSec).toBeCloseTo(0.02, 5);
  });

  it('음소거는 크기를 0 으로, 풀면 이전 값으로 돌아간다', () => {
    const io = memIo();
    const store = new VolumeStore(io);
    expect(store.get()).toEqual({ music: 80, sfx: 80, muted: false });
    store.set({ music: 60, sfx: 40 });
    expect(musicGainOf(store.get())).toBeCloseTo(0.36, 10);
    expect(sfxLevelOf(store.get())).toBeCloseTo(16, 10); // 0.4^2 * 100
    store.toggleMute();
    expect(store.get().muted).toBe(true);
    expect(musicGainOf(store.get())).toBe(0);
    expect(sfxLevelOf(store.get())).toBe(0);
    expect(store.get().music).toBe(60); // 값은 그대로
    store.toggleMute();
    expect(musicGainOf(store.get())).toBeCloseTo(0.36, 10);
    expect(sfxLevelOf(store.get())).toBeCloseTo(16, 10);
  });

  it('저장·복원: 음악은 musicVolume, 효과음은 sfxVolume 으로 저장되고 음소거는 저장하지 않는다', () => {
    const io = memIo();
    const a = new VolumeStore(io);
    const seen: number[] = [];
    const off = a.subscribe((v) => seen.push(v.music));
    a.set({ music: 33 });
    a.set({ sfx: 12 });
    a.set({ muted: true });
    expect(io.saved).toEqual([{ musicVolume: 33 }, { sfxVolume: 12 }]);
    a.set({ music: 999 });
    expect(a.get().music).toBe(100);
    off();
    a.set({ music: 10 });
    expect(seen).toEqual([33, 33, 33, 100]);
    const b = new VolumeStore(io); // 새로 열면 저장된 값
    expect(b.get()).toEqual({ music: 10, sfx: 12, muted: false });
    io.state.musicVolume = 77;
    b.set({ muted: true });
    b.reload(); // 음소거는 유지, 값은 다시 읽음
    expect(b.get()).toEqual({ music: 77, sfx: 12, muted: true });
  });

  it('settingsStore 와 연결: 음악 볼륨은 편집기와 같은 musicVolume, 효과음은 sfxVolume', () => {
    const st = memStorage();
    const store = new VolumeStore({
      load: () => {
        const s = loadSettings(st);
        return { musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, playJudge: s.playJudge };
      },
      save: (p) => void saveSettings(p, st),
    });
    store.set({ music: 42, sfx: 24 });
    const s = loadSettings(st);
    expect([s.musicVolume, s.sfxVolume]).toEqual([42, 24]);
    expect(new VolumeStore({ load: () => ({ musicVolume: s.musicVolume, sfxVolume: s.sfxVolume, playJudge: s.playJudge }), save: () => undefined }).get().music).toBe(42);
  });

  /** 소리 장치 흉내: 게인 값이 어떻게 예약되는지 기록한다 */
  function fakeContext(): { ctx: AudioContext; gains: Array<{ value: number; targets: Array<{ v: number; tc: number }>; cancels: number }> } {
    const gains: Array<{ value: number; targets: Array<{ v: number; tc: number }>; cancels: number }> = [];
    const node = (): Record<string, unknown> => ({ connect: () => ({ connect: () => undefined }), disconnect: () => undefined });
    const ctx = {
      currentTime: 1.5,
      state: 'running',
      sampleRate: 22050,
      destination: {},
      createGain: () => {
        const g = { value: 1, targets: [] as Array<{ v: number; tc: number }>, cancels: 0 };
        gains.push(g);
        return {
          ...node(),
          gain: {
            get value() {
              return g.value;
            },
            set value(v: number) {
              g.value = v;
            },
            cancelScheduledValues: () => void (g.cancels += 1),
            setTargetAtTime: (v: number, _t: number, tc: number) => void g.targets.push({ v, tc }),
            setValueAtTime: () => undefined,
            linearRampToValueAtTime: () => undefined,
          },
        };
      },
      createDynamicsCompressor: () => ({ ...node(), threshold: { value: 0 }, ratio: { value: 0 } }),
      createBuffer: (_c: number, length: number) => ({ length, duration: length / 22050, copyToChannel: () => undefined }),
    };
    return { ctx: ctx as unknown as AudioContext, gains };
  }

  it('효과음 게인: 슬라이더 곡선이 반영되고 바뀔 때 0.02초 시간 상수로 부드럽게 따라간다', () => {
    const { ctx, gains } = fakeContext();
    const store = new VolumeStore(memIo());
    const sfx = new SfxPlayer(ctx, 100, sfxLevelOf(store.get()));
    const master = gains[0]!;
    expect(sfx.gain).toBeCloseTo(0.64 * 1.5, 6); // 0.8^2 * baseGain 1.5
    expect(master.value).toBeCloseTo(0.64 * 1.5, 6);
    store.set({ sfx: 50 });
    sfx.setVolume(100, sfxLevelOf(store.get()));
    expect(sfx.gain).toBeCloseTo(0.25 * 1.5, 6);
    expect(master.targets.at(-1)).toEqual({ v: 0.25 * 1.5, tc: 0.02 });
    store.set({ muted: true });
    sfx.setVolume(100, sfxLevelOf(store.get()));
    expect(sfx.gain).toBe(0);
    expect(master.targets.at(-1)!.v).toBe(0);
    store.set({ muted: false });
    sfx.setVolume(100, sfxLevelOf(store.get()));
    expect(master.targets.at(-1)!.v).toBeCloseTo(0.25 * 1.5, 6);
    store.set({ sfx: 0 }); // 효과음 슬라이더 0 = 효과음 끄기
    sfx.setVolume(100, sfxLevelOf(store.get()));
    expect(sfx.gain).toBe(0);
  });

  it('음악 게인: Web Audio GainNode 로 조절하고(재생 속도·시작 위치와 무관) 도중 변경도 바로 예약된다', () => {
    const { ctx, gains } = fakeContext();
    const store = new VolumeStore(memIo());
    const buffer = { duration: 10 } as unknown as AudioBuffer;
    const player = new SegmentPlayer(ctx, buffer, structuredClone(GAME_CONFIG.timing), musicGainOf(store.get()), 1.25);
    const g = gains[0]!;
    expect(g.value).toBeCloseTo(0.64, 6);
    expect(player.volume).toBeCloseTo(0.64, 6);
    store.set({ music: 100 });
    player.setVolume(musicGainOf(store.get()));
    expect(g.targets.at(-1)).toEqual({ v: 1, tc: 0.02 });
    store.set({ muted: true });
    player.setVolume(musicGainOf(store.get()));
    expect(player.volume).toBe(0);
    store.set({ muted: false });
    player.setVolume(musicGainOf(store.get()));
    expect(player.volume).toBe(1);
    player.setVolume(7); // 범위 밖은 1 로
    expect(player.volume).toBe(1);
    // 재생 속도 계산은 볼륨과 무관하다
    expect(player.nowSongMs()).toBe(0);
  });
});

describe('판정 설정 보관소', () => {
  it('저장·알림·기본값으로 되돌리기', () => {
    const io = memIo();
    const store = new JudgeStore(io);
    expect(store.get()).toEqual(defaultPlayJudge());
    const seen: string[] = [];
    store.subscribe((j) => seen.push(describePlayJudge(j) ?? '기본'));
    store.set(applyPreset(store.get(), 'strict'));
    expect(io.saved.length).toBe(1);
    expect(store.get().perfectMs).toBe(30);
    expect(seen[0]).toMatch(/^판정 설정: 엄격 \(PERFECT ±30ms · GREAT ±65ms · GOOD ±100ms · BAD ±140ms · 점수 100\/60\/30\/5%\)$/);
    store.set({ ...store.get(), perfectMs: 25 });
    expect(describePlayJudge(store.get())).toMatch(/^판정 설정: 직접 /);
    expect(describePlayJudge(store.get())).not.toMatch(/연타/);
    store.reset();
    expect(store.get()).toEqual(defaultPlayJudge());
    expect(seen.at(-1)).toBe('기본');
    // 깨진 저장값은 읽을 때 복구
    io.state.playJudge = { perfectMs: 9999 } as unknown as PlayJudgeOptions;
    expect(validatePlayJudge(store.get())).toEqual([]);
  });
});
