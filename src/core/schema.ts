/**
 * 채보 데이터(schema_version 2)의 공통 상수·형식·기본 구조 만들기.
 * 원본: D:\MusicNoteDesignProgram\app\core\schema.py (같은 값·같은 규칙)
 */
import { cloneJson } from './util.ts';

export const SCHEMA_VERSION = 2;
/** 1박(4분음표) = 960 tick */
export const RESOLUTION = 960;
export const EDITOR_VERSION = '0.2.1';

export const LANE_BOTH = 'both';
export type Lane = 0 | 1 | 2 | 3 | 'both';
export const LANE_NAMES: Record<string, string> = { '0': '왼쪽', '1': '오른쪽', both: '양쪽' };

/** [10단계] 키 모드: 2키(왼쪽·오른쪽, 기본) / 4키(레인 0~3 = S D K L). 채보에 keyMode 필드가 없으면 2키다. */
export type KeyMode = 2 | 4;
export const KEY_MODES: readonly number[] = [2, 4];
export const DEFAULT_KEY_MODE: KeyMode = 2;
/** 4키 레인 표시 글자(왼쪽→오른쪽 레인 0~3) */
export const FOUR_KEY_LABELS: readonly string[] = ['S', 'D', 'K', 'L'];
/** 4키에서 한 시각(같은 틱)에 동시에 시작할 수 있는 노트 수 */
export const FOUR_KEY_MAX_SIMULTANEOUS = 2;
/** 4키에서 동시에 눌러야 하는 노트(롱노트 유지 + 새로 시작하는 노트)의 최대 합. [13] 모바일 양손 엄지 기준 3 → 2 */
export const FOUR_KEY_MAX_HELD = 2;
/** 4키 레인의 손: 왼손 = 레인 0·1, 오른손 = 레인 2·3 */
export function fourKeyHand(lane: number): 0 | 1 {
  return lane < 2 ? 0 : 1;
}

/** 채보의 키 모드. 필드가 없거나 4가 아니면 2키(옛 채보와 완전히 같게 동작). */
export function chartKeyMode(chart: { keyMode?: unknown } | null | undefined): KeyMode {
  return chart && chart.keyMode === 4 ? 4 : 2;
}

/** 레인 이름: 2키는 왼쪽/오른쪽, 4키는 "1레인(S)" ~ "4레인(L)". */
export function laneLabel(lane: unknown, keyMode: number = 2): string {
  if (lane === LANE_BOTH) return keyMode === 4 ? '4레인 전체' : LANE_NAMES.both!;
  if (keyMode === 4 && typeof lane === 'number' && lane >= 0 && lane <= 3) return `${lane + 1}레인(${FOUR_KEY_LABELS[lane]})`;
  return LANE_NAMES[String(lane)] ?? String(lane);
}

export const NOTE_TAP = 'tap';
export const NOTE_HOLD = 'hold';
export const NOTE_BURST = 'burst';
export type NoteType = 'tap' | 'hold' | 'burst';
export const NOTE_TYPES: readonly string[] = [NOTE_TAP, NOTE_HOLD, NOTE_BURST];
export const NOTE_TYPE_NAMES: Record<string, string> = { tap: '단타', hold: '롱노트', burst: '연타노트' };

export const BURST_MIN_COUNT = 3;
export const BURST_MAX_COUNT = 100;

export const DIFFICULTY_NAMES = ['EASY', 'NORMAL', 'HARD', 'CUSTOM'] as const;
export const SECTION_KINDS = ['intro', 'verse', 'chorus', 'bridge', 'outro', 'custom'] as const;

/** 격자(분할): 한 마디(4박)를 몇 칸으로 나누는지. 'free'는 격자 없음. */
export const GRID_DIVISIONS: readonly (number | 'free')[] = [4, 8, 12, 16, 24, 32, 'free'];
export const DEFAULT_GRID_DIVISION = 16;
/** 디코더 지연 보정값의 보통 범위(ms) */
export const DECODER_DELAY_LIMIT_MS = 500;

export const NOTE_RULES_TEXT: Record<string, string> = {
  tap: '단타: 노트 시간에 맞춰 한 번 터치합니다. 시간 차이에 따라 Perfect/Great/Good, 벗어나면 Miss.',
  hold:
    '롱노트: 첫 터치의 판정 등급이 노트 전체의 등급이 됩니다. 끝까지 누르고 있으면 자동 성공, ' +
    '중간에 손을 떼면 Miss. 끝에서 손을 떼는 타이밍은 판정하지 않습니다.',
  burst:
    '연타노트: 양쪽 레인 전체 폭의 노트(lane 값은 both)입니다. 구간 안에서 왼쪽·오른쪽 키 어느 쪽이든 ' +
    '누른 횟수를 합쳐 count회 이상이면 성공, 모자라면 Miss. 연타 구간 동안에는 다른 노트가 없습니다.',
};

/** 4키 채보의 연타노트 설명 */
export const NOTE_RULES_BURST_4KEY =
  '연타노트: 4레인 전체 폭의 노트(lane 값은 both)입니다. 구간 안에서 4개 키(S D K L) 어느 쪽이든 ' +
  '누른 횟수를 합쳐 count회 이상이면 성공, 모자라면 Miss. 연타 구간 동안에는 다른 노트가 없습니다.';

// ---------- 형식 ----------

export interface BpmEntry {
  tick: number;
  bpm: number;
  beats_per_bar?: number;
  beat_unit?: number;
}
export interface GridEntry {
  tick: number;
  division: number | 'free';
}
export interface Timing {
  resolution: number;
  bpm_map: BpmEntry[];
  grid_map: GridEntry[];
}
export interface ChartNote {
  id: number;
  type: NoteType | string;
  lane: Lane | number | string;
  tick: number;
  length_tick?: number;
  count?: number;
}
export interface Difficulty {
  name: string;
  level: number;
  notes: ChartNote[];
}
export interface Section {
  tick: number;
  name: string;
  kind: string;
}
export interface SongInfo {
  title: string;
  artist: string;
  audio_file: string;
  audio_sha256: string;
  duration_ms: number;
  audio_offset_ms: number;
  decoder_delay_ms: number;
}
export interface ChartMeta {
  created_by_engine?: string;
  created_at?: string;
  editor_version?: string;
  saved_at?: string;
  note_rules?: Record<string, string>;
  [key: string]: unknown;
}
/** 편집용 채보 v2 */
export interface ChartV2 {
  schema_version: number;
  song: SongInfo;
  timing: Timing;
  sections: Section[];
  lanes: number;
  /** [10단계] 2 | 4. 없으면 2키. 4일 때 lanes 도 4로 기록한다(옛 앱은 lanes≠2 라서 오류로 막힘). */
  keyMode?: number;
  difficulties: Difficulty[];
  meta: ChartMeta;
}

/** 현재 시각을 문자열로 돌려준다(원본의 now_iso와 같은 모양: 초 단위, 지역 시간). */
export function nowIso(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 기본 타이밍: 120BPM 4/4 단일. */
export function defaultTiming(): Timing {
  return {
    resolution: RESOLUTION,
    bpm_map: [{ tick: 0, bpm: 120.0, beats_per_bar: 4, beat_unit: 4 }],
    grid_map: [{ tick: 0, division: DEFAULT_GRID_DIVISION }],
  };
}

/** 비어 있는 난이도 하나. */
export function newDifficulty(name = 'NORMAL', level = 0): Difficulty {
  return { name, level, notes: [] };
}

/** 비어 있는 새 채보를 만든다. */
export function newChart(title = '', artist = '', audioFile = '', durationMs = 0, audioOffsetMs = 0): ChartV2 {
  return {
    schema_version: SCHEMA_VERSION,
    song: {
      title,
      artist,
      audio_file: audioFile,
      audio_sha256: '',
      duration_ms: Math.trunc(durationMs),
      audio_offset_ms: audioOffsetMs,
      decoder_delay_ms: 0,
    },
    timing: defaultTiming(),
    sections: [],
    lanes: 2,
    difficulties: [newDifficulty('NORMAL')],
    meta: {
      created_by_engine: 'manual',
      created_at: nowIso(),
      editor_version: EDITOR_VERSION,
      note_rules: cloneJson(NOTE_RULES_TEXT),
    },
  };
}

/** 난이도 안에서 아직 쓰이지 않은 노트 id. */
export function nextNoteId(notes: ChartNote[]): number {
  let max = 0;
  let any = false;
  for (const n of notes) {
    if (Number.isInteger(n.id)) {
      any = true;
      if (n.id > max) max = n.id;
    }
  }
  return any ? max + 1 : 1;
}

/** 정렬용 레인 순서: 양쪽(연타)이 가장 먼저, 그다음 왼쪽·오른쪽. */
export function laneSortKey(lane: unknown): number {
  return lane === LANE_BOTH ? -1 : (lane as number);
}

/** 노트가 tick 구간 [start, end) 를 차지하는지. 단타는 1tick 을 차지하는 것으로 본다. */
export function occupies(note: ChartNote, start: number, end: number): boolean {
  const nEnd = note.tick + (note.length_tick || 1);
  return note.tick < end && nEnd > start;
}

/** 노트 한 개를 만든다. 종류별로 필요한 항목만 넣는다. 연타노트의 lane 은 항상 'both'. */
export function makeNote(
  id: number,
  type: string,
  lane: Lane | number | string,
  tick: number,
  lengthTick?: number | null,
  count?: number | null,
): ChartNote {
  const note: ChartNote = { id, type, lane: type === NOTE_BURST ? LANE_BOTH : lane, tick: Math.trunc(tick) };
  if (type === NOTE_HOLD || type === NOTE_BURST) note.length_tick = Math.trunc(lengthTick ?? 0);
  if (type === NOTE_BURST) note.count = Math.trunc(count ?? 0);
  return note;
}

/** 노트가 끝나는 tick (단타는 시작과 같다). */
export function noteEndTick(note: ChartNote): number {
  return note.tick + (note.length_tick || 0);
}

/** 한 마디의 tick 수. 예: 4/4 = 3840, 3/4 = 2880, 6/8 = 2880. */
export function ticksPerBar(beatsPerBar = 4, beatUnit = 4): number {
  return Math.floor((RESOLUTION * 4 * beatsPerBar) / beatUnit);
}
