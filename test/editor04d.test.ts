/**
 * 04d 단위 테스트: 노트 모양 판정, 도움말, ZIP, 내보내기 파일 3종, 저장 동작(가짜 downloads), 폰/PC 문구.
 * 테스트 음원은 모두 코드로 합성한 소리다.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSampleChart } from '../src/core/sample.ts';
import { exportEditJson } from '../src/core/index.ts';
import { README_TEXT, buildExportFiles } from '../src/storage/exportFiles.ts';
import { readBundle } from '../src/storage/bundle.ts';
import { cleanFileName, downloadsErrorMessage, formatBytes, isPhoneLike, saveFile, savePrompt, browserSaveEnv } from '../src/storage/saveFiles.ts';
import type { SaveEnv } from '../src/storage/saveFiles.ts';
import { DEFAULT_APP_SETTINGS, sanitizeAppSettings } from '../src/storage/settingsStore.ts';
import { crc32, looksLikeZip, readZip, writeZip, ZipError } from '../src/storage/zip.ts';
// @ts-ignore 편집기 쪽 JS(타입 검사 제외 대상)
import { barHeight, longHitHalfW, noteDrawWidth, tapHit, tapHitHalf, tapPadPx } from '../src/editor/js/note_shape.js';
// @ts-ignore 편집기 쪽 JS
import { HELP_KEYS, buildHelp } from '../src/editor/js/help_rules.js';

// (04e) 주파수 세기표·띠 정렬 테스트는 파형으로 교체되어 test/wave04e.test.ts 로 옮겼다.

// ---------------------------------------------------------------- 2부. 노트 모양 판정
describe('노트 모양별 클릭 판정', () => {
  const laneW = 140;
  const span = 6000;
  it('동그라미: 반지름 14 원 안에서만 눌린다', () => {
    expect(tapHit('circle', 9, 9, laneW, span)).toBe(true);
    expect(tapHit('circle', 20, 0, laneW, span)).toBe(false);
    expect(tapHit('circle', 0, 15, laneW, span)).toBe(false);
  });
  it('바: 레인 폭 90% 가로 막대 위에서 눌리고, 위아래는 막대 높이 근처만 눌린다', () => {
    expect(noteDrawWidth({ type: 'tap' }, laneW, 'bar')).toBeCloseTo(laneW * 0.9, 5);
    expect(tapHit('bar', 50, 0, laneW, span)).toBe(true); // 동그라미라면 빗나갈 자리
    expect(tapHit('circle', 50, 0, laneW, span)).toBe(false);
    expect(tapHit('bar', 0, 5, laneW, span)).toBe(true);
    expect(tapHit('bar', 0, 25, laneW, span)).toBe(false);
    expect(tapHit('bar', laneW * 0.45 + 10, 0, laneW, span)).toBe(false);
    const half = tapHitHalf('bar', laneW, span);
    expect(half.hw).toBeGreaterThan(laneW * 0.45);
  });
  it('막대 높이는 8~12px, 확대 비율에 따라 바뀐다', () => {
    expect(barHeight(6000)).toBeCloseTo(11, 5);
    expect(barHeight(40000)).toBeGreaterThanOrEqual(8);
    expect(barHeight(1500)).toBeLessThanOrEqual(12);
    expect(barHeight(40000)).toBeLessThan(barHeight(1500));
  });
  it('롱노트·연타·영역 선택 여유도 모양에 맞는다', () => {
    expect(longHitHalfW({ type: 'hold' }, laneW, 'bar')).toBeCloseTo(laneW * 0.45 + 3, 5);
    expect(longHitHalfW({ type: 'hold' }, laneW, 'circle')).toBeCloseTo(laneW * 0.25 + 6, 5);
    expect(noteDrawWidth({ type: 'burst' }, laneW, 'bar')).toBeCloseTo(laneW * 2 - 16, 5); // 연타는 모양과 상관없이 전체 폭
    expect(tapPadPx('circle', span)).toBe(14);
    expect(tapPadPx('bar', span)).toBeLessThan(14);
  });
});

// ---------------------------------------------------------------- 3부. 도움말
describe('편집 도움말', () => {
  const flat = (): { keys: string[][]; desc: string }[] => buildHelp('select').flatMap((s: { rows: { keys: string[][]; desc: string }[] }) => s.rows);
  it('Delete / Backspace 삭제 줄이 따로 있다', () => {
    const row = HELP_KEYS.find((r: { keys: string[][] }) => r.keys.some((k) => k.includes('Delete')));
    expect(row).toBeTruthy();
    expect(row.keys).toEqual([['Delete'], ['Backspace']]);
    expect(row.desc).toBe('선택한 노트 삭제');
  });
  it('키보드 줄은 main.js 의 keydown 처리에 실제로 있는 키만 적는다', () => {
    const src = readFileSync('src/editor/js/main.js', 'utf8');
    const codeOf: Record<string, string> = {
      Space: "'Space'", Z: "'KeyZ'", Y: "'KeyY'", A: "'KeyA'", C: "'KeyC'", X: "'KeyX'", V: "'KeyV'", S: "'KeyS'", M: "'KeyM'",
      Delete: "'Delete'", Backspace: "'Backspace'", Esc: "'Escape'", '↑': "'ArrowUp'", '↓': "'ArrowDown'", '[': "'BracketLeft'", ']': "'BracketRight'",
    };
    for (const row of HELP_KEYS as { keys: string[][] }[]) {
      for (const combo of row.keys) {
        for (const chip of combo) {
          if (['Ctrl', 'Shift'].includes(chip)) continue;
          expect(codeOf[chip], `알 수 없는 키 ${chip}`).toBeTruthy();
          expect(src.includes(codeOf[chip]!), `${chip} 키 처리가 main.js 에 없음`).toBe(true);
        }
      }
    }
  });
  it('공통·도구별·화면 보기 구성이고, 새 기능(파형·변속 구간·노트 모양)과 현재 도구 강조가 있다', () => {
    const titles = buildHelp('hold').map((s: { title: string }) => s.title);
    expect(titles).toEqual(['키보드', '마우스·터치', '도구별', '화면 보기']);
    const tools = buildHelp('hold')[2].rows;
    expect(tools.map((r: { keys: string[][] }) => r.keys[0][0])).toEqual(['선택', '단타', '롱노트', '연타']);
    expect(tools.filter((r: { current?: boolean }) => r.current).length).toBe(1);
    expect(flat().some((r) => r.desc.includes('파형'))).toBe(true);
    expect(flat().some((r) => r.keys[0]![0] === '변속 구간')).toBe(true);
    expect(flat().some((r) => r.keys[0]![0] === '노트 모양')).toBe(true);
  });
});

// ---------------------------------------------------------------- 4부. ZIP
describe('ZIP 직접 구현', () => {
  it('CRC32 표준 값', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('쓰기 → 읽기 왕복 (한글 파일 이름 포함, 큰 바이너리)', async () => {
    const big = new Uint8Array(300000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 8)) & 255;
    const zip = await writeZip([
      { name: '채보.json', data: '{"a":"한글"}' },
      { name: '내 노래 (최종).mp3', data: new Blob([big as BlobPart]) },
      { name: '읽어보세요.txt', data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(await looksLikeZip(zip)).toBe(true);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['채보.json', '내 노래 (최종).mp3', '읽어보세요.txt']);
    expect(new TextDecoder().decode(await entries[0]!.read())).toBe('{"a":"한글"}');
    const back = await entries[1]!.read();
    expect(back.length).toBe(big.length);
    expect(crc32(back)).toBe(crc32(big));
    expect(Array.from(await entries[2]!.read())).toEqual([1, 2, 3]);
  });
  it('압축(deflate)된 ZIP 도 읽는다', async () => {
    const text = '리듬 채보 '.repeat(500);
    const raw = new TextEncoder().encode(text);
    const cs = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const comp = new Uint8Array(await new Response(cs).arrayBuffer());
    const name = new TextEncoder().encode('압축.txt');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(raw), true); lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(raw), true); cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, 0, true);
    cd.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, local.length + comp.length, true);
    const zip = new Blob([local as BlobPart, comp as BlobPart, cd as BlobPart, end as BlobPart]);
    const e = await readZip(zip);
    expect(e[0]!.name).toBe('압축.txt');
    expect(new TextDecoder().decode(await e[0]!.read())).toBe(text);
  });
  it('손상된 ZIP·빈 입력은 쉬운 한국어 오류', async () => {
    await expect(writeZip([])).rejects.toThrow('묶을 파일이 없습니다');
    await expect(readZip(new Uint8Array(0))).rejects.toThrow('빈 파일');
    await expect(readZip(new TextEncoder().encode('이건 zip 이 아닙니다 그냥 글자입니다 그냥 글자입니다'))).rejects.toThrow('ZIP');
    const good = new Uint8Array(await (await writeZip([{ name: 'a.txt', data: 'hello world' }])).arrayBuffer());
    // 끝 부분(중앙 디렉터리) 자르기
    await expect(readZip(good.slice(0, good.length - 10))).rejects.toBeInstanceOf(ZipError);
    // 내용 한 글자 바꾸기 → CRC 불일치
    const bad = good.slice();
    bad[30 + 5 + 2] = bad[30 + 5 + 2]! ^ 0xff;
    const entries = await readZip(bad);
    await expect(entries[0]!.read()).rejects.toThrow('손상');
    await expect(writeZip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }])).rejects.toThrow('같은 이름');
  });
});

// ---------------------------------------------------------------- 4부. 내보내기 파일 목록 3종
describe('내보내기 파일 3종', () => {
  const chart = buildSampleChart();
  chart.song.title = '테스트 곡: 1/2';
  const audio = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'audio/mpeg' });
  const base = { chart, audioBlob: audio, audioFileName: '원본 노래.mp3', split: false };

  it('채보 JSON: 편집용·Unity용 이름과 내용 (금지 문자는 지운다)', async () => {
    const edit = await buildExportFiles({ ...base, what: 'chart', kind: 'edit' });
    expect(edit).toHaveLength(1);
    expect(edit[0]!.name).toBe('테스트 곡_ 1_2_편집용.json');
    expect(await edit[0]!.blob.text()).toBe(exportEditJson(chart));
    const unity = await buildExportFiles({ ...base, what: 'chart', kind: 'unity' });
    expect(unity[0]!.name.endsWith('_unity.json')).toBe(true);
    expect(JSON.parse(await unity[0]!.blob.text()).format).toBe('two-key-unity.v2');
  });
  it('음원: 곡이름_음원.zip 안에 원본 이름 그대로', async () => {
    const f = await buildExportFiles({ ...base, what: 'audio', kind: 'edit' });
    expect(f).toHaveLength(1);
    expect(f[0]!.name).toBe('테스트 곡_ 1_2_음원.zip');
    expect(f[0]!.mime).toBe('application/zip');
    const e = await readZip(f[0]!.blob);
    expect(e.map((x) => x.name)).toEqual(['원본 노래.mp3']);
    expect(Array.from(await e[0]!.read())).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('채보 JSON + 음원: 채보.json, 원본 음원, 읽어보세요.txt', async () => {
    const f = await buildExportFiles({ ...base, what: 'both', kind: 'unity' });
    expect(f).toHaveLength(1);
    expect(f[0]!.name).toBe('테스트 곡_ 1_2_채보+음원.zip');
    const e = await readZip(f[0]!.blob);
    expect(e.map((x) => x.name)).toEqual(['채보.json', '원본 노래.mp3', '읽어보세요.txt']);
    expect(new TextDecoder().decode(await e[0]!.read())).toBe(exportEditJson(chart)); // 항상 편집용
    expect(new TextDecoder().decode(await e[2]!.read())).toBe(README_TEXT);
    expect(README_TEXT).toContain('[불러오기]');
    // 다시 열기용 읽기
    const b = await readBundle(f[0]!.blob);
    expect(b.audio!.name).toBe('원본 노래.mp3');
    expect(b.chartText).toBe(exportEditJson(chart));
  });
  it('음원이 없으면 쉬운 오류, 음원만 있는 ZIP 은 채보가 없다', async () => {
    await expect(buildExportFiles({ ...base, audioBlob: null, what: 'audio', kind: 'edit' })).rejects.toThrow('음원 파일이 없어');
    const f = await buildExportFiles({ ...base, what: 'audio', kind: 'edit' });
    const b = await readBundle(f[0]!.blob);
    expect(b.chartText).toBeNull();
    expect(b.audio).not.toBeNull();
  });
  it('난이도마다 따로(Unity용)가 여러 개면 ZIP 하나로 묶는다', async () => {
    const two = JSON.parse(JSON.stringify(chart));
    if (two.difficulties.length < 2) two.difficulties.push({ ...two.difficulties[0], name: 'HARD' });
    const f = await buildExportFiles({ ...base, chart: two, what: 'chart', kind: 'unity', split: true });
    expect(f).toHaveLength(1);
    expect(f[0]!.name.endsWith('_unity_난이도별.zip')).toBe(true);
    expect((await readZip(f[0]!.blob)).length).toBe(two.difficulties.length);
  });
});

// ---------------------------------------------------------------- 4부. 저장 동작
describe('저장 동작 (downloads → 저장 창 → <a download>)', () => {
  const blob = new Blob(['x'], { type: 'application/zip' });
  const file = { name: '곡_채보+음원.zip', blob };
  const noPicker = { picker: null };

  function env(over: Partial<SaveEnv> & { anchorCalls?: string[] }): SaveEnv {
    return {
      getDownloads: async () => null,
      picker: null,
      anchor: (n) => void over.anchorCalls?.push(n),
      ...over,
    };
  }

  it('downloads 가 있으면 그것으로 저장한다 (다른 방법은 부르지 않는다)', async () => {
    const calls: { filename: string }[] = [];
    let pickerCalled = false;
    const out = await saveFile(file, env({
      getDownloads: async () => ({ save: async (r) => { calls.push(r); return { status: 'saved' }; } }),
      picker: async () => { pickerCalled = true; throw new Error('x'); },
    }));
    expect(out.status).toBe('saved');
    expect(out.method).toBe('downloads');
    expect(calls[0]!.filename).toBe('곡_채보+음원.zip');
    expect(pickerCalled).toBe(false);
  });

  it('오류 코드별 문구: declined 는 조용히, rate_limited 는 잠시 뒤, rejected_extension·unavailable·그 밖은 이유 안내', async () => {
    const run = (code: string): Promise<ReturnType<typeof saveFile> extends Promise<infer R> ? R : never> =>
      saveFile(file, env({ getDownloads: async () => ({ save: async () => { throw { code, message: 'x' }; } }) }));
    const declined = await run('declined');
    expect(declined.status).toBe('declined');
    const rate = await run('rate_limited');
    expect(rate.status).toBe('failed');
    expect(rate.message).toContain('잠시 뒤');
    const ext = await run('rejected_extension');
    expect(ext.message).toContain('.zip');
    expect(ext.message).toContain('저장할 수 없습니다');
    const un = await run('unavailable');
    expect(un.message).toContain('저장 기능을 쓸 수 없습니다');
    const other = await run('weird_code');
    expect(other.status).toBe('failed');
    expect(other.message).toContain('weird_code');
    expect(downloadsErrorMessage('too_large')).toContain('너무 커서');
  });

  it('오류가 나도 자동으로 다시 시도하지 않는다 (save 1번만 호출)', async () => {
    let n = 0;
    await saveFile(file, env({ getDownloads: async () => ({ save: async () => { n++; throw { code: 'rate_limited' }; } }) }));
    expect(n).toBe(1);
  });

  it('downloads 가 없으면(null) 저장 창, 저장 창이 없으면 <a download>, 안내 문구는 <a download> 일 때만 다운로드 폴더', async () => {
    const written: Blob[] = [];
    const viaPicker = await saveFile(file, env({
      picker: async () => ({ createWritable: async () => ({ write: async (b) => void written.push(b), close: async () => undefined }) }),
    }));
    expect(viaPicker.method).toBe('picker');
    expect(viaPicker.message).not.toContain('다운로드 폴더');
    expect(written).toHaveLength(1);

    const cancel = await saveFile(file, env({ picker: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }));
    expect(cancel.status).toBe('declined');

    const anchorCalls: string[] = [];
    const viaAnchor = await saveFile(file, env({ ...noPicker, anchorCalls }));
    expect(viaAnchor.method).toBe('anchor');
    expect(viaAnchor.message).toContain('다운로드 폴더');
    expect(anchorCalls).toEqual(['곡_채보+음원.zip']);

    // 저장 창이 보안 때문에 거부되면 <a download> 로 넘어간다
    const fallback = await saveFile(file, env({ picker: async () => { throw Object.assign(new Error('x'), { name: 'SecurityError' }); }, anchorCalls }));
    expect(fallback.method).toBe('anchor');
  });

  it('window.claude 가 없거나 use 가 null 이어도 오류 없이 넘어간다', async () => {
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    try {
      g.window = { claude: { use: () => null } };
      expect(await browserSaveEnv().getDownloads()).toBeNull();
      g.window = { claude: { use: async () => { throw new Error('no'); } } };
      expect(await browserSaveEnv().getDownloads()).toBeNull();
      g.window = {};
      expect(await browserSaveEnv().getDownloads()).toBeNull();
      const dl = { save: async () => ({ status: 'saved' }) };
      g.window = { claude: { use: async (n: string) => (n === 'downloads' ? dl : null) } };
      expect(await browserSaveEnv().getDownloads()).toBe(dl);
    } finally {
      g.window = prev;
    }
  });

  it('폰/PC 문구가 갈라진다', () => {
    expect(isPhoneLike((q) => q === '(pointer: coarse)', 1400)).toBe(true);
    expect(isPhoneLike(() => false, 800)).toBe(true);
    expect(isPhoneLike(() => false, 1280)).toBe(false);
    const phone = savePrompt(true);
    expect(phone.question).toBe('이 파일을 휴대폰에 다운로드할까요?');
    expect(phone.note).toContain('공유 시트');
    const pc = savePrompt(false);
    expect(pc.question).not.toContain('휴대폰');
    expect(pc.note).toContain('다운로드 폴더');
    expect(pc.note).toContain('허용');
    expect(formatBytes(1536 * 1024)).toBe('1.5MB');
    expect(formatBytes(300)).toBe('1KB');
  });

  it('파일 이름 칸: 금지 문자를 지우고 확장자를 지킨다', () => {
    expect(cleanFileName('새 이름', '곡.zip')).toBe('새 이름.zip');
    expect(cleanFileName('a/b:c.zip', '곡.zip')).toBe('abc.zip');
    expect(cleanFileName('   ', '곡.zip')).toBe('곡.zip');
  });
});

// ---------------------------------------------------------------- 설정
describe('설정 rcw.settings.v1 의 새 항목', () => {
  it('editNoteShape 기본 circle, showWave 기본 null(기기에 맞춤), 옛 showFreq 값 이어받기, 이상한 값은 기본값', () => {
    expect(DEFAULT_APP_SETTINGS.editNoteShape).toBe('circle');
    expect(DEFAULT_APP_SETTINGS.showWave).toBeNull();
    const a = sanitizeAppSettings({ editNoteShape: 'bar', showWave: false }).settings;
    expect(a.editNoteShape).toBe('bar');
    expect(a.showWave).toBe(false);
    expect(sanitizeAppSettings({ showFreq: true }).settings.showWave).toBe(true); // 04d 값 이어받기
    expect(sanitizeAppSettings({ showFreq: true, showWave: false }).settings.showWave).toBe(false);
    const b = sanitizeAppSettings({ editNoteShape: 'star', showWave: 'yes' }).settings;
    expect(b.editNoteShape).toBe('circle');
    expect(b.showWave).toBeNull();
  });
});
