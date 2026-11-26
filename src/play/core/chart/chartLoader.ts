// 채보 로더: two-key-unity.v2 JSON 을 읽고 검사해서 게임용 채보로 바꾼다. 오류 문구는 쉬운 한국어.
import type { Chart, ChartNote, KeyMode, NoteLane, NoteType, ParseResult, SelectedDifficulty } from './types';

/** 이 로더가 읽을 수 있는 형식 이름 */
export const SUPPORTED_FORMAT = 'two-key-unity.v2';
/** 4키 채보 형식 이름 */
export const SUPPORTED_FORMAT_4KEY = 'four-key-unity.v2';

/** 요청한 난이도가 없을 때 대신 쓰는 난이도 */
export const FALLBACK_DIFFICULTY = 'NORMAL';

const NOTE_TYPES: readonly string[] = ['tap', 'hold', 'burst'];

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** 노트 하나를 검사해 게임용 노트로 바꾼다. 문제가 있으면 오류 문구를 errors 에 넣고 null 을 돌려준다. */
function parseNote(raw: unknown, number: number, errors: string[], prefix: string, keyMode: KeyMode = 2): ChartNote | null {
  const label = `${prefix}채보 ${number}번째 노트`;
  if (!isObject(raw)) {
    errors.push(`${label}의 모양이 올바르지 않습니다.`);
    return null;
  }
  const before = errors.length;
  const type = raw.type;
  if (typeof type !== 'string' || !NOTE_TYPES.includes(type)) {
    errors.push(`${label}의 종류(type)가 올바르지 않습니다. (tap, hold, burst 중 하나여야 합니다)`);
    return null;
  }
  const noteType = type as NoteType;

  const time = raw.time_ms;
  if (typeof time === 'number' && time < 0) {
    errors.push(`${label}의 시간이 음수입니다.`);
  } else if (!isNonNegativeInteger(time)) {
    errors.push(`${label}의 시간(time_ms)이 정수가 아닙니다.`);
  }

  const duration = raw.duration_ms ?? 0;
  if (typeof duration === 'number' && duration < 0) {
    errors.push(`${label}의 길이가 음수입니다.`);
  } else if (!isNonNegativeInteger(duration)) {
    errors.push(`${label}의 길이(duration_ms)가 정수가 아닙니다.`);
  }

  const count = raw.count ?? 0;
  if (!isNonNegativeInteger(count)) {
    errors.push(`${label}의 연타 횟수(count)가 올바르지 않습니다.`);
  }

  const lane = raw.lane;
  if (noteType === 'burst') {
    if (lane !== 'both') {
      errors.push(`${label}는 연타인데 레인 값이 "both"가 아닙니다.`);
    }
    if (typeof duration === 'number' && duration <= 0) {
      errors.push(`${label}는 연타인데 길이가 0 이하입니다.`);
    }
    if (typeof count === 'number' && count <= 0) {
      errors.push(`${label}는 연타인데 횟수가 0 이하입니다.`);
    }
  } else {
    const maxLane = keyMode - 1;
    if (typeof lane !== 'number' || !Number.isInteger(lane) || lane < 0 || lane > maxLane) {
      errors.push(`${label}의 레인 값이 올바르지 않습니다. (${keyMode === 4 ? '0~3' : '0 또는 1'}이어야 합니다)`);
    }
    if (noteType === 'hold' && typeof duration === 'number' && duration <= 0) {
      errors.push(`${label}는 롱노트인데 길이가 0 이하입니다.`);
    }
  }

  if (errors.length > before) return null;
  return {
    type: noteType,
    lane: lane as NoteLane,
    timeMs: time as number,
    durationMs: duration as number,
    count: count as number,
  };
}

/** 노트가 차지하는 끝 시각 (단타는 시작과 같음) */
function noteEnd(note: ChartNote): number {
  return note.timeMs + note.durationMs;
}

/** 정렬된 노트 목록에서 겹침·중복 문제를 찾는다. */
function checkOverlaps(notes: ChartNote[], errors: string[], prefix: string, keyMode: KeyMode = 2): void {
  // 같은 레인의 단타·롱노트: 같은 시간 중복, 롱노트 구간 겹침
  for (let lane = 0; lane < keyMode; lane += 1) {
    let lastEnd = -1;
    let lastTime = -1;
    let lastIndex = -1;
    notes.forEach((note, index) => {
      if (note.lane !== lane) return;
      if (note.timeMs === lastTime) {
        errors.push(`${prefix}채보 ${index + 1}번째 노트가 ${lastIndex + 1}번째 노트와 같은 레인, 같은 시간에 겹쳐 있습니다.`);
      } else if (note.timeMs < lastEnd) {
        errors.push(`${prefix}채보 ${index + 1}번째 노트가 ${lastIndex + 1}번째 롱노트 구간 안에 들어 있습니다.`);
      }
      lastTime = note.timeMs;
      lastEnd = Math.max(lastEnd, noteEnd(note));
      lastIndex = index;
    });
  }
  // 연타 구간 안에는 다른 노트가 있으면 안 된다
  notes.forEach((burst, burstIndex) => {
    if (burst.type !== 'burst') return;
    notes.forEach((other, otherIndex) => {
      if (otherIndex === burstIndex) return;
      // 구간 끝에 딱 맞닿는 노트는 겹침으로 보지 않는다. 시작 시각이 같으면 겹침이다.
      const overlaps =
        other.timeMs < noteEnd(burst) && (noteEnd(other) > burst.timeMs || other.timeMs === burst.timeMs);
      if (overlaps && (otherIndex > burstIndex || other.type !== 'burst')) {
        errors.push(`${prefix}채보 ${burstIndex + 1}번째 연타 구간 안에 ${otherIndex + 1}번째 노트가 들어 있습니다.`);
      }
    });
  });
}

/**
 * 채보 JSON 객체를 검사하고 게임용 채보로 바꾼다.
 * 노트가 시간순이 아니면 경고만 남기고 자동으로 정렬한다.
 */
export function parseChart(json: unknown): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObject(json)) {
    return { ok: false, errors: ['채보 파일이 올바른 JSON 객체가 아닙니다.'] };
  }
  if (json.format !== SUPPORTED_FORMAT && json.format !== SUPPORTED_FORMAT_4KEY) {
    return {
      ok: false,
      errors: [`채보 형식이 "${String(json.format)}" 입니다. "${SUPPORTED_FORMAT}" 또는 "${SUPPORTED_FORMAT_4KEY}" 형식 파일만 읽을 수 있습니다.`],
    };
  }
  const keyMode: KeyMode = json.format === SUPPORTED_FORMAT_4KEY ? 4 : 2;
  if (typeof json.lanes === 'number' && json.lanes !== keyMode) {
    return { ok: false, errors: [`채보 형식(${String(json.format)})과 레인 수(${json.lanes})가 맞지 않습니다. ${keyMode}키 채보는 레인 수가 ${keyMode}여야 합니다.`] };
  }
  if (!Array.isArray(json.difficulties) || json.difficulties.length === 0) {
    return { ok: false, errors: ['채보 파일에 난이도(difficulties) 목록이 없거나 비어 있습니다.'] };
  }

  const song = isObject(json.song) ? json.song : {};
  const difficulties = new Map<string, ChartNote[]>();

  json.difficulties.forEach((rawDifficulty: unknown, difficultyIndex: number) => {
    if (!isObject(rawDifficulty) || typeof rawDifficulty.name !== 'string') {
      errors.push(`${difficultyIndex + 1}번째 난이도에 이름(name)이 없습니다.`);
      return;
    }
    const name = rawDifficulty.name.toUpperCase();
    const prefix = `[난이도 ${name}] `;
    if (difficulties.has(name)) {
      errors.push(`${prefix}같은 이름의 난이도가 두 번 들어 있습니다.`);
      return;
    }
    if (!Array.isArray(rawDifficulty.notes) || rawDifficulty.notes.length === 0) {
      errors.push(`${prefix}노트가 하나도 없는 빈 채보입니다.`);
      return;
    }
    const notes: ChartNote[] = [];
    rawDifficulty.notes.forEach((rawNote: unknown, noteIndex: number) => {
      const note = parseNote(rawNote, noteIndex + 1, errors, prefix, keyMode);
      if (note !== null) notes.push(note);
    });
    if (notes.length !== rawDifficulty.notes.length) return; // 개별 오류는 이미 기록됨

    const isSorted = notes.every((note, i) => i === 0 || notes[i - 1]!.timeMs <= note.timeMs);
    if (!isSorted) {
      warnings.push(`${prefix}노트가 시간순으로 정렬되어 있지 않아 자동으로 정렬했습니다.`);
      notes.sort((a, b) => a.timeMs - b.timeMs);
    }
    const before = errors.length;
    checkOverlaps(notes, errors, prefix, keyMode);
    if (errors.length === before) difficulties.set(name, notes);
  });

  if (errors.length > 0) return { ok: false, errors };

  let declaredJudge: Record<string, number> | null = null;
  if (isObject(json.judge)) {
    declaredJudge = {};
    for (const [key, value] of Object.entries(json.judge)) {
      if (typeof value === 'number') declaredJudge[key] = value;
    }
  }

  const chart: Chart = {
    keyMode,
    title: typeof song.title === 'string' ? song.title : '',
    artist: typeof song.artist === 'string' ? song.artist : '',
    audioFile: typeof song.audio_file === 'string' ? song.audio_file : '',
    durationMs: isNonNegativeInteger(song.duration_ms) ? song.duration_ms : 0,
    difficulties,
    declaredJudge,
  };
  return { ok: true, chart, warnings };
}

/** JSON 문자열을 읽어 채보로 바꾼다. JSON 모양 자체가 깨졌으면 쉬운 오류 문구를 돌려준다. */
export function parseChartText(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['채보 파일을 읽을 수 없습니다. 파일이 깨졌거나 JSON 형식이 아닙니다.'] };
  }
  return parseChart(json);
}

/**
 * 난이도 이름으로 노트를 고른다. 없으면 NORMAL, NORMAL 도 없으면 첫 번째 난이도를 쓰고 substituted 를 true 로 표시한다.
 */
export function selectDifficulty(chart: Chart, requested: string): SelectedDifficulty {
  const wanted = requested.toUpperCase();
  let name = wanted;
  let notes = chart.difficulties.get(name);
  let substituted = false;
  if (notes === undefined) {
    substituted = true;
    name = FALLBACK_DIFFICULTY;
    notes = chart.difficulties.get(name);
  }
  if (notes === undefined) {
    const first = chart.difficulties.entries().next().value as [string, ChartNote[]];
    name = first[0];
    notes = first[1];
  }
  return { name, substituted, notes, totalNotes: notes.length };
}
