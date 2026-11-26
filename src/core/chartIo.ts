/**
 * 채보 저장·불러오기·내보내기. v1(기존 프로토타입) JSON은 불러올 때 v2로 자동 변환한다. (원본 chart_io.py)
 * 이 브라우저판은 파일 경로를 다루지 않고 '객체 ↔ JSON 문자열' 변환만 한다. 실제 저장은 02단계의 storage가 맡는다.
 */
import { loadJudgeConfig } from './config.ts';
import {
  EDITOR_VERSION,
  GRID_DIVISIONS,
  LANE_BOTH,
  FOUR_KEY_LABELS,
  NOTE_BURST,
  NOTE_RULES_BURST_4KEY,
  NOTE_RULES_TEXT,
  NOTE_TAP,
  RESOLUTION,
  SCHEMA_VERSION,
  chartKeyMode,
  laneSortKey,
  newChart,
  nowIso,
} from './schema.ts';
import type { ChartNote, ChartV2, Difficulty } from './schema.ts';
import { BpmMap } from './timing.ts';
import { cloneJson, fmtG, pyRound } from './util.ts';
import { validateIssues } from './validate.ts';
import type { Issue } from './validate.ts';

/** 채보 파일 형식이 잘못되었거나 지원하지 않는 버전일 때. */
export class ChartFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartFormatError';
  }
}

/** 불러오기 결과: 채보, 검사 결과, 변환 내용. */
export interface LoadResult {
  chart: ChartV2;
  issues: Issue[];
  converted_from: number; // 0이면 변환 없음 (1=v1 변환, 2=연타노트 레인 변환)
  conversion_notes: string[];
}

/** Windows 폴더·파일 이름으로 쓸 수 없는 글자를 바꾼다(한글은 그대로). */
export function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/\.+$/, '');
  return cleaned || '이름없음';
}

/** 바이트 묶음의 sha256(16진 문자열). 브라우저·Node 모두 crypto.subtle 을 쓴다. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------- 저장 / 불러오기 (JSON 문자열) ----------

/** 저장용 JSON 문자열을 만든다. 저장 시각·편집기 버전·판정 설명을 채운다(들여쓰기 2칸). 원본 객체는 바꾸지 않는다. */
export function chartToJson(chart: ChartV2): string {
  const copy = cloneJson(chart);
  copy.meta = copy.meta ?? {};
  copy.meta.editor_version = EDITOR_VERSION;
  copy.meta.saved_at = nowIso();
  if (!copy.meta.note_rules) copy.meta.note_rules = cloneJson(NOTE_RULES_TEXT);
  return JSON.stringify(copy, null, 2);
}

/** JSON 문자열을 읽어 LoadResult를 돌려준다. v1이면 v2로 변환하고, 항상 검증 결과를 함께 돌려준다. */
export function chartFromJson(text: string): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (exc) {
    throw new ChartFormatError(`채보 파일을 읽을 수 없습니다: ${exc instanceof Error ? exc.message : String(exc)}`);
  }
  return loadChartData(data);
}

function hasFourKeyMarker(chart: Record<string, unknown>): boolean {
  return [chart.keyMode, chart.key_mode, chart.lanes].some((value) => value === 4 || value === '4')
    || [chart.format, chart.schema_version].some((value) => /^four-key-(?:chart|unity)(?:\.|$)/i.test(String(value)));
}

/** 버전 번호와 상관없이 밀리초를 쓰는 4키 내보내기 형식을 알아본다. */
export function isFourKeyUnityData(data: unknown): data is { difficulties: UnityDifficulty[] } {
  if (data === null || typeof data !== 'object') return false;
  const chart = data as Record<string, unknown>;
  if (!hasFourKeyMarker(chart) || !Array.isArray(chart.difficulties)) return false;
  return /^four-key-unity\./i.test(String(chart.format ?? chart.schema_version))
    || chart.difficulties.some((diff) => Array.isArray(diff?.notes)
      && diff.notes.some((note: unknown) => typeof note === 'object' && note !== null && 'time_ms' in note));
}

/** 이미 읽은 객체를 버전에 맞게 처리한다. */
export function loadChartData(data: unknown): LoadResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ChartFormatError('채보 파일 형식이 아닙니다.');
  const obj = data as Record<string, unknown>;
  const version = obj.schema_version;
  if (isFourKeyUnityData(obj)) {
    const chart = importUnityFourKey(obj, obj.difficulties);
    return { chart, issues: validateIssues(chart), converted_from: 2, conversion_notes: ['4키 채보의 밀리초 시각을 편집용 틱으로 변환했습니다.'] };
  }
  const fourKey = hasFourKeyMarker(obj);
  if (!fourKey && (version === 'two-key-chart.v1' || (version === undefined && Array.isArray(obj.notes)))) {
    const [chart, notes] = convertV1ToV2(obj);
    return { chart, issues: validateIssues(chart), converted_from: 1, conversion_notes: notes };
  }
  if (version === SCHEMA_VERSION || (fourKey && Array.isArray(obj.difficulties))) {
    const chart = normalizeV2(obj as unknown as ChartV2);
    if (fourKey) {
      chart.schema_version = SCHEMA_VERSION;
      chart.keyMode = 4;
      chart.lanes = 4;
      for (const diff of chart.difficulties) {
        if (typeof diff.name === 'string') diff.name = normalizeFourKeyDifficulty(diff.name);
      }
    }
    const fixed = convertBurstLanes(chart);
    if (fixed) {
      return {
        chart,
        issues: validateIssues(chart),
        converted_from: 2,
        conversion_notes: [
          `연타노트 ${fixed}개가 이전 형식(왼쪽/오른쪽 레인)이어서 양쪽 레인 노트로 자동 변환했습니다. 변환된 구간에 다른 노트가 있으면 오류로 표시되니 정리해 주세요.`,
        ],
      };
    }
    const migrated = fourKey && version !== SCHEMA_VERSION;
    return {
      chart, issues: validateIssues(chart), converted_from: migrated ? 2 : 0,
      conversion_notes: migrated ? ['4키 채보를 현재 편집 형식으로 열었습니다.'] : [],
    };
  }
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    throw new ChartFormatError(`더 새로운 버전(${version})의 채보 파일입니다. 프로그램을 업데이트해 주세요.`);
  }
  throw new ChartFormatError(`알 수 없는 채보 버전입니다: ${String(version)}`);
}

function normalizeFourKeyDifficulty(name: string): string {
  const upper = name.toUpperCase();
  if (upper === 'GLITCH') return 'GLIITCH';
  return ['EASY', 'NORMAL', 'HARD', 'GLIITCH', 'CUSTOM'].includes(upper) ? upper : name;
}

/** Unity에 저장된 밀리초는 그대로 맞추고, 파일에 없는 박자표는 기본값을 쓴다. */
function importUnityFourKey(obj: Record<string, unknown>, rows: UnityDifficulty[]): ChartV2 {
  const song = (obj.song ?? {}) as Partial<ChartV2['song']>;
  let offset = 0;
  for (const row of rows) {
    if (typeof row?.name !== 'string' || !Array.isArray(row.notes)
      || row.notes.some((note) => !Number.isFinite(note?.time_ms))) {
      throw new ChartFormatError('4키 채보의 난이도 또는 노트 시각을 읽을 수 없습니다.');
    }
    for (const note of row.notes) offset = Math.min(offset, note.time_ms);
  }
  const chart = newChart(song.title, song.artist, song.audio_file, song.duration_ms, offset);
  chart.keyMode = 4;
  chart.lanes = 4;
  const map = new BpmMap(chart.timing.bpm_map);
  chart.difficulties = rows.map((row) => ({
    name: normalizeFourKeyDifficulty(row.name),
    level: row.level ?? 0,
    notes: row.notes.map((note, index) => {
      const tick = map.msToTickInt(note.time_ms - offset);
      const result: ChartNote = { id: index + 1, type: note.type, lane: note.lane as ChartNote['lane'], tick };
      if (note.type !== NOTE_TAP) {
        result.length_tick = map.msToTickInt(note.time_ms + note.duration_ms - offset) - tick;
      }
      if (note.type === NOTE_BURST) {
        result.lane = LANE_BOTH;
        result.count = note.count;
      }
      return result;
    }),
  }));
  return chart;
}

/** v2 데이터의 빠진 항목을 기본값으로 채운다. 값 자체는 바꾸지 않아 검증에서 문제를 잡을 수 있게 한다. */
function normalizeV2(data: ChartV2): ChartV2 {
  const chart = cloneJson(data);
  const base = newChart();
  chart.song = chart.song ?? ({} as ChartV2['song']);
  for (const [k, v] of Object.entries(base.song)) {
    if ((chart.song as unknown as Record<string, unknown>)[k] === undefined) (chart.song as unknown as Record<string, unknown>)[k] = v;
  }
  chart.timing = chart.timing ?? base.timing;
  if (chart.timing.bpm_map === undefined) chart.timing.bpm_map = base.timing.bpm_map;
  if (chart.timing.resolution === undefined) chart.timing.resolution = RESOLUTION;
  if (chart.timing.grid_map === undefined) chart.timing.grid_map = base.timing.grid_map;
  if (chart.sections === undefined) chart.sections = [];
  if (chart.lanes === undefined) chart.lanes = chart.keyMode === 4 ? 4 : 2; // [10] keyMode 없음 = 2키
  if (chart.difficulties === undefined) chart.difficulties = [];
  if (chart.meta === undefined) chart.meta = {};
  for (const diff of chart.difficulties) {
    if (diff.level === undefined) diff.level = 0;
    if (diff.notes === undefined) diff.notes = [];
  }
  return chart;
}

/** 연타노트의 레인을 모두 양쪽(both)으로 바꾼다. 레인이 있던 연타노트의 개수를 돌려준다. */
function convertBurstLanes(chart: ChartV2): number {
  let changed = 0;
  for (const diff of chart.difficulties) {
    for (const n of diff.notes) {
      if (n.type === NOTE_BURST && n.lane !== LANE_BOTH) {
        if (typeof n.lane === 'number') changed += 1;
        n.lane = LANE_BOTH;
      }
    }
  }
  return changed;
}

// ---------- v1 → v2 변환 ----------

const LANE_ALIASES: Record<string, 0 | 1> = { '0': 0, left: 0, L: 0, '1': 1, right: 1, R: 1 };

/** 파일 경로 문자열에서 확장자를 뺀 이름만 꺼낸다. */
function pathStem(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 기존 프로토타입 JSON(초 단위)을 v2로 변환한다. (채보, 변환 못한 항목 메모 목록)을 돌려준다.
 * 규칙: 단일 BPM 맵. v1의 '박자 기준 시작점(beat_offset)'을 audio_offset_ms 로 옮기되, 시작점보다 앞에 있는 노트도
 * 잃지 않도록 시작점을 마디 단위로 앞당긴다(마디 위상은 유지). 그래서 audio_offset_ms 는 0 또는 음수가 될 수 있다.
 */
export function convertV1ToV2(v1: Record<string, unknown>): [ChartV2, string[]] {
  const log: string[] = [];
  let bpm = Number(v1.bpm ?? 120);
  if (!(bpm > 0 && bpm <= 1000)) {
    log.push(`BPM 값(${String(v1.bpm)})이 올바르지 않아 120으로 대체했습니다.`);
    bpm = 120.0;
  }
  let beatOffset = Number(v1.beat_offset || 0);
  if (Number.isNaN(beatOffset)) {
    log.push('beat_offset 값을 읽지 못해 0으로 대체했습니다.');
    beatOffset = 0.0;
  }

  const meter = String(v1.meter ?? '4');
  const meters: Record<string, [number, number]> = { '4': [4, 4], '3': [3, 4], '6/8': [6, 8] };
  const [bpb, unit] = meters[meter] ?? [4, 4];
  if (!(meter in meters)) log.push(`알 수 없는 마디 표시(${meter})라서 4/4로 대체했습니다.`);

  const beatMs = 60000.0 / bpm;
  const barMs = (beatMs * 4 * bpb) / unit;
  // 시작점을 마디 단위로 앞당겨 0 이하로 만든다 (모든 노트가 tick 0 이상이 되도록)
  const shiftBars = beatOffset > 0 ? Math.ceil((beatOffset * 1000.0) / barMs) : 0;
  let offsetMs = beatOffset * 1000.0 - shiftBars * barMs;
  offsetMs = Math.round(offsetMs * 1000) / 1000;

  const title = (v1.title as string) || pathStem(String(v1.audio_file ?? ''));
  const chart = newChart(
    title,
    '',
    (v1.audio_file as string) || '',
    pyRound(Number(v1.duration || 0) * 1000),
    offsetMs,
  );
  chart.timing.bpm_map = [{ tick: 0, bpm, beats_per_bar: bpb, beat_unit: unit }];
  const divRaw = Number.parseInt(String(v1.grid_division), 10);
  const div = Number.isNaN(divRaw) ? null : divRaw;
  if (div !== null && GRID_DIVISIONS.includes(div)) {
    chart.timing.grid_map = [{ tick: 0, division: div }];
  } else if (v1.grid_division !== undefined && v1.grid_division !== null) {
    log.push(`격자 분할(${String(v1.grid_division)}분)은 v2에서 지원하지 않아 16분으로 대체했습니다.`);
  }
  chart.meta.created_by_engine = `v1_import:${(v1.analysis_mode as string) || 'unknown'}`;

  const diffName = ['EASY', 'NORMAL', 'HARD'].includes(String(v1.difficulty)) ? String(v1.difficulty) : 'CUSTOM';
  const notes: ChartNote[] = [];
  const bpmMap = new BpmMap(chart.timing.bpm_map);
  let skippedType = 0;
  let skippedLane = 0;
  let skippedTime = 0;
  const rawNotes = Array.isArray(v1.notes) ? (v1.notes as Record<string, unknown>[]) : [];
  for (const raw of rawNotes) {
    if ((raw.type ?? 'tap') !== 'tap') {
      skippedType += 1;
      continue;
    }
    const lane = LANE_ALIASES[String(raw.lane)];
    if (lane === undefined) {
      skippedLane += 1;
      continue;
    }
    const tMs = Number(raw.time) * 1000.0;
    if (raw.time === undefined || raw.time === null || Number.isNaN(tMs)) {
      skippedTime += 1;
      continue;
    }
    const tick = bpmMap.msToTickInt(tMs - offsetMs);
    if (tick < 0) {
      skippedTime += 1;
      continue;
    }
    notes.push({ id: notes.length + 1, type: NOTE_TAP, lane, tick });
  }
  if (skippedType) log.push(`단타(tap)가 아닌 노트 ${skippedType}개는 v1에 없는 종류라 제외했습니다.`);
  if (skippedLane) log.push(`레인 값이 올바르지 않은 노트 ${skippedLane}개를 제외했습니다.`);
  if (skippedTime) log.push(`시간 값이 없거나 올바르지 않은 노트 ${skippedTime}개를 제외했습니다.`);
  notes.sort((a, b) => a.tick - b.tick || (a.lane as number) - (b.lane as number));
  notes.forEach((n, i) => {
    n.id = i + 1;
  });
  chart.difficulties = [{ name: diffName, level: 0, notes }];
  if (shiftBars) {
    log.push(
      `박자 시작점(${beatOffset.toFixed(3)}초)을 ${shiftBars}마디 앞당겨 audio_offset_ms=${offsetMs.toFixed(1)} 로 기록했습니다 (노트 소리 위치는 그대로).`,
    );
  }
  log.push(`변환 정밀도: 초 → tick 반올림 오차는 최대 반 tick (${(beatMs / RESOLUTION / 2).toFixed(3)}ms @${fmtG(bpm)}BPM).`);
  return [chart, log];
}

// ---------- 내보내기 ----------

/** 편집용 내보내기: v2 전체를 JSON 문자열로. 오류가 있어도 편집용은 내보낼 수 있다(작업 공유용). */
export function exportEditJson(chart: ChartV2): string {
  return JSON.stringify(chart, null, 2);
}

export const UNITY_FORMAT = 'two-key-unity.v2'; // v2: 연타노트 lane = 'both'
/** [10단계] 4키 Unity 내보내기 형식 이름. 2키 형식(two-key-unity.v2)은 그대로 두고 4키만 다른 이름을 쓴다. */
export const UNITY_FORMAT_4KEY = 'four-key-unity.v2';

export interface UnityNote {
  type: string;
  lane: number | string;
  time_ms: number;
  duration_ms: number;
  count: number;
}
export interface UnityDifficulty {
  name: string;
  level: number;
  notes: UnityNote[];
}
/** Unity용 내보내기 데이터. 플레이 화면이 입력으로 받는 형식. */
export interface UnityChart {
  format: string;
  /** 4키 채보에만 들어간다(4). 2키 파일에는 없다. */
  key_mode?: number;
  song: { title: string; artist: string; audio_file: string; duration_ms: number };
  lanes: number;
  lane_values: Record<string, string>;
  judge: Record<string, number>;
  note_rules: Record<string, string>;
  difficulties: UnityDifficulty[];
}

/** Unity용 데이터를 만든다. 모든 노트를 ms 정수로 미리 변환하고 audio_offset_ms 와 decoder_delay_ms 를 합산한다. */
export function buildUnityData(chart: ChartV2): UnityChart {
  const bpmMap = new BpmMap(chart.timing.bpm_map, chart.timing.resolution ?? RESOLUTION);
  const offset = (chart.song.audio_offset_ms || 0) + (chart.song.decoder_delay_ms || 0);
  const judgeCfg = loadJudgeConfig();
  const difficulties: UnityDifficulty[] = chart.difficulties.map((diff: Difficulty) => {
    const sorted = [...diff.notes].sort((a, b) => a.tick - b.tick || laneSortKey(a.lane) - laneSortKey(b.lane));
    const out: UnityNote[] = sorted.map((n) => {
      const start = pyRound(bpmMap.tickToMs(n.tick) + offset);
      let duration = 0;
      if (n.type !== NOTE_TAP) {
        const end = pyRound(bpmMap.tickToMs(n.tick + (n.length_tick as number)) + offset);
        duration = Math.max(1, end - start);
      }
      return {
        type: n.type,
        lane: n.lane as number | string,
        time_ms: start,
        duration_ms: duration,
        count: n.type === 'burst' ? (n.count ?? 0) : 0,
      };
    });
    return { name: diff.name, level: diff.level ?? 0, notes: out };
  });
  const song = chart.song;
  if (chartKeyMode(chart) === 4) {
    return {
      format: UNITY_FORMAT_4KEY,
      key_mode: 4,
      song: { title: song.title ?? '', artist: song.artist ?? '', audio_file: song.audio_file ?? '', duration_ms: song.duration_ms ?? 0 },
      lanes: 4,
      lane_values: {
        '0': `1레인 (${FOUR_KEY_LABELS[0]})`, '1': `2레인 (${FOUR_KEY_LABELS[1]})`, '2': `3레인 (${FOUR_KEY_LABELS[2]})`, '3': `4레인 (${FOUR_KEY_LABELS[3]})`,
        both: '4레인 전체 폭 (연타노트 전용)',
      },
      judge: { ...judgeCfg },
      note_rules: { ...cloneJson(NOTE_RULES_TEXT), burst: NOTE_RULES_BURST_4KEY },
      difficulties,
    };
  }
  return {
    format: UNITY_FORMAT,
    song: { title: song.title ?? '', artist: song.artist ?? '', audio_file: song.audio_file ?? '', duration_ms: song.duration_ms ?? 0 },
    lanes: chart.lanes ?? 2,
    lane_values: { '0': '왼쪽 레인', '1': '오른쪽 레인', both: '양쪽 레인 전체 폭 (연타노트 전용)' },
    judge: { ...judgeCfg },
    note_rules: cloneJson(NOTE_RULES_TEXT),
    difficulties,
  };
}

/**
 * Unity용 내보내기 데이터. 채보 검사 내용은 편집기의 검사 목록에 표시한다.
 * difficulty 를 주면 그 난이도 하나만 담는다(없으면 모든 난이도).
 */
export function exportUnity(chart: ChartV2, difficulty?: string): UnityChart {
  const data = buildUnityData(chart);
  if (difficulty !== undefined) {
    const found = data.difficulties.filter((d) => d.name === difficulty);
    if (!found.length) throw new ChartFormatError(`'${difficulty}' 난이도가 채보에 없습니다.`);
    data.difficulties = found;
  }
  return data;
}

/** 난이도 하나에 남아 있는 구형 연타노트 위치 목록(2.2) */
export interface LegacyBurstGroup {
  difficulty: string;
  ticks: number[];
}

/**
 * [2.2] 구형 저장본의 연타노트를 난이도별로 찾는다(없으면 빈 목록). 연타는 보존만 하고 새로 만들지 못하게 했으므로,
 * 내보내기 전에 이 목록으로 안내하고 중단한다. 채보는 바꾸지 않는다.
 */
export function findLegacyBursts(chart: ChartV2): LegacyBurstGroup[] {
  const groups: LegacyBurstGroup[] = [];
  for (const diff of chart.difficulties) {
    const ticks: number[] = [];
    for (const note of diff.notes) {
      if (note.type === NOTE_BURST) ticks.push(note.tick);
    }
    if (ticks.length > 0) groups.push({ difficulty: diff.name, ticks });
  }
  return groups;
}

/** 난이도별로 나눈 Unity 데이터 목록 (원본의 '난이도별 파일 분리'). */
export function exportUnitySplit(chart: ChartV2): UnityChart[] {
  const all = exportUnity(chart);
  return all.difficulties.map((d) => ({ ...all, difficulties: [d] }));
}
