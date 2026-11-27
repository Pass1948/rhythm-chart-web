import type { ChartV2 } from '../../core/schema.ts';
import type { ExportWhat } from '../../storage/exportFiles.ts';

/** 노트가 없는 난이도가 있으면 곡의 난이도별 노트 수를 돌려준다. */
export function emptyDifficultyWarning(what: ExportWhat, chart: Pick<ChartV2, 'difficulties'>) {
  if (what === 'audio') return null;
  const counts = chart.difficulties.map(({ name, notes }) => ({ name, count: notes.length }));
  return counts.some(({ count }) => count === 0) ? counts : null;
}
