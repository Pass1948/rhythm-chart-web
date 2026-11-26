import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PyRandom} from '../src/generate/pyRandom.ts';
import {generateChart, resolveOptions} from '../src/generate/index.ts';
import type {GenerateOptions} from '../src/generate/index.ts';
import type {AnalysisResult} from '../src/analysis/types.ts';
const REF_DIR = resolve('log/ref_python/out');
const manifestPath = resolve(REF_DIR, 'manifest.json');
describe('실제 분석 후보로 통합 생성', () => {
  it('6곡과 네 난이도에서 반복 결과가 같고 양손 규칙을 만족한다', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id: string; generated: { key: string }[] }[];
    let checked = 0;
    for (const m of manifest) {
      const analysis = JSON.parse(readFileSync(resolve(REF_DIR, `${m.id}_analysis.json`), 'utf8')) as AnalysisResult;
      for (const difficulty of ["EASY","NORMAL","HARD","GLIITCH"]) {
        const options:GenerateOptions={difficulty};
        const mine = generateChart(analysis, options);
        expect(mine.notes, difficulty).toEqual(generateChart(analysis, options).notes);
        expect(mine.notes.some(n => n.type === 'burst')).toBe(false);
        expect(mine.notes.length).toBeGreaterThan(0);
        expect(mine.validation.error_count).toBe(0);
        expect(mine.stats.hold).toBeGreaterThan(0);
        const left = mine.notes.filter(n=>Number(n.lane)<2).length / mine.notes.length;
        expect(left).toBeGreaterThanOrEqual(0.44);
        expect(left).toBeLessThanOrEqual(0.56);
        checked++;
      }
    }
    expect(checked).toBe(24);
  });
});

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

it('생성 설정과 오류 안내', () => {
  expect(resolveOptions()).toMatchObject({difficulty:'NORMAL',key_mode:4,design_mode:'unified',grid_division:8});
  expect(() => resolveOptions({difficulty:'IMPOSSIBLE'})).toThrow('난이도');
  expect(() => resolveOptions({grid_tolerance:'wild'})).toThrow('박자 맞춤');
  expect(() => resolveOptions({rule_overrides:{nps:99}})).toThrow('규칙');
  expect(() => generateChart(null as unknown as AnalysisResult)).toThrow('분석');
});
it('노트 양·롱노트 양·동시 입력을 각각 조절한다', () => {
  const analysis = JSON.parse(readFileSync(resolve(REF_DIR,'s1_analysis.json'),'utf8'));
  const run = (opt:GenerateOptions) => generateChart(analysis,{difficulty:'HARD',...opt});
  const base = run({});
  expect(run({density_scale:0.5}).notes.length).toBeLessThan(base.notes.length);
  expect(run({hold_percent:0}).stats.hold).toBe(0);
  const solo = run({four_key_simultaneous:0}).notes;
  expect(new Set(solo.map(n=>n.tick)).size).toBe(solo.length);
  expect(new Set(base.notes.map(n=>n.tick)).size).toBeLessThan(base.notes.length);
  expect(run({rule_overrides:{nps:2}}).notes.length).toBeLessThan(base.notes.length);
});
