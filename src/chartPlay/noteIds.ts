// 편집기 노트 번호 찾기: Unity 내보내기의 노트 순서(tick, 레인 순)와 같은 순서로 편집기 채보의 노트 번호를 만든다.
// 이 번호는 결과 화면에서 MISS 를 눌렀을 때 편집기가 그 노트로 이동하는 데 쓴다.
import { laneSortKey } from '../core/schema.ts';
import type { ChartV2 } from '../core/schema.ts';

/** 난이도 이름으로 노트 번호 목록을 만든다. 난이도가 없으면 null */
export function noteIdsForDifficulty(chart: ChartV2, difficulty: string): number[] | null {
  const wanted = difficulty.toUpperCase();
  const diff = chart.difficulties.find((d) => d.name.toUpperCase() === wanted);
  if (diff === undefined) return null;
  const sorted = [...diff.notes].sort((a, b) => a.tick - b.tick || laneSortKey(a.lane) - laneSortKey(b.lane));
  return sorted.map((n) => n.id);
}

/** 곡의 대표 BPM(첫 구간). 없거나 이상하면 null. 롱노트 틱 간격(16분음표)을 정하는 데 쓴다. */
export function firstBpm(chart: ChartV2): number | null {
  const entry = chart.timing.bpm_map[0];
  if (entry === undefined || !(entry.bpm > 0)) return null;
  return entry.bpm;
}
