/** 2.1 곡 제목·아티스트 입력: 공백 정리·빈 제목 되돌림·길이 제한·rec.name 동기화·CSV·휴지통 복원·저장 안 된 변경 */
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import { renderDemoSamples, encodeWav16, DEMO_SAMPLE_RATE } from '../src/storage/demoSong.ts';
import { SongStore, createMemoryAdapter } from '../src/storage/songStore.ts';
import { buildCsv } from '../src/storage/unityBundle.ts';
// @ts-ignore 편집기 쪽 JS(타입 검사 제외 대상)
import { api, configureLocalApi, waitForAnalysis } from '../src/app/localApi.js';

let store: SongStore;
const samples22k = renderDemoSamples(22050, 30);
const wavBytes = encodeWav16(renderDemoSamples(DEMO_SAMPLE_RATE, 30), DEMO_SAMPLE_RATE);
const makeFile = (name = '원본 곡.wav') => new File([wavBytes as BlobPart], name, { type: 'audio/wav' });

beforeEach(() => {
  store = new SongStore(createMemoryAdapter());
  configureLocalApi({
    store,
    decode: async () => ({ durationMs: 30000 }),
    analyzeFile: async (_f: Blob, opts: Record<string, unknown>, p?: (x: number, l: string) => void) => analyzeAudio(samples22k, opts, p),
    cancelAnalysis: () => undefined,
    createObjectUrl: (b: Blob) => `blob:test/${b.size}`,
    revokeObjectUrl: () => undefined,
  });
});

/** 한 줄 CSV 를 따옴표 규칙대로 칸으로 나눈다 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

describe('2.1 곡 제목·아티스트 저장', () => {
  it('공백을 다듬고 rec.name·chart.song.title 을 같은 값으로, 아티스트를 저장', async () => {
    const info = await api.importFile(makeFile());
    const res = await api.saveSongInfo(info.id, { title: '  새   제목 ', artist: ' 가수\t이름  ' });
    expect(res.title).toBe('새 제목');
    expect(res.artist).toBe('가수 이름');
    const rec = await store.get(info.id, false);
    expect(rec!.name).toBe('새 제목');
    expect(rec!.chart!.song.title).toBe('새 제목');
    expect(rec!.chart!.song.artist).toBe('가수 이름');
    expect((await api.songs()).songs[0].title).toBe('새 제목');
  });

  it('빈 제목·공백만 있는 제목은 음원 파일 이름(확장자 제외)으로 돌아온다', async () => {
    const info = await api.importFile(makeFile('내 곡 파일.wav'));
    await api.saveSongInfo(info.id, { title: '바뀜', artist: 'A' });
    expect((await api.saveSongInfo(info.id, { title: '', artist: 'A' })).title).toBe('내 곡 파일');
    expect((await api.saveSongInfo(info.id, { title: '   ', artist: 'A' })).title).toBe('내 곡 파일');
    const rec = await store.get(info.id, false);
    expect(rec!.name).toBe('내 곡 파일');
    expect(rec!.chart!.song.artist).toBe('A');
  });

  it('100자는 저장되고 101자는 오류, 기존 값은 그대로', async () => {
    const info = await api.importFile(makeFile());
    await api.saveSongInfo(info.id, { title: '처음', artist: '처음가수' });
    const ok = await api.saveSongInfo(info.id, { title: '가'.repeat(100), artist: '나'.repeat(100) });
    expect([...ok.title]).toHaveLength(100);
    await api.saveSongInfo(info.id, { title: '처음', artist: '처음가수' });
    await expect(api.saveSongInfo(info.id, { title: '가'.repeat(101), artist: 'x' })).rejects.toThrow('100자');
    await expect(api.saveSongInfo(info.id, { title: 'y', artist: '나'.repeat(101) })).rejects.toThrow('100자');
    const rec = await store.get(info.id, false);
    expect(rec!.name).toBe('처음');
    expect(rec!.chart!.song.artist).toBe('처음가수');
  });

  it('채보가 없는 곡은 rec.name 만 바꾼다', async () => {
    const info = await api.importFile(makeFile());
    const rec = (await store.get(info.id, false))!;
    // 채보를 비운 기록을 직접 저장(비공개 메서드 대신 어댑터에 바로 쓴다)
    const noChart = { ...rec, chart: null };
    const { audioBlob: _b, ...rest } = noChart as Record<string, unknown>;
    void _b;
    await (store as unknown as { kv: { put: (s: string, k: string, v: unknown) => Promise<void> } }).kv.put('songs', rec.id, rest);
    const res = await store.saveSongInfo(info.id, { title: '이름만', artist: 'x' });
    expect(res.title).toBe('이름만');
    expect((await store.get(info.id, false))!.chart).toBeNull();
  });

  it('바뀌면 이전 채보를 이력에 남기고, 같은 값이면 남기지 않는다', async () => {
    const info = await api.importFile(makeFile());
    await api.saveSongInfo(info.id, { title: '하나', artist: '' });
    expect((await store.get(info.id, false))!.history).toHaveLength(1);
    await api.saveSongInfo(info.id, { title: '하나', artist: '' });
    expect((await store.get(info.id, false))!.history).toHaveLength(1);
  });

  it('노트를 다시 생성해도 제목·아티스트가 유지된다', async () => {
    const info = await api.importFile(makeFile());
    await api.analyze({ song: info.id, detector: 'hybrid', sensitivity: 60 });
    await waitForAnalysis(info.id);
    await api.saveSongInfo(info.id, { title: '유지 제목', artist: '유지 가수' });
    const gen = await api.generate({ song: info.id, difficulty: 'NORMAL', grid_division: 8 });
    expect(gen.chart.song.title).toBe('유지 제목');
    expect(gen.chart.song.artist).toBe('유지 가수');
  });

  it('저장 안 된 노트 변경이 있어도 제목을 먼저 저장한 뒤 [저장]하면 둘 다 남는다', async () => {
    const info = await api.importFile(makeFile());
    const edited = JSON.parse(JSON.stringify((await api.getChart(info.id)).chart));
    edited.difficulties[0].notes.push({ id: 'n1', tick: 480, type: 'tap', lane: 0 });
    await api.saveSongInfo(info.id, { title: '편집 중 제목', artist: '편집 가수' }); // 화면은 메모리의 채보에도 같은 값을 넣는다
    edited.song.title = '편집 중 제목';
    edited.song.artist = '편집 가수';
    await api.putChart(info.id, edited);
    const rec = await store.get(info.id, false);
    expect(rec!.chart!.song.title).toBe('편집 중 제목');
    expect(rec!.chart!.song.artist).toBe('편집 가수');
    expect(rec!.chart!.difficulties[0].notes.length).toBeGreaterThan(0);
    expect(rec!.name).toBe('편집 중 제목');
  });

  it('휴지통에 보냈다 되돌려도 제목이 그대로, 같은 이름이 있으면 (2)가 붙는다', async () => {
    const a = await api.importFile(makeFile('a.wav'));
    await api.saveSongInfo(a.id, { title: '같은 이름', artist: '' });
    await store.trash(a.id);
    expect((await store.restore(a.id))!.renamed).toBe(false);
    expect((await store.get(a.id, false))!.chart!.song.title).toBe('같은 이름');
    const b = await store.addSong({ name: 'b', blob: makeFile('b.wav'), meta: { fileName: 'b.wav', mime: '', size: 1, sha256: 'b', durationMs: 1000 }, chart: null });
    await store.saveSongInfo(b.id, { title: '같은 이름', artist: '' });
    await store.trash(a.id);
    const r = await store.restore(a.id);
    expect(r!.renamed).toBe(true);
    const rec = (await store.get(a.id, false))!;
    expect(rec.name).toBe('같은 이름 (2)');
    expect(rec.chart!.song.title).toBe('같은 이름 (2)');
  });

  it('아티스트의 쉼표·큰따옴표가 CSV 한 줄을 깨지 않는다', () => {
    const artist = 'A, B "C"';
    const csv = buildCsv(['name : string', 'artist : string', 'x : int'], [['제목, 하나', artist, 1]]);
    const lines = csv.replace('﻿', '').split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(parseCsvLine(lines[1])).toEqual(['제목, 하나', artist, '1']);
  });
});
