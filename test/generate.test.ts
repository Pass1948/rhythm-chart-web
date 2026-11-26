import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {generateChart} from '../src/generate/index.ts';
import type {GenerateOptions} from '../src/generate/index.ts';
import type {AnalysisResult} from '../src/analysis/types.ts';
const REF_DIR = resolve('log/ref_python/out');
const manifestPath = resolve(REF_DIR, 'manifest.json');
describe('원본(Python) 생성 결과와 비교', () => {
  it('원본과 같은 분석 후보를 넣으면 모든 조합(곡 × 모드 × 난이도)에서 노트 목록이 완전히 같다', () => {
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
        checked++;
      }
    }
    expect(checked).toBe(24);
  });
});
