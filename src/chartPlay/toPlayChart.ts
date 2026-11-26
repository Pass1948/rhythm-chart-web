// 편집기 채보를 게임 로더 형식으로 읽는다. 겹친 노트는 유지하고 재생할 수 없는 노트만 안내 후 제외한다.
import type { UnityChart } from '../core/chartIo.ts';
import { ChartFormatError } from '../core/index.ts';
import { parseChart, SUPPORTED_FORMAT, SUPPORTED_FORMAT_4KEY } from '../play/core/chart/chartLoader';
import type { ChartNote } from '../play/core/chart/types';

/** 변환 결과 */
export interface PlayChartBuild {
  /** 실제로 쓰는 난이도 이름 (대문자) */
  difficulty: string;
  /** [10단계] 키 모드 (2 / 4) */
  keyMode: 2 | 4;
  /** 게임이 쓰는 노트 목록 (시간 순) */
  notes: ChartNote[];
  /** notes 와 같은 순서의 편집기 노트 번호 (모르면 null) */
  noteIds: Array<number | null>;
  /** 원본(Unity) 노트 수 */
  sourceCount: number;
  /** 곡 시작 전(시간이 음수)이라 뺀 노트 수 */
  droppedBeforeStart: number;
  /** 시작 위치(startMs) 앞이라 뺀 노트 수 */
  droppedBeforeStartMs: number;
  /** 쉬운 한국어 안내 */
  warnings: string[];
  /** 곡 정보 */
  title: string;
  artist: string;
}

/** 변환할 때 받는 선택 값 */
export interface PlayChartOptions {
  /** unityChart 노트와 같은 순서의 편집기 노트 번호 */
  noteIds?: ReadonlyArray<number | null>;
  /** 이 시각(ms) 앞의 노트는 뺀다. 걸쳐 있는 롱노트·연타도 뺀다(편집기 [테스트]와 같은 규칙) */
  startMs?: number;
}

/** 쉬운 한국어 오류 */
export class PlayChartError extends Error {}

/**
 * Unity 데이터에서 난이도 하나를 골라 원본 게임 로더(two-key-unity.v2)가 읽는 JSON 객체로 만든다.
 * 곡 시작 전(시간 음수) 노트는 뺀다. 나머지는 값을 바꾸지 않는다.
 */
export function toLoaderJson(unity: UnityChart, difficulty: string): { json: Record<string, unknown>; keptSourceIndex: number[]; droppedBeforeStart: number; sourceCount: number; difficulty: string } {
  const wanted = difficulty.toUpperCase();
  const found = unity.difficulties.find((d) => d.name.toUpperCase() === wanted) ?? unity.difficulties[0];
  if (found === undefined) throw new PlayChartError('채보에 난이도가 하나도 없어요. 편집기에서 먼저 채보를 만들어 주세요.');
  const kept: Array<Record<string, unknown>> = [];
  const keptSourceIndex: number[] = [];
  let dropped = 0;
  found.notes.forEach((note, index) => {
    if (typeof note.time_ms === 'number' && note.time_ms < 0) {
      dropped += 1;
      return;
    }
    kept.push({ type: note.type, lane: note.lane, time_ms: note.time_ms, duration_ms: note.duration_ms, count: note.count });
    keptSourceIndex.push(index);
  });
  const json: Record<string, unknown> = {
    format: unity.format === SUPPORTED_FORMAT_4KEY ? SUPPORTED_FORMAT_4KEY : SUPPORTED_FORMAT,
    song: { title: unity.song.title, artist: unity.song.artist, audio_file: unity.song.audio_file, duration_ms: unity.song.duration_ms },
    lanes: unity.lanes,
    difficulties: [{ name: found.name, level: found.level, notes: kept }],
  };
  return { json, keptSourceIndex, droppedBeforeStart: dropped, sourceCount: found.notes.length, difficulty: found.name.toUpperCase() };
}

/**
 * 게임 화면용 채보를 만든다. 문제가 있으면 PlayChartError(쉬운 한국어)를 던진다.
 * startMs 가 있으면 그 앞의 노트는 뺀다.
 */
export function toPlayChart(unity: UnityChart, difficulty: string, options: PlayChartOptions = {}): PlayChartBuild {
  if (unity.format !== SUPPORTED_FORMAT && unity.format !== SUPPORTED_FORMAT_4KEY) throw new ChartFormatError(`채보 형식이 "${unity.format}" 입니다. 편집기의 Unity용 내보내기 결과만 쓸 수 있어요.`);
  const loaded = toLoaderJson(unity, difficulty);
  const parsed = parseChart(loaded.json, { preview: true });
  if (!parsed.ok) throw new PlayChartError(`게임 화면에서 칠 수 없는 채보예요. ${parsed.errors[0] ?? ''}`);
  const all = parsed.chart.difficulties.get(loaded.difficulty);
  if (all === undefined || all.length === 0) throw new PlayChartError('채보에 노트가 하나도 없어요. 노트를 만든 뒤 다시 눌러 주세요.');
  const indexes = parsed.sourceIndexes?.get(loaded.difficulty) ?? [];
  const ids = indexes.map((index) => options.noteIds?.[loaded.keptSourceIndex[index]!] ?? null);
  const startMs = options.startMs ?? 0;
  const notes: ChartNote[] = [];
  const noteIds: Array<number | null> = [];
  all.forEach((note, index) => {
    if (note.timeMs < startMs) return;
    notes.push(note);
    noteIds.push(ids[index] ?? null);
  });
  if (notes.length === 0) throw new PlayChartError('시작 위치 뒤에는 노트가 없어요. 더 앞에서 시작해 주세요.');
  const warnings: string[] = [...parsed.warnings];
  if (loaded.droppedBeforeStart > 0) warnings.push(`곡이 시작되기 전에 있는 노트 ${loaded.droppedBeforeStart}개는 게임 화면에서 칠 수 없어서 뺐어요. 편집기에서 박자·시작 위치를 확인해 보세요.`);
  return {
    difficulty: loaded.difficulty,
    keyMode: parsed.chart.keyMode,
    notes,
    noteIds,
    sourceCount: loaded.sourceCount,
    droppedBeforeStart: loaded.droppedBeforeStart,
    droppedBeforeStartMs: all.length - notes.length,
    warnings,
    title: parsed.chart.title,
    artist: parsed.chart.artist,
  };
}
