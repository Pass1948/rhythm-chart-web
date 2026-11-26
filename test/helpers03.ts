// 03단계 테스트 도우미: 편집기 채보에서 난이도의 노트 목록을 꺼낸다.
import type { ChartNote, ChartV2 } from '../src/core/schema.ts';

/** 난이도 이름으로 노트 목록(원본 그대로)을 돌려준다 */
export function allNotes(chart: ChartV2, difficulty: string): ChartNote[] {
  const diff = chart.difficulties.find((d) => d.name.toUpperCase() === difficulty.toUpperCase());
  return diff === undefined ? [] : diff.notes;
}
