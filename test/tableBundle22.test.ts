// 2.2 단위 테스트: 테이블 개편 — 번들 v2 헤더(15·17열)·행·해시·manifest·구형 연타 차단·생성/편집 경로 닫기
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chartFromJson, chartToJson, findLegacyBursts, newChart } from '../src/core/index.ts';
import type { ChartV2 } from '../src/core/index.ts';
import { resolveOptions } from '../src/generate/generate.ts';
import {
  BUNDLE_FORMAT, CHART_INFO_HEADER, SONG_INFO_HEADER, UnityBundleError, buildUnityBundle, csvCell,
} from '../src/storage/unityBundle.ts';
import type { UnityBundle } from '../src/storage/unityBundle.ts';
// @ts-expect-error 편집기 JS 모듈(타입 선언 없음)
import { BURST_CLOSED_REASON, makeClip, setKeyMode, tryAdd, tryMoveGroup, tryPaste, tryUpdate } from '../src/editor/js/edit_rules.js';
// @ts-expect-error 편집기 JS 모듈
import { applyRatio, withoutBurst } from '../src/editor/js/ratio_rules.js';

const SONG_HEADER_TEXT =
  'id : int,name : string,attribute : string,stage : string,bpm : float,bpmMin : float,bpmMax : float,hasTempoChange : bool,durationMs : int,audioKey : string,syncOffsetMs : float,enabled : bool,sourceKey : string,audioHash : string,syncedAt : string';
const CHART_HEADER_TEXT =
  'id : int,name : string,songId : int,difficulty : Enum<Difficulty>,level : int,tapCount : int,holdCount : int,totalNotes : int,firstNoteMs : int,lastNoteMs : int,avgNps : float,maxNps : float,chartKey : string,enabled : bool,sourceKey : string,chartHash : string,syncedAt : string';

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b as never).digest('hex');
const audio = new Blob([new Uint8Array(Array.from({ length: 200 }, (_, i) => (i * 5) % 256))]);

/** 쉼표·따옴표를 지키며 CSV 한 줄을 칸으로 나눈다 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; } else if (ch === '"') quoted = false; else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(current); current = ''; } else current += ch;
  }
  cells.push(current);
  return cells;
}

/** 묶음 안 CSV 파일의 줄 목록(BOM 제거) */
function csvLines(bundle: UnityBundle, name: string): string[] {
  const text = bundle.files.find((f) => f.name === name)!.data as string;
  return text.slice(1).split('\r\n').filter(Boolean);
}

/** 단타 tapCount개 + 롱노트 holdCount개짜리 NORMAL 4키 채보 */
function makeChart(tapCount: number, holdCount: number, title = '곡 이름'): ChartV2 {
  const c = newChart(title, '가수', 'a.mp3', 600000, 0);
  c.keyMode = 4;
  c.lanes = 4;
  c.timing.bpm_map = [{ tick: 0, bpm: 120, beats_per_bar: 4, beat_unit: 4 }];
  const r = c.timing.resolution;
  const notes: ChartV2['difficulties'][number]['notes'] = [];
  for (let i = 0; i < tapCount; i++) notes.push({ id: notes.length + 1, type: 'tap', lane: i % 4, tick: i * (r / 2) });
  const holdStart = tapCount * (r / 2) + r;
  for (let j = 0; j < holdCount; j++) notes.push({ id: notes.length + 1, type: 'hold', lane: j % 4, tick: holdStart + j * 4 * r, length_tick: r });
  c.difficulties = [{ name: 'NORMAL', level: 3, notes }];
  return c;
}

/** 단타 3개 + 연타 1개가 EASY 난이도에 남은 구형 채보 */
function makeLegacyChart(): ChartV2 {
  const c = makeChart(4, 1);
  const r = c.timing.resolution;
  c.difficulties.push({
    name: 'EASY', level: 1,
    notes: [{ id: 1, type: 'tap', lane: 0, tick: 0 }, { id: 2, type: 'burst', lane: 'both', tick: 4 * r, length_tick: r, count: 8 }],
  });
  return c;
}

describe('2.2 테이블 개편 · 번들 v2', () => {
  it('① 헤더 글자·순서·열 개수(15·17)', () => {
    expect(SONG_INFO_HEADER.join(',')).toBe(SONG_HEADER_TEXT);
    expect(CHART_INFO_HEADER.join(',')).toBe(CHART_HEADER_TEXT);
    expect([SONG_INFO_HEADER.length, CHART_INFO_HEADER.length]).toEqual([15, 17]);
    expect(BUNDLE_FORMAT).toBe('chart-bundle.v2');
  });

  it('② songInfo 한 행: 열 위치·빈칸·syncOffsetMs 0', async () => {
    const b = await buildUnityBundle({ chart: makeChart(3, 1), audioBlob: audio, audioFileName: 'a.mp3' });
    const lines = csvLines(b, 'songInfo.csv');
    expect(lines[0]).toBe(SONG_HEADER_TEXT);
    expect(lines.length).toBe(2);
    const cells = splitCsvLine(lines[1]!);
    expect(cells.length).toBe(15);
    expect([cells[0], cells[1]]).toEqual(['0', '곡 이름']);
    expect([cells[2], cells[3], cells[9], cells[14]]).toEqual(['', '', '', '']); // attribute·stage·audioKey·syncedAt 빈칸
    expect([cells[4], cells[5], cells[6], cells[7]]).toEqual(['120', '120', '120', 'false']);
    expect([cells[8], cells[10], cells[11]]).toEqual(['600000', '0', 'true']);
    expect([cells[12], cells[13]]).toEqual([sha(new Uint8Array(await audio.arrayBuffer())).slice(0, 16), sha(new Uint8Array(await audio.arrayBuffer()))]);
  });

  it('③ chartInfo 한 행: 열 위치·totalNotes·이름·빈칸', async () => {
    const b = await buildUnityBundle({ chart: makeChart(3, 1), audioBlob: audio });
    const lines = csvLines(b, 'chartInfo.csv');
    expect(lines[0]).toBe(CHART_HEADER_TEXT);
    const cells = splitCsvLine(lines[1]!);
    expect(cells.length).toBe(17);
    expect(cells.slice(0, 5)).toEqual(['0', '곡 이름 Normal', '0', 'Normal', '3']);
    expect(cells.slice(5, 8)).toEqual(['3', '1', '4']); // tap, hold, total = tap + hold
    expect([cells[12], cells[13], cells[16]]).toEqual(['', 'true', '']); // chartKey·enabled·syncedAt
  });

  it('④ chartHash 는 난이도 JSON 바이트의 SHA-256, sourceKey 는 음원 해시 앞 16자리', async () => {
    const b = await buildUnityBundle({ chart: makeChart(3, 1), audioBlob: audio });
    const json = b.files.find((f) => f.name === 'chart_Normal.json')!.data as string;
    const cells = splitCsvLine(csvLines(b, 'chartInfo.csv')[1]!);
    expect(cells[15]).toBe(sha(new TextEncoder().encode(json)));
    expect(cells[14]).toBe(b.folder);
  });

  it('⑤ 단타 310 + 롱노트 33 = 343', async () => {
    const b = await buildUnityBundle({ chart: makeChart(310, 33), audioBlob: audio });
    const cells = splitCsvLine(csvLines(b, 'chartInfo.csv')[1]!);
    expect(cells.slice(5, 8)).toEqual(['310', '33', '343']);    expect(b.summary.charts[0]!.totalNotes).toBe(343);
  });

  it('⑥ 이스케이프: 쉼표·따옴표 제목은 한 칸, 아티스트는 테이블에 없음', async () => {
    const b = await buildUnityBundle({ chart: makeChart(3, 1, '제목, "둘"'), audioBlob: audio });
    const song = csvLines(b, 'songInfo.csv')[1]!;
    expect(song.startsWith(`0,${csvCell('제목, "둘"')},`)).toBe(true);
    expect(splitCsvLine(song)[1]).toBe('제목, "둘"');
    expect(splitCsvLine(song).length).toBe(15);
    const all = (b.files.find((f) => f.name === 'songInfo.csv')!.data as string) + (b.files.find((f) => f.name === 'chartInfo.csv')!.data as string);
    expect(all).not.toContain('가수'); // artist·genre 는 CSV 로 내보내지 않는다
  });

  it('⑦ manifest: v2·keyMode 4·artist 유지·CSV 바이트 수와 해시', async () => {
    const b = await buildUnityBundle({ chart: makeChart(3, 1), audioBlob: audio, audioFileName: 'a.mp3', now: new Date('2026-11-24T00:00:00Z') });
    const m = JSON.parse(b.files[b.files.length - 1]!.data as string);
    expect(m.format).toBe('chart-bundle.v2');
    expect(m.keyMode).toBe(4);
    expect(m.song.artist).toBe('가수');
    for (const name of ['songInfo.csv', 'chartInfo.csv']) {
      const bytes = new TextEncoder().encode(b.files.find((f) => f.name === name)!.data as string);
      const info = m.files.find((f: { name: string }) => f.name === name);
      expect([info.bytes, info.sha256]).toEqual([bytes.length, sha(bytes)]);
    }
    expect(JSON.parse(b.files.find((f) => f.name === 'chart_Normal.json')!.data as string).song.artist).toBe('가수');
  });

  it('⑧ 구형 연타가 있으면 전체 번들 중단(난이도·개수 안내), 채보는 그대로', async () => {
    const chart = makeLegacyChart();
    const before = JSON.stringify(chart);
    await expect(buildUnityBundle({ chart, audioBlob: audio })).rejects.toThrow(UnityBundleError);
    await expect(buildUnityBundle({ chart, audioBlob: audio })).rejects.toThrow('EASY 난이도 1개');
    expect(JSON.stringify(chart)).toBe(before);
  });

  it('⑨ findLegacyBursts: 난이도별 위치 목록, 없으면 빈 목록', () => {
    const groups = findLegacyBursts(makeLegacyChart());
    expect(groups.length).toBe(1);
    expect(groups[0]!.difficulty).toBe('EASY');
    expect(groups[0]!.ticks).toEqual([3840]);
    expect(findLegacyBursts(makeChart(3, 1))).toEqual([]);
  });

  it('⑩ 구형 저장본 왕복: 연타 원본 보존, 삭제 후 단타로 다시 입력하면 내보내기 통과', async () => {
    const legacy = chartFromJson(chartToJson(makeLegacyChart())).chart;
    expect(findLegacyBursts(legacy).length).toBe(1); // 열어도 연타는 그대로
    const easy = legacy.difficulties.find((d) => d.name === 'EASY')!;
    easy.notes = easy.notes.filter((n) => n.type !== 'burst');
    easy.notes.push({ id: 9, type: 'tap', lane: 1, tick: 3840 });
    const b = await buildUnityBundle({ chart: legacy, audioBlob: audio });
    expect(b.summary.charts.map((c) => c.difficulty).sort()).toEqual(['Easy', 'Normal']);
  });

  it('⑪ artist 저장·재열기 왕복', () => {
    const back = chartFromJson(chartToJson(makeChart(3, 1))).chart;
    expect(back.song.artist).toBe('가수');
  });
});

describe('2.2 생성·편집에서 연타 경로 닫기', () => {
  it('⑫ 생성 옵션: 연타 비율·연타 넣기를 줘도 0·꺼짐', () => {
    const opt = resolveOptions({ ratios: { tap: 60, hold: 20, burst: 20 }, allow_burst: true, design_mode: 'unified' });
    expect(opt.ratios.burst).toBe(0);
    expect(opt.ratios.tap).toBe(90);
    expect(opt.allow_burst).toBe(false);
    const ref = resolveOptions({ design_mode: 'reference' });
    expect([ref.ratios.burst, ref.allow_burst]).toEqual([0, false]);
  });

  it('⑬ 비율 입력 규칙: 옛 저장값의 연타 비율은 0 으로 돌린다', () => {
    expect(withoutBurst({ tap: 70, hold: 20, burst: 10 })).toEqual({ tap: 80, hold: 20, burst: 0 });
    expect(applyRatio({ tap: 70, hold: 20, burst: 10 }, 'hold', '30').requested).toEqual({ tap: 70, hold: 30, burst: 0 });
  });

  it('⑭ 추가·붙여넣기·종류 전환·속성 편집이 연타를 거부, 연타 → 단타 전환은 허용', () => {
    setKeyMode(4);
    const burstNote = { id: 1, type: 'burst', lane: 'both', tick: 1000, length_tick: 960, count: 8 };
    const tapNote = { id: 2, type: 'tap', lane: 0, tick: 5000 };
    const add = tryAdd([], { type: 'burst', lane: 'both', tick: 0, length_tick: 960, count: 8 });
    expect([add.ok, add.reason]).toEqual([false, BURST_CLOSED_REASON]);
    expect(tryUpdate([tapNote], 2, { type: 'burst', lane: 'both', length_tick: 960, count: 8 }).ok).toBe(false); // 종류 전환
    expect(tryUpdate([burstNote], 1, { count: 20 }).ok).toBe(false); // 횟수 편집
    expect(tryUpdate([burstNote], 1, { tick: 2000 }).ok).toBe(false); // 이동
    expect(tryMoveGroup([burstNote, tapNote], [1, 2], 480).ok).toBe(false); // 그룹 이동
    expect(makeClip([burstNote], [1])).toBe(null); // 복사 제외
    expect(makeClip([burstNote, tapNote], [1, 2])!.items.length).toBe(1);
    expect(tryPaste([], { items: [{ type: 'burst', lane: 'both', rel: 0, length_tick: 960, count: 8 }], span: 960 }, 0).ok).toBe(false);
    const toTap = tryUpdate([burstNote], 1, { type: 'tap', lane: 0, length_tick: undefined, count: undefined });
    expect(toTap.ok).toBe(true);
    setKeyMode(2);
  });
});
