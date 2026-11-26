/**
 * BPM 맵이나 offset을 바꿀 때 기존 노트를 어떻게 옮길지 처리한다. (원본 retime.py)
 *
 * - 'time'(기본, 소리 위치 유지): 노트가 음원의 같은 소리 위치에 남도록 tick을 다시 계산
 * - 'tick'(음악적 위치 유지): tick을 그대로 두므로 박자 위치는 같지만 소리 위치는 달라짐
 *
 * 소리 위치 유지에서 tick이 음수가 되는 노트가 생기면(예: offset을 뒤로 옮김) 노트를 0으로 모으지 않고,
 * '시작점을 마디 단위로 앞당겨' 모든 노트가 0 이상이 되게 한다. 그래서 audio_offset_ms 는 0 또는 음수가 될 수 있다.
 */
import { cloneJson } from './util.ts';
import { ticksPerBar } from './schema.ts';
import type { BpmEntry, ChartV2 } from './schema.ts';
import { BpmMap } from './timing.ts';
import { ERROR, validateIssues } from './validate.ts';
import type { Issue } from './validate.ts';

export const KEEP_SOUND = 'time';
export const KEEP_BEAT = 'tick';
export type RetimeMode = 'time' | 'tick';

/** 화면에 보여 줄 한국어 설명 */
export const MODE_DESCRIPTIONS: Record<string, string> = {
  [KEEP_SOUND]: '소리 위치 유지 (추천): 노트가 음악의 같은 소리 위치에 남습니다. BPM이 바뀌면 박자 칸은 이동합니다.',
  [KEEP_BEAT]: '박자 위치 유지: 노트가 같은 박자 칸에 남습니다. BPM이 바뀌면 소리와 어긋날 수 있습니다.',
};

/** 바꾸려는 내용. 빠진 항목은 현재 값을 그대로 쓴다. */
export interface RetimeChange {
  bpm_map?: BpmEntry[];
  audio_offset_ms?: number;
  mode?: RetimeMode;
}

export interface RetimeOutput {
  chart: ChartV2;
  messages: string[];
}

function issueKey(i: Issue): string {
  return `${i.code}|${i.difficulty}|${i.note_ids.join(',')}`;
}

/** 새 BPM 맵·offset을 적용한 채보 복사본과 안내 메시지 목록을 돌려준다. 원본은 바꾸지 않는다. */
export function retimeChart(chart: ChartV2, newBpmEntries: BpmEntry[], newOffsetMs: number, mode: RetimeMode = KEEP_SOUND): RetimeOutput {
  if (mode !== KEEP_SOUND && mode !== KEEP_BEAT) throw new Error(`알 수 없는 유지 방식입니다: ${String(mode)}`);
  const res = chart.timing.resolution ?? 960;
  const oldMap = new BpmMap(chart.timing.bpm_map, res);
  const newMap = new BpmMap(newBpmEntries, res);
  const oldOff = chart.song.audio_offset_ms ?? 0;
  const beforeKeys = new Set(validateIssues(chart).map(issueKey));
  const result = cloneJson(chart);
  const messages: string[] = [];
  result.timing.bpm_map = newMap.toList();
  result.song.audio_offset_ms = newOffsetMs;

  if (mode === KEEP_SOUND) {
    // 옛 tick → 같은 소리 위치의 새 tick(정수)
    const convert = (tick: number): number => {
      const soundMs = oldMap.tickToMs(tick) + oldOff;
      return newMap.msToTickInt(soundMs - newOffsetMs);
    };
    for (const diff of result.difficulties) {
      for (const note of diff.notes) {
        const start = convert(note.tick);
        if (note.length_tick !== undefined) {
          const end = convert(note.tick + note.length_tick);
          note.length_tick = Math.max(1, end - start);
        }
        note.tick = start;
      }
    }
    for (const sec of result.sections ?? []) sec.tick = convert(sec.tick);
    for (const g of result.timing.grid_map ?? []) {
      if (g.tick > 0) g.tick = convert(g.tick);
    }

    // 음수 tick이 생겼으면 시작점을 마디 단위로 앞당긴다
    const ticks: number[] = [];
    for (const d of result.difficulties) for (const n of d.notes) ticks.push(n.tick);
    for (const s of result.sections ?? []) ticks.push(s.tick);
    const lowest = ticks.length ? Math.min(...ticks) : 0;
    if (lowest < 0) {
      const first = result.timing.bpm_map[0]!;
      const bar = ticksPerBar(first.beats_per_bar ?? 4, first.beat_unit ?? 4);
      const bars = Math.ceil(-lowest / bar);
      const shift = bars * bar;
      const shiftMs = shift * newMap.msPerTick(0);
      for (const diff of result.difficulties) for (const note of diff.notes) note.tick += shift;
      for (const sec of result.sections ?? []) sec.tick += shift;
      for (const g of result.timing.grid_map ?? []) {
        if (g.tick > 0) g.tick += shift;
      }
      for (const entry of result.timing.bpm_map) {
        if (entry.tick > 0) entry.tick += shift;
      }
      result.song.audio_offset_ms = Math.round((newOffsetMs - shiftMs) * 1000) / 1000;
      messages.push(
        `일부 노트가 곡 시작 앞으로 밀려, 시작점을 ${bars}마디 앞당겼습니다 (음원 시작 위치 ${result.song.audio_offset_ms.toFixed(1)}ms). 노트의 소리 위치는 그대로입니다.`,
      );
    }
    // 첫 BPM 구간 앞당김 후 BPM 맵이 올바른지 다시 확인
    new BpmMap(result.timing.bpm_map, res);
  }

  // 재계산 뒤 자동 검증: 새로 생긴 오류·경고만 안내 (반올림으로 같은 tick에 겹친 노트 등)
  for (const issue of validateIssues(result)) {
    if (beforeKeys.has(issueKey(issue))) continue;
    const label = issue.level === ERROR ? '오류' : '주의';
    messages.push(`[재계산 후 ${label}] ${issue.message}`);
  }
  return { chart: result, messages };
}

/** 계약 함수: 바꾸려는 내용을 적용한 새 채보를 돌려준다(원본은 그대로). 안내 메시지가 필요하면 retimeChart 를 쓴다. */
export function retime(chart: ChartV2, change: RetimeChange): ChartV2 {
  return retimeChart(
    chart,
    change.bpm_map ?? chart.timing.bpm_map,
    change.audio_offset_ms ?? chart.song.audio_offset_ms ?? 0,
    change.mode ?? KEEP_SOUND,
  ).chart;
}
