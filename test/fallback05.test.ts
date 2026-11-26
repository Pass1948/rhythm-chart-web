// 05단계: Web Worker 를 못 쓸 때의 조각 나눠 분석(양보 방식)이 보통 분석과 같은 결과를 내는지 확인한다.
import { describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import { computeFeatures, computeFeaturesAsync } from '../src/analysis/detect.ts';
import { makeSyntheticDrums } from './synth.ts';

describe('양보(await) 방식 분석', () => {
  const s = makeSyntheticDrums({ bpm: 120, seconds: 8, startMs: 100 }).samples;

  it('computeFeaturesAsync 는 computeFeatures 와 같은 값을 내고 중간에 여러 번 양보한다', async () => {
    let yields = 0;
    const a = await computeFeaturesAsync(s, async () => {
      yields++;
    });
    const b = computeFeatures(s);
    expect(yields).toBeGreaterThan(2);
    expect(a.frames).toBe(b.frames);
    expect(Array.from(a.novelty[0]!.slice(0, 200))).toEqual(Array.from(b.novelty[0]!.slice(0, 200)));
  });

  it('analyzeAudio 에 yielder 를 주어도 결과(후보·박자)가 같다', async () => {
    let yields = 0;
    const plain = await analyzeAudio(s, {});
    const sliced = await analyzeAudio(s, {}, undefined, undefined, async () => {
      yields++;
    });
    expect(yields).toBeGreaterThan(3);
    expect(sliced.candidates).toEqual(plain.candidates);
    expect(sliced.timing.bpm).toBe(plain.timing.bpm);
  });
});
