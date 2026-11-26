/**
 * 채보 생성 테스트: 같은 시드·같은 옵션이면 같은 결과, 옵션 검사, 연타 길이 규칙, 난수(파이썬과 같은 값),
 * 원본 생성 엔진 결과와 노트 목록 완전 일치(기준 결과가 있을 때).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import type { AnalysisResult } from '../src/analysis/types.ts';
import { BpmMap, validateIssues } from '../src/core/index.ts';
import { generateChart, resolveOptions } from '../src/generate/index.ts';
import { burstShape, localGapTicks } from '../src/generate/noteTypes.ts';
import { PyRandom } from '../src/generate/pyRandom.ts';
import type { GenerateOptions } from '../src/generate/index.ts';
import { makeSyntheticDrums } from '../tools/lib.ts';

describe('난수(파이썬 random 과 같은 값)', () => {
  it('시드 19491: random() 과 randrange(2)', () => {
    const r = new PyRandom(19491);
    expect([r.random(), r.random(), r.random()]).toEqual([0.5860936864237715, 0.38454285122957865, 0.04284164841801841]);
    const r2 = new PyRandom(19491);
    expect(Array.from({ length: 12 }, () => r2.randrange(2))).toEqual([1, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1]);
    const r3 = new PyRandom(7);
    expect([r3.random(), r3.randrange(2), r3.random()]).toEqual([0.32383276483316237, 0, 0.3948234964231735]);
  });
});

describe('옵션 정리 (resolveOptions)', () => {
  it('기본값은 보통(NORMAL)·기존 방식', () => {
    const o = resolveOptions();
    expect(o.difficulty).toBe('NORMAL');
    expect(o.design_mode).toBe('classic');
    expect(o.seed).toBe(19491);
    expect(o.grid_division).toBe(8);
  });
  it('잘못된 값은 쉬운 한국어 오류', () => {
    expect(() => resolveOptions({ difficulty: 'IMPOSSIBLE' })).toThrow('난이도');
    expect(() => resolveOptions({ ratios: { tap: 50, hold: 20, burst: 10 } })).toThrow('100%');
    expect(() => resolveOptions({ burst_count: 2 })).toThrow('3~100');
    expect(() => resolveOptions({ hold_beats: 40 })).toThrow('0.25~16');
    expect(() => resolveOptions({ lane_mode: 'zigzag' })).toThrow('레인');
    expect(() => resolveOptions({ design_mode: 'magic' })).toThrow('디자인 모드');
    expect(() => resolveOptions({ grid_tolerance: 'wild' })).toThrow('박자 맞춤');
  });
  it('레퍼런스 모드는 비율·레인 방식을 규칙대로 덮어쓴다', () => {
    const o = resolveOptions({ design_mode: 'reference', difficulty: 'HARD' });
    expect(o.lane_mode).toBe('natural');
    expect(o.ratios.tap).toBe(91);
  });
});

describe('연타 길이 규칙 (원본 test_burst_len_v013)', () => {
  const bpm = (v: number): BpmMap => new BpmMap([{ tick: 0, bpm: v, beats_per_bar: 4, beat_unit: 4 }]);
  const STEP16 = 240;
  const BEAT = 960;
  it('박당 4개 · 횟수 8 → 2박', () => {
    expect(burstShape(bpm(120), 0, 240, 8, STEP16, 8)).toEqual([2 * BEAT, 8, []]);
  });
  it('박당 2개 · 횟수 8 → 4박, 박당 4개 · 횟수 12 → 3박', () => {
    expect(burstShape(bpm(120), 0, 480, 8, STEP16, 8)!.slice(0, 2)).toEqual([4 * BEAT, 8]);
    expect(burstShape(bpm(120), 0, 240, 12, STEP16, 8)!.slice(0, 2)).toEqual([3 * BEAT, 12]);
  });
  it('간격은 격자에 맞춘다', () => {
    expect(burstShape(bpm(120), 0, 250, 8, STEP16, 8)![0] % STEP16).toBe(0);
    expect(localGapTicks([0, 230, 470, 720], STEP16, 480)).toBe(240);
    expect(localGapTicks([0], STEP16, 480)).toBe(480);
  });
  it('빠른 BPM 은 속도 한계를 넘으면 길이를 늘린다', () => {
    const [length, count, flags] = burstShape(bpm(240), 0, 240, 8, STEP16, 8)!;
    expect(flags).toContain('speed');
    expect(count).toBe(8);
    expect(length).toBeGreaterThan(2 * BEAT);
    expect(length % STEP16).toBe(0);
    expect(count / ((length / BEAT) * (60.0 / 240))).toBeLessThanOrEqual(9.6 + 1e-6);
  });
  it('상한을 넘으면 횟수를 줄이고 3회 미만은 만들지 않는다', () => {
    const [length, count, flags] = burstShape(bpm(120), 0, 480, 40, STEP16, 8)!;
    expect(flags).toContain('reduced');
    expect(count).toBe(16);
    expect(length).toBe(8 * BEAT);
    const [l2, c2, f2] = burstShape(bpm(120), 0, 4800, 8, STEP16, 8)!;
    expect(c2).toBe(3);
    expect(l2).toBeLessThanOrEqual(8 * BEAT);
    expect(f2).toContain('reduced');
  });
});

describe('채보 생성: 같은 시드·같은 옵션이면 같은 채보', () => {
  const synth = makeSyntheticDrums({ bpm: 120, seconds: 60, startMs: 300 });
  let analysis: AnalysisResult;
  const prepare = async (): Promise<AnalysisResult> => {
    if (!analysis) analysis = { ...(await analyzeAudio(synth.samples, {})), song: '합성곡' };
    return analysis;
  };
  const optionSets: GenerateOptions[] = [
    { difficulty: 'NORMAL' },
    { difficulty: 'EASY', design_mode: 'reference' },
    { difficulty: 'HARD', design_mode: 'unified', allow_burst: true },
    { difficulty: 'NORMAL', lane_mode: 'random' },
    { difficulty: 'NORMAL', lane_mode: 'accent', ratios: { tap: 60, hold: 20, burst: 20 } },
  ];
  for (const options of optionSets) {
    it(`${JSON.stringify(options)}: 두 번 만들어 완전히 같다 + 검증 오류 0`, async () => {
      const a = await prepare();
      const r1 = generateChart(a, options);
      const r2 = generateChart(a, options);
      expect(JSON.stringify(r1.chart.difficulties)).toBe(JSON.stringify(r2.chart.difficulties));
      expect(JSON.stringify(r1.stats)).toBe(JSON.stringify(r2.stats));
      expect(r1.notes.length).toBeGreaterThan(20);
      expect(r1.validation.error_count).toBe(0);
      expect(validateIssues(r1.chart).filter((i) => i.level === 'error')).toEqual([]);
      // 노트 id 는 1부터 차례대로, 연타노트는 양쪽(both) 레인
      r1.notes.forEach((n, i) => {
        expect(n.id).toBe(i + 1);
        if (n.type === 'burst') expect(n.lane).toBe('both');
      });
    });
  }
  it('결과 모양: chart · stats · validation · messages', async () => {
    const r = generateChart(await prepare(), {});
    expect(r.chart.schema_version).toBe(2);
    expect(r.chart.song.title).toBe('합성곡');
    expect(r.stats.total).toBe(r.notes.length);
    expect(r.validation).toHaveProperty('error_count');
    expect(r.validation).toHaveProperty('items');
    expect(Array.isArray(r.messages)).toBe(true);
  });
  it('분석 결과가 없으면 안내', () => {
    expect(() => generateChart(undefined as unknown as AnalysisResult, {})).toThrow('먼저 분석');
  });
});

// ---------- 원본 생성 엔진과 노트 목록 완전 일치 (기준 결과가 있을 때) ----------
const REF_DIR = resolve('log/ref_python/out');
const manifestPath = resolve(REF_DIR, 'manifest.json');
describe.skipIf(!existsSync(manifestPath))('원본(Python) 생성 결과와 비교', () => {
  it('원본과 같은 분석 후보를 넣으면 모든 조합(곡 × 모드 × 난이도)에서 노트 목록이 완전히 같다', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id: string; generated: { key: string }[] }[];
    let checked = 0;
    for (const m of manifest) {
      const analysis = JSON.parse(readFileSync(resolve(REF_DIR, `${m.id}_analysis.json`), 'utf8')) as AnalysisResult;
      for (const g of m.generated) {
        const ref = JSON.parse(readFileSync(resolve(REF_DIR, `${g.key}.json`), 'utf8')) as { options: GenerateOptions; result: { notes: unknown[]; stats: { total: number } } };
        const mine = generateChart(analysis, ref.options);
        expect(JSON.stringify(mine.notes), g.key).toBe(JSON.stringify(ref.result.notes));
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(9);
  });
});
