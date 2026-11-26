/**
 * 유니티 묶음(chart-bundle.v2) 만들기: 곡 하나 = 폴더 하나(이름은 곡 키 = 음원 SHA-256 앞 16자리).
 * 폴더 안에 음원·난이도별 Unity 채보 JSON·songInfo.csv(15열)·chartInfo.csv(17열)·manifest.json(맨 마지막)이 들어간다.
 * ZIP 과 무관한 순수 함수들이다(16단계에서 폴더에 바로 쓸 때도 같은 함수를 쓴다).
 * v1 → v2 변경(2.2): 두 CSV 의 열 순서·개수 교체, 연타·keyMode·skillPointCount 열 삭제, artist·genre 는 테이블에 내보내지 않는다.
 */
import { BpmMap, chartKeyMode, exportUnitySplit, findLegacyBursts, sha256Hex } from '../core/index.ts';
import type { ChartV2, LegacyBurstGroup, UnityChart, UnityNote } from '../core/index.ts';

export const BUNDLE_FORMAT = 'chart-bundle.v2';

/** 묶음을 만들 수 없을 때(메시지는 화면에 그대로 보여도 되는 쉬운 한국어) */
export class UnityBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnityBundleError';
  }
}

/** songInfo.csv 헤더 15열(유니티가 이 이름·순서로 읽는다) */
export const SONG_INFO_HEADER = [
  'id : int', 'name : string', 'attribute : string', 'stage : string',
  'bpm : float', 'bpmMin : float', 'bpmMax : float', 'hasTempoChange : bool', 'durationMs : int',
  'audioKey : string', 'syncOffsetMs : float', 'enabled : bool', 'sourceKey : string', 'audioHash : string', 'syncedAt : string',
];

/** chartInfo.csv 헤더 17열 */
export const CHART_INFO_HEADER = [
  'id : int', 'name : string', 'songId : int', 'difficulty : Enum<Difficulty>', 'level : int',
  'tapCount : int', 'holdCount : int', 'totalNotes : int', 'firstNoteMs : int', 'lastNoteMs : int',
  'avgNps : float', 'maxNps : float', 'chartKey : string', 'enabled : bool', 'sourceKey : string', 'chartHash : string', 'syncedAt : string',
];

/** 묶음 안의 파일 한 개(manifest 제외 모두 data 가 문자열 또는 음원 Blob) */
export interface BundleFile {
  name: string;
  data: Blob | string;
}

/** 채보(난이도) 한 개의 통계(단타·롱노트만 센다) */
export interface ChartStats {
  tapCount: number;
  holdCount: number;
  totalNotes: number;
  firstNoteMs: number;
  lastNoteMs: number;
  avgNps: number;
  maxNps: number;
}

export interface UnityBundle {
  /** 폴더 이름 = 곡 키 */
  folder: string;
  /** manifest 가 마지막 */
  files: BundleFile[];
  summary: {
    sourceKey: string;
    audioSha256: string;
    songName: string;
    charts: { difficulty: string; file: string; totalNotes: number }[];
    totalBytes: number;
  };
}

export interface BuildBundleInput {
  chart: ChartV2;
  audioBlob?: Blob | null;
  audioFileName?: string;
  /** 시험용: manifest 의 createdAt 으로 쓸 시각 */
  now?: Date;
}

type CsvValue = string | number | boolean;

// ---------- CSV ----------

/** 소수는 최대 둘째 자리까지(점 사용) 문자열로 */
export function fmt2(x: number): string {
  return String(Number((Number.isFinite(x) ? x : 0).toFixed(2)));
}

/** CSV 칸 하나: 쉼표·따옴표·줄바꿈이 있으면 큰따옴표로 감싸고 안의 따옴표는 두 번 쓴다 */
export function csvCell(value: CsvValue): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV 문서: BOM + 헤더 1줄 + 데이터 줄들, 줄바꿈은 \r\n */
export function buildCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------- 통계 ----------

/** 통계가 비었을 때(노트 없음) */
function emptyStats(): ChartStats {
  return { tapCount: 0, holdCount: 0, totalNotes: 0, firstNoteMs: 0, lastNoteMs: 0, avgNps: 0, maxNps: 0 };
}

/** 시작 시각 목록을 정렬한 뒤, 1초 창 안에 들어간 노트 수의 최댓값 */
function maxNotesPerSecond(startTimes: number[]): number {
  startTimes.sort(compareNumbers);
  let maxNps = 0;
  let windowEnd = 0;
  for (let i = 0; i < startTimes.length; i++) {
    if (windowEnd < i) windowEnd = i;
    while (windowEnd < startTimes.length && startTimes[windowEnd]! < startTimes[i]! + 1000) windowEnd++;
    maxNps = Math.max(maxNps, windowEnd - i);
  }
  return maxNps;
}

/** 숫자 오름차순 비교 */
function compareNumbers(a: number, b: number): number {
  return a - b;
}

/**
 * Unity 채보 난이도 하나의 노트 통계(단타·롱노트 개수, 처음/마지막, 초당 노트 수).
 * 연타는 새 계약(v2)에 없어 세지 않는다(연타가 남은 채보는 묶음을 만들기 전에 막힌다).
 */
export function chartStats(notes: UnityNote[]): ChartStats {
  let tap = 0, hold = 0;
  let first = Infinity, last = -Infinity;
  const starts: number[] = [];
  for (const n of notes) {
    if (n.type === 'burst') continue;
    if (n.type === 'hold') hold += 1;
    else tap += 1;
    first = Math.min(first, n.time_ms);
    last = Math.max(last, n.time_ms + n.duration_ms);
    starts.push(n.time_ms);
  }
  const total = tap + hold;
  if (!total) return emptyStats();
  const span = (last - first) / 1000;
  return {
    tapCount: tap, holdCount: hold, totalNotes: total,
    firstNoteMs: first, lastNoteMs: last, avgNps: span > 0 ? total / span : 0, maxNps: maxNotesPerSecond(starts),
  };
}

/** BPM 요약: 기준 BPM(가장 오래 지속된 구간, 같으면 앞 구간)·최소·최대·변속 여부 */
export function bpmSummary(chart: ChartV2): { bpm: number; bpmMin: number; bpmMax: number; hasTempoChange: boolean } {
  const map = new BpmMap(chart.timing.bpm_map, chart.timing.resolution);
  const rows = map.entries;
  const dur = chart.song.duration_ms || 0;
  let best = rows[0]!;
  let bestLen = -1;
  rows.forEach((r, i) => {
    const start = map.tickToMs(r.tick);
    const end = i + 1 < rows.length ? map.tickToMs(rows[i + 1]!.tick) : dur;
    const len = end - start;
    if (len > bestLen) {
      bestLen = len;
      best = r;
    }
  });
  const all = rows.map((r) => r.bpm);
  const bpmMin = Math.min(...all);
  const bpmMax = Math.max(...all);
  return { bpm: best.bpm, bpmMin, bpmMax, hasTempoChange: Number(bpmMin.toFixed(2)) !== Number(bpmMax.toFixed(2)) };
}

/** 난이도 이름 → 유니티 열거형 이름 */
export function difficultyEnum(name: string): 'Easy' | 'Normal' | 'Hard' | 'Custom' {
  const m: Record<string, 'Easy' | 'Normal' | 'Hard'> = { EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard' };
  return m[name] ?? 'Custom';
}

/** 음원 파일 이름의 확장자(소문자, 없으면 mp3) */
export function audioExtension(fileName: string | undefined): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec((fileName || '').trim());
  return m ? m[1]!.toLowerCase() : 'mp3';
}

/** 문자열의 UTF-8 바이트 */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------- 행 만들기 ----------

/** songInfo.csv 한 행(SONG_INFO_HEADER 와 같은 순서). artist·genre 는 테이블에 없다. 빈 문자열도 한 칸이다 */
export function buildSongRow(
  songName: string,
  bpm: { bpm: number; bpmMin: number; bpmMax: number; hasTempoChange: boolean },
  durationMs: number,
  sourceKey: string,
  audioHash: string,
): CsvValue[] {
  return [
    0, songName, '', '', fmt2(bpm.bpm), fmt2(bpm.bpmMin), fmt2(bpm.bpmMax), bpm.hasTempoChange, durationMs || 0,
    '', 0, true, sourceKey, audioHash, '',
  ];
}

/** chartInfo.csv 한 행(CHART_INFO_HEADER 와 같은 순서). totalNotes = tapCount + holdCount */
export function buildChartRow(
  songName: string,
  difficulty: string,
  level: number,
  stats: ChartStats,
  sourceKey: string,
  chartHash: string,
): CsvValue[] {
  return [
    0, `${songName} ${difficulty}`, 0, difficulty, level || 0,
    stats.tapCount, stats.holdCount, stats.tapCount + stats.holdCount, stats.firstNoteMs, stats.lastNoteMs,
    fmt2(stats.avgNps), fmt2(stats.maxNps), '', true, sourceKey, chartHash, '',
  ];
}

// ---------- 구형 연타 확인 ----------

/** 구형 연타가 남은 채보의 안내 문장(난이도와 몇 개인지) */
export function describeLegacyBursts(groups: LegacyBurstGroup[]): string {
  const parts: string[] = [];
  for (const g of groups) parts.push(`${g.difficulty} 난이도 ${g.ticks.length}개`);
  return `연타노트가 남아 있어 유니티로 내보낼 수 없습니다 (${parts.join(', ')}). 해당 노트를 삭제하고 단타나 롱노트로 다시 입력해 주세요.`;
}

/** 구형 연타가 하나라도 있으면 묶음을 만들기 전에 중단한다 */
function assertNoLegacyBurst(chart: ChartV2): void {
  const groups = findLegacyBursts(chart);
  if (groups.length > 0) throw new UnityBundleError(describeLegacyBursts(groups));
}

// ---------- 묶음 만들기 ----------

/**
 * 4키 채보 + 원본 음원으로 유니티 묶음을 만든다. 파일은 manifest.json 이 맨 마지막이다.
 * 4키가 아니거나 음원·노트가 없거나 구형 연타가 남아 있으면 UnityBundleError, 채보에 오류가 있으면 exportUnitySplit 이 ExportBlocked 를 던진다.
 */
export async function buildUnityBundle(input: BuildBundleInput): Promise<UnityBundle> {
  const { chart, audioBlob } = input;
  if (chartKeyMode(chart) !== 4) throw new UnityBundleError('2키 채보는 아직 유니티로 보낼 수 없습니다. 4키 채보로 만들어 주세요.');
  if (!audioBlob) throw new UnityBundleError('이 곡의 음원 파일이 없어 내보낼 수 없습니다.');
  assertNoLegacyBurst(chart); // 난이도를 나누기 전에 확인해 전체 출력을 중단한다

  const parts = exportUnitySplit(chart).filter((p) => p.difficulties[0]!.notes.length > 0);
  if (!parts.length) throw new UnityBundleError('노트가 있는 난이도가 없어 내보낼 수 없습니다.');

  const audioHash = await sha256Hex(await audioBlob.arrayBuffer());
  const sourceKey = audioHash.slice(0, 16);
  const audioFile = `audio.${audioExtension(input.audioFileName)}`;
  const origName = (input.audioFileName || '').trim();
  const songName = chart.song.title || origName.replace(/\.[^.\\/]+$/, '');
  const bpm = bpmSummary(chart);

  const files: BundleFile[] = [{ name: audioFile, data: audioBlob }];
  const chartRows: CsvValue[][] = [];
  const chartEntries: { difficulty: string; file: string; totalNotes: number }[] = [];
  const fileInfos: { name: string; bytes: number; sha256: string }[] = [{ name: audioFile, bytes: audioBlob.size, sha256: audioHash }];

  for (const p of parts as UnityChart[]) {
    const d = p.difficulties[0]!;
    const diff = difficultyEnum(d.name);
    const file = `chart_${diff}.json`;
    const text = JSON.stringify(p, null, 2);
    const bytes = utf8(text);
    const hash = await sha256Hex(bytes); // 실제 난이도 JSON 바이트의 해시
    const s = chartStats(d.notes);
    files.push({ name: file, data: text });
    fileInfos.push({ name: file, bytes: bytes.length, sha256: hash });
    chartEntries.push({ difficulty: diff, file, totalNotes: s.totalNotes });
    chartRows.push(buildChartRow(songName, diff, d.level, s, sourceKey, hash));
  }

  const songCsv = buildCsv(SONG_INFO_HEADER, [buildSongRow(songName, bpm, chart.song.duration_ms, sourceKey, audioHash)]);
  const chartCsv = buildCsv(CHART_INFO_HEADER, chartRows);
  // manifest 에 최종 CSV 바이트 수·해시를 기록한다(위에서 만든 문자열 그대로의 UTF-8 바이트)
  for (const [name, text] of [['songInfo.csv', songCsv], ['chartInfo.csv', chartCsv]] as const) {
    const bytes = utf8(text);
    files.push({ name, data: text });
    fileInfos.push({ name, bytes: bytes.length, sha256: await sha256Hex(bytes) });
  }

  const manifest = {
    format: BUNDLE_FORMAT,
    createdAt: (input.now ?? new Date()).toISOString(),
    keyMode: 4,
    sourceKey,
    song: {
      title: chart.song.title || songName, artist: chart.song.artist || '', durationMs: chart.song.duration_ms || 0,
      audioFile, audioOriginalName: origName, audioSha256: audioHash,
    },
    charts: chartEntries.map((c) => ({ difficulty: c.difficulty, file: c.file })),
    files: fileInfos,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  files.push({ name: 'manifest.json', data: manifestText });

  const totalBytes = fileInfos.reduce((n, f) => n + f.bytes, 0) + utf8(manifestText).length;
  return { folder: sourceKey, files, summary: { sourceKey, audioSha256: audioHash, songName, charts: chartEntries, totalBytes } };
}
