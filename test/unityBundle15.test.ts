// 15단계 단위 테스트(2.2에서 v2 계약으로 기대값 수정): 유니티 묶음(chart-bundle.v2) — 곡 키·오류·난이도 이름·CSV·통계·BPM·manifest·ZIP
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newChart } from '../src/core/index.ts';
import type { ChartV2 } from '../src/core/index.ts';
import { buildExportFiles } from '../src/storage/exportFiles.ts';
import {
  CHART_INFO_HEADER, SONG_INFO_HEADER, bpmSummary, buildCsv, buildUnityBundle, chartStats, csvCell, difficultyEnum,
} from '../src/storage/unityBundle.ts';
import { readZip } from '../src/storage/zip.ts';

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b as never).digest('hex');
const audio = new Blob([new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 7) % 256))]);
const audioHash = sha(new Uint8Array(await audio.arrayBuffer()));

/** 합성 4키 채보: NORMAL 에 단타 3·롱 1·연타 1, EASY 는 비어 있음 */
function makeChart(): ChartV2 {
  const c = newChart('테스트, "곡"', '아티스트', 'a.mp3', 60000, 0);
  c.keyMode = 4;
  c.lanes = 4;
  c.timing.bpm_map = [{ tick: 0, bpm: 120, beats_per_bar: 4, beat_unit: 4 }];
  const r = c.timing.resolution;
  c.difficulties = [
    { name: 'EASY', level: 1, notes: [] },
    {
      name: 'NORMAL', level: 3,
      notes: [
        { id: 1, type: 'tap', lane: 0, tick: 0 },
        { id: 2, type: 'tap', lane: 1, tick: r / 4 },
        { id: 3, type: 'hold', lane: 2, tick: r, length_tick: r },
        { id: 4, type: 'tap', lane: 0, tick: 4 * r },
        { id: 5, type: 'tap', lane: 3, tick: 8 * r },
      ],
    },
  ];
  return c;
}

describe('15 유니티 묶음', () => {
  it('① 곡 키는 음원 SHA-256 앞 16자리', async () => {
    const b = await buildUnityBundle({ chart: makeChart(), audioBlob: audio, audioFileName: 'a.MP3' });
    expect(b.folder).toBe(audioHash.slice(0, 16));
    expect(b.summary.audioSha256).toBe(audioHash);
    expect(b.files[0]!.name).toBe('audio.mp3');
  });

  it('② 4키가 아니면·음원이 없으면 오류', async () => {
    const two = makeChart();
    two.keyMode = 2;
    await expect(buildUnityBundle({ chart: two, audioBlob: audio })).rejects.toThrow('2키 채보는 아직 유니티로 보낼 수 없습니다');
    await expect(buildUnityBundle({ chart: makeChart(), audioBlob: null })).rejects.toThrow('음원 파일이 없어');
  });

  it('③ 노트 없는 난이도는 제외, 전부 없으면 오류', async () => {
    const b = await buildUnityBundle({ chart: makeChart(), audioBlob: audio });
    expect(b.summary.charts.map((c) => c.difficulty)).toEqual(['Normal']);
    const empty = makeChart();
    empty.difficulties.forEach((d) => (d.notes = []));
    await expect(buildUnityBundle({ chart: empty, audioBlob: audio })).rejects.toThrow('노트가 있는 난이도가 없어');
  });

  it('④ 난이도 이름 매핑', () => {
    expect(['EASY', 'NORMAL', 'HARD', 'CUSTOM', 'X'].map(difficultyEnum)).toEqual(['Easy', 'Normal', 'Hard', 'Custom', 'Custom']);
  });

  it('⑤⑥ 두 CSV의 헤더·열 개수·BOM·\\r\\n', async () => {
    const b = await buildUnityBundle({ chart: makeChart(), audioBlob: audio });
    for (const [name, header] of [['songInfo.csv', SONG_INFO_HEADER], ['chartInfo.csv', CHART_INFO_HEADER]] as const) {
      const text = b.files.find((f) => f.name === name)!.data as string;
      expect(text.startsWith('﻿')).toBe(true);
      const lines = text.slice(1).split('\r\n').filter(Boolean);
      expect(lines[0]).toBe(header.join(','));
      expect(lines.length).toBe(2);
      expect(header.length).toBe(name === 'songInfo.csv' ? 15 : 17); // 2.2: v2 열 개수
    }
  });

  it('⑦⑧ 종류별 개수·first/last·NPS (단타·롱노트만)', () => {
    const s = chartStats([
      { type: 'tap', lane: 0, time_ms: 1000, duration_ms: 0, count: 0 },
      { type: 'tap', lane: 1, time_ms: 1500, duration_ms: 0, count: 0 },
      { type: 'hold', lane: 2, time_ms: 2000, duration_ms: 500, count: 0 },
      { type: 'tap', lane: 3, time_ms: 6000, duration_ms: 0, count: 0 },
    ]);
    expect([s.tapCount, s.holdCount, s.totalNotes]).toEqual([3, 1, 4]);
    expect([s.firstNoteMs, s.lastNoteMs]).toEqual([1000, 6000]);
    expect(s.avgNps).toBeCloseTo(4 / 5, 5);
    expect(s.maxNps).toBe(2); // [1000,2000)에 1000·1500, [1500,2500)에 1500·2000 → 최대 2
  });

  it('⑨ 기준 BPM·최소/최대·변속 여부', () => {
    const c = makeChart();
    expect(bpmSummary(c)).toEqual({ bpm: 120, bpmMin: 120, bpmMax: 120, hasTempoChange: false });
    const r = c.timing.resolution;
    // 120BPM 으로 8박(4초) 뒤 90BPM 으로 바뀜 → 90BPM 구간이 56초라 더 오래 지속
    c.timing.bpm_map = [
      { tick: 0, bpm: 120, beats_per_bar: 4, beat_unit: 4 },
      { tick: 8 * r, bpm: 90, beats_per_bar: 4, beat_unit: 4 },
    ];
    expect(bpmSummary(c)).toEqual({ bpm: 90, bpmMin: 90, bpmMax: 120, hasTempoChange: true });
  });

  it('⑩ CSV 이스케이프', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    expect(buildCsv(['h : int'], [[1], [2]])).toBe('﻿h : int\r\n1\r\n2\r\n');
  });

  it('⑪ int/float/enum 칸이 비지 않음', async () => {
    const b = await buildUnityBundle({ chart: makeChart(), audioBlob: audio });
    // 곡 이름의 쉼표·따옴표 때문에 따옴표를 지키며 칸을 나누는 작은 파서
    const row = (name: string): string[] => {
      const t = (b.files.find((f) => f.name === name)!.data as string).slice(1).split('\r\n')[1]!;
      const out: string[] = [];
      let cur = '', q = false;
      for (let i = 0; i < t.length; i++) {
        const ch = t[i]!;
        if (q) {
          if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out;
    };
    for (const [name, header] of [['songInfo.csv', SONG_INFO_HEADER], ['chartInfo.csv', CHART_INFO_HEADER]] as const) {
      const cells = row(name);
      expect(cells.length).toBe(header.length);
      header.forEach((h, i) => {
        if (/: (int|float|bool|Enum)/.test(h)) expect(cells[i], h).not.toBe('');
      });
    }
  });

  it('⑫ manifest 가 마지막이고 files 의 이름·바이트·해시가 실제와 같음', async () => {
    const b = await buildUnityBundle({ chart: makeChart(), audioBlob: audio, audioFileName: 'a.mp3', now: new Date('2026-11-20T00:00:00Z') });
    expect(b.files[b.files.length - 1]!.name).toBe('manifest.json');
    const m = JSON.parse(b.files[b.files.length - 1]!.data as string);
    expect(m.format).toBe('chart-bundle.v2');
    expect(m.createdAt).toBe('2026-11-20T00:00:00.000Z');
    expect(m.files.map((f: { name: string }) => f.name).sort()).toEqual(b.files.slice(0, -1).map((f) => f.name).sort());
    for (const f of m.files) {
      const file = b.files.find((x) => x.name === f.name)!;
      const bytes = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : new Uint8Array(await file.data.arrayBuffer());
      expect(f.bytes).toBe(bytes.length);
      expect(f.sha256).toBe(sha(bytes));
    }
  });

  it('⑬ chartHash 가 채보 JSON 파일 해시와 같음', async () => {
    const b = await buildUnityBundle({ chart: makeChart(), audioBlob: audio });
    const json = b.files.find((f) => f.name === 'chart_Normal.json')!.data as string;
    const csv = b.files.find((f) => f.name === 'chartInfo.csv')!.data as string;
    expect(csv).toContain(sha(new TextEncoder().encode(json)));
    expect(JSON.parse(json).format).toBe('four-key-unity.v2');
  });

  it('⑭ ZIP 안 경로가 <곡키>/… 이고 다시 풀면 같은 내용', async () => {
    const files = await buildExportFiles({ what: 'unity', kind: 'unity', split: false, chart: makeChart(), audioBlob: audio, audioFileName: 'a.mp3' });
    expect(files.length).toBe(1);
    expect(files[0]!.name.endsWith('_유니티묶음.zip')).toBe(true);
    const entries = await readZip(files[0]!.blob);
    const key = audioHash.slice(0, 16);
    expect(entries.map((e) => e.name)).toEqual(['audio.mp3', 'chart_Normal.json', 'songInfo.csv', 'chartInfo.csv', 'manifest.json'].map((n) => `${key}/${n}`));
    const back = await entries[0]!.read();
    expect(sha(back)).toBe(audioHash);
    const manifest = JSON.parse(new TextDecoder().decode(await entries[4]!.read()));
    expect(manifest.sourceKey).toBe(key);
  });
});
