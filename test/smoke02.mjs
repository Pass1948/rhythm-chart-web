// 02단계 브라우저 스모크 테스트(헤드리스 Chrome, 개발자 도구 프로토콜(CDP)).
// 방식은 원본 tests\chrome_helper.mjs 와 D:\RhythmActionGame_HitRus\tools\cdp.mjs 를 읽고 같게 했다(새 패키지 없음).
// 흐름: dist 를 작은 정적 서버로 열기 → 첫 방문 화면 → 체험용 데모 곡 → 분석 모드 목록·진행률·취소 → 분석 → 노트 자동 생성
//       → 노트 1개 추가 → 복사·붙여넣기·되돌리기 → 저장 → 새로고침 후 복원 → 내보내기(다운로드 파일 내용 확인)
//       → 업로드 곡(코드로 합성한 WAV)으로 같은 흐름 → 같은 파일 다시 올리기(이미 있는 곡) → [테스트] 팝업 → 콘솔 오류 0건.
// 사용: npm run build 뒤에  node test/smoke02.mjs   (결과는 콘솔과 log\smoke02_result.json, 화면은 log\screens\02_*.png)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWav16, renderDemoSamples } from '../src/storage/demoSong.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shots = join(root, 'log', 'screens');
const downloads = join(root, 'log', 'downloads02', new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)); // 실행마다 새 폴더(예전 파일과 섞이지 않게)
const tmp = join(root, '_to_delete', '점검_임시');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const d of [shots, downloads, tmp]) mkdirSync(d, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---------- 정적 서버(dist) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(dist, p);
  if (!file.startsWith(dist) || !existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------- 업로드용 합성 WAV(음원 파일은 저장소에 두지 않는다: _to_delete\점검_임시 에 임시로만 만든다) ----------
const uploadPath = join(tmp, 'smoke02_upload_synth.wav');
writeFileSync(uploadPath, encodeWav16(renderDemoSamples(44100, 90), 44100));

// ---------- Chrome 연결 ----------
const port = 9402;
const profile = join(tmp, `chrome_profile_02_${Date.now()}`);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
], { stdio: 'ignore' });

async function connect(wsUrl, tag) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const dialogs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(`[${tag}] 예외: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`[${tag}] console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon\.ico/.test(m.params.entry.url || '')) errors.push(`[${tag}] 로그: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.message);
      send('Page.handleJavaScriptDialog', { accept: true });
    }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('DOM.enable');
  const waitFor = async (expr, timeout = 30000, label = expr) => {
    const t0 = Date.now();
    for (;;) {
      let v;
      try {
        v = await ev(expr);
      } catch {
        v = false;
      }
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new Error('시간 초과: ' + label);
      await sleep(150);
    }
  };
  const rectOf = async (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const clickAt = async (x, y) => {
    await mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 });
    await mouse('mousePressed', x, y);
    await mouse('mouseReleased', x, y);
  };
  const click = async (sel) => {
    const r = await rectOf(sel);
    if (!r) throw new Error('요소 없음: ' + sel);
    await clickAt(r.x + r.w / 2, r.y + r.h / 2);
  };
  const key = async (code, k, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk, modifiers });
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const navigate = async (url) => {
    await send('Page.navigate', { url });
    await sleep(800);
  };
  return { ws, send, ev, waitFor, rectOf, click, clickAt, key, shot, navigate, errors, dialogs, close: () => ws.close() };
}

async function pageTargets() {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');
}
let first = null;
for (let i = 0; i < 60 && !first; i++) {
  try {
    first = (await pageTargets())[0];
  } catch {
    /* 재시도 */
  }
  if (!first) await sleep(200);
}
if (!first) throw new Error('크롬 연결 실패');
const page = await connect(first.webSocketDebuggerUrl, '메인');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads.replace(/\//g, '\\') });

// ---------- 화면 상태를 읽는 식 ----------
const E = {
  songId: '(window.__editor().S.song)',
  noteCount: '(() => { const {S}=window.__editor(); return S.chart ? S.chart.difficulties[S.diffIndex].notes.length : -1; })()',
  hasAnalysis: '(!!window.__editor().S.analysis)',
  dirty: '(window.__editor().S.dirty)',
};

try {
  // ===== 1. 첫 방문 화면 =====
  await page.navigate(base);
  await page.waitFor(`document.getElementById('btnDemo') && !document.getElementById('welcome').hidden`, 20000, '첫 방문 안내');
  const welcomeText = await page.ev(`document.getElementById('welcome').innerText`);
  check('첫 방문 안내와 데모 곡 버튼', /어디로도 전송되지 않습니다/.test(welcomeText) && /체험용 데모 곡으로 시작/.test(welcomeText), welcomeText.replace(/\n/g, ' ').slice(0, 80));
  check('종료·분석기 켜기/끄기 UI 없음', await page.ev(`!document.getElementById('btnQuit') && !document.getElementById('btnAnalyzer') && !document.getElementById('analyzerBox')`));
  await page.shot('02_01_welcome');

  // ===== 2. 분석 모드 목록 =====
  const detectors = await page.ev(`[...document.querySelectorAll('#detector option')].map(o => o.value)`);
  const cards = await page.ev(`[...document.querySelectorAll('#presetCards .pcard:not([hidden]) b')].map(b => b.textContent)`);
  check('분석 방식 목록에 종합·베이스·드럼·멜로디·보컬 포함', ['hybrid', 'bass', 'drums', 'melody', 'vocal'].every((d) => detectors.includes(d)), detectors.join(','));
  check('프리셋 카드에 모드 5개(+수동) 표시', cards.length >= 6, cards.join(' | '));

  // ===== 공통 흐름 =====
  async function flow(label, mode, shotPrefix) {
    const tag = `[${label}] `;
    await page.waitFor(`${E.hasAnalysis} === false && ${E.songId}`, 20000, '곡 열림');
    check(tag + '곡이 열렸다', true, await page.ev(E.songId));
    // 분석 모드 고르기(프리셋 카드를 눌러 방식·민감도를 바꾼다)
    await page.ev(`(() => { const d = document.getElementById('detector'); d.value = ${JSON.stringify(mode)}; d.dispatchEvent(new Event('change')); })()`);
    const help = await page.ev(`document.getElementById('detectorHelp').textContent`);
    // 취소 동작 확인(곡 하나에서만)
    if (label === '업로드곡') {
      await page.click('#btnAnalyze');
      await page.waitFor(`!document.getElementById('btnCancel').hidden`, 10000, '취소 버튼 표시');
      await page.ev(`document.getElementById('btnCancel').click()`);
      await sleep(600);
      const st = await page.ev(`document.getElementById('statusLine').textContent`);
      check(tag + '분석 취소 동작', /취소/.test(st) && (await page.ev(E.hasAnalysis)) === false, st);
      await page.waitFor(`!document.getElementById('btnAnalyze').disabled`, 10000, '분석 버튼 복귀');
    }
    // 분석 + 진행률 관찰
    await page.click('#btnAnalyze');
    const labels = new Set();
    const pcts = [];
    const t0 = Date.now();
    while (!(await page.ev(E.hasAnalysis))) {
      const txt = await page.ev(`document.getElementById('analyzeBadgeText').textContent`);
      if (txt) labels.add(txt.replace(/\d+%/, 'N%'));
      const w = await page.ev(`parseFloat(document.getElementById('progressBar').style.width) || 0`);
      if (w) pcts.push(w);
      if (Date.now() - t0 > 90000) throw new Error('분석 시간 초과');
      await sleep(40);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    check(tag + `분석 완료(${mode}, ${secs}초)`, true);
    check(tag + '진행률 표시(막대·단계 문구)', pcts.length >= 1 && labels.size >= 2, `관찰 ${pcts.length}회 막대 ${pcts.length ? Math.min(...pcts) + '→' + Math.max(...pcts) : '-'}%, 문구: ${[...labels].slice(0, 4).join(' / ')}`);
    const an = await page.ev(`(() => { const a = window.__editor().S.analysis; return { detector: a.options.detector, bpms: a.beats.bpm_candidates.map(c => c.bpm), n: a.candidate_count, warnings: a.warnings, wave: !!(a.waveform && a.waveform.max && a.waveform.max.length) }; })()`);
    check(tag + '분석 결과(방식·후보·파형)', an.detector === mode && an.n > 10 && an.wave, `방식 ${an.detector}, 지점 ${an.n}곳, BPM 후보 ${an.bpms.join('/')}`);
    if (mode !== 'hybrid') check(tag + '근사 안내 문구가 화면에 표시', /근사/.test(await page.ev(`document.getElementById('analyzeWarn').innerText`)) && /근사/.test(help), help.slice(0, 40));
    await page.shot(`${shotPrefix}_analyzed`);

    // 노트 자동 생성
    await page.click('#btnGenerate');
    await page.waitFor(`${E.noteCount} > 0`, 30000, '노트 생성');
    const generated = await page.ev(E.noteCount);
    check(tag + '노트 자동 생성', generated > 10, `${generated}개`);
    await page.shot(`${shotPrefix}_generated`);

    // 편집: 단타 도구로 빈 자리에 노트 1개 추가
    await page.click('[data-tool="tap"]');
    const cv = await page.rectOf('#vertical');
    const before = generated;
    let added = false;
    for (let y = cv.y + 90; y < cv.y + cv.h - 90 && !added; y += 11) {
      await page.clickAt(cv.x + 48 + (cv.w - 48) * 0.25, y);
      added = (await page.ev(E.noteCount)) === before + 1;
    }
    check(tag + '노트 1개 추가', added, `${before} → ${await page.ev(E.noteCount)}`);
    const afterAdd = await page.ev(E.noteCount);
    // 복사·붙여넣기·되돌리기(방금 추가한 노트가 선택돼 있다)
    await page.click('[data-tool="select"]');
    await page.key('KeyC', 'c', 67, 2);
    await sleep(150);
    await page.key('KeyV', 'v', 86, 2);
    await sleep(150);
    const pasteMode = await page.ev(`!!window.__editor().S.paste`);
    let pasted = false;
    for (let y = cv.y + 60; y < cv.y + cv.h - 60 && pasteMode && !pasted; y += 17) {
      await page.clickAt(cv.x + 48 + (cv.w - 48) * 0.75, y);
      pasted = (await page.ev(E.noteCount)) === afterAdd + 1;
    }
    check(tag + '복사·붙여넣기', pasteMode && pasted, `붙여넣기 모드 ${pasteMode}, ${afterAdd} → ${await page.ev(E.noteCount)}`);
    await page.key('KeyZ', 'z', 90, 2);
    await sleep(200);
    const afterUndo = await page.ev(E.noteCount);
    check(tag + '되돌리기(Ctrl+Z) 1회', afterUndo === afterAdd, `${afterAdd + 1} → ${afterUndo}`);
    await page.shot(`${shotPrefix}_edited`);

    // 저장
    const savedCount = afterUndo;
    await page.click('#btnSave');
    await page.waitFor(`${E.dirty} === false`, 15000, '저장');
    check(tag + '저장(저장하지 않은 변경 표시 사라짐)', true, await page.ev(`document.getElementById('statusLine').textContent`).then((t) => t.slice(0, 40)));
    return { savedCount, songId: await page.ev(E.songId) };
  }

  // 내보내기 확인
  async function exportCheck(label, savedCount) {
    const tag = `[${label}] `;
    const names = (dir) => readdirSync(dir);
    const before = new Set(names(downloads));
    for (const kind of ['unity', 'edit']) {
      await page.click('#btnExport');
      await page.waitFor(`document.getElementById('dlgExport').open`, 5000, '내보내기 창');
      await page.ev(`document.querySelector('input[name=kind][value=${kind}]').click()`);
      await page.click('#exportOk');
      // 04d: 저장 확인 창이 뜬다. 헤드리스에서는 저장 창(showSaveFilePicker)을 쓸 수 없으니 끄고 <a download> 경로로 저장한다
      await page.waitFor(`document.getElementById('dlgSave').open`, 5000, '저장 확인 창');
      await page.ev(`window.showSaveFilePicker = undefined`);
      await page.click('#saveOk');
      await sleep(800);
    }
    let fresh = [];
    for (let i = 0; i < 40; i++) {
      fresh = names(downloads).filter((n) => !before.has(n) && !n.endsWith('.crdownload'));
      if (fresh.length >= 2) break;
      await sleep(250);
    }
    const unityName = fresh.find((n) => n.endsWith('_unity.json'));
    const editName = fresh.find((n) => n.endsWith('_편집용.json'));
    check(tag + '내보내기 파일 2개 다운로드', !!unityName && !!editName, fresh.join(', '));
    if (unityName) {
      const u = JSON.parse(readFileSync(join(downloads, unityName), 'utf8'));
      const ok = u.format === 'two-key-unity.v2' && u.difficulties[0].notes.length === savedCount && u.difficulties[0].notes.every((n) => Number.isInteger(n.time_ms) && 'duration_ms' in n && 'count' in n);
      check(tag + 'Unity용 JSON 내용(형식·노트 수·ms 정수)', ok, `노트 ${u.difficulties[0].notes.length}개 / 저장 ${savedCount}개`);
    }
    if (editName) {
      const c = JSON.parse(readFileSync(join(downloads, editName), 'utf8'));
      check(tag + '편집용 JSON 내용(v2·노트 수)', c.schema_version === 2 && c.difficulties[0].notes.length === savedCount, `노트 ${c.difficulties[0].notes.length}개`);
    }
  }

  // ===== 3. 데모 곡 =====
  await page.click('#btnDemo');
  const demo = await flow('데모곡', 'hybrid', '02_02_demo');
  // 새로고침 후 복원
  await page.navigate(base);
  await page.waitFor(`document.querySelectorAll('#songList li:not(.help)').length >= 1`, 20000, '곡 목록 복원');
  check('새로고침 뒤 곡 목록 복원', true, await page.ev(`document.querySelector('#songList li .sname').textContent`));
  check('목록이 있으면 첫 방문 안내는 숨김', await page.ev(`document.getElementById('welcome').hidden`));
  await page.click('#songList li');
  await page.waitFor(`${E.songId} && ${E.hasAnalysis} && ${E.noteCount} >= 0`, 20000, '곡 다시 열기');
  const restored = await page.ev(E.noteCount);
  check('[데모곡] 새로고침 후 노트·분석 복원', restored === demo.savedCount && (await page.ev(E.hasAnalysis)), `노트 ${restored}/${demo.savedCount}`);
  await page.shot('02_03_restored');
  await exportCheck('데모곡', restored);

  // ===== 4. 메트로놈·재생 막대 등 원본 로직이 켜지는지(메트로놈 체크 가능) =====
  check('메트로놈 체크가 곡을 열면 켜짐 가능', await page.ev(`!document.getElementById('metro').disabled`));

  // ===== 5. [테스트] 팝업 =====
  await page.click('#btnTest');
  let popup = null;
  for (let i = 0; i < 40 && !popup; i++) {
    popup = (await pageTargets()).find((t) => t.url.includes('#rcw-test'));
    if (!popup) await sleep(250);
  }
  check('[테스트] 팝업이 열림', !!popup);
  if (popup) {
    const pp = await connect(popup.webSocketDebuggerUrl, '팝업');
    await pp.waitFor(`document.getElementById('startBtn') && document.getElementById('startBtn').textContent === '시작' && !document.getElementById('startBtn').disabled`, 30000, '팝업 준비');
    const judgeText = await pp.ev(`document.getElementById('judgeText').textContent`);
    check('[테스트] 팝업이 채보를 불러옴(원본 판정 테스트)', /노트 \d+개/.test(judgeText), judgeText);
    await pp.ev(`document.getElementById('startBtn').click()`);
    try {
      await pp.waitFor(`window.__testHook && (window.__testHook.state().counting || window.__testHook.state().running)`, 15000, '테스트 시작');
      check('[테스트] 시작 동작(카운트인/진행)', true);
    } catch (e) {
      const dbg = await pp.ev(`JSON.stringify({judge: document.getElementById('judgeText').textContent, msg: document.getElementById('settingsMsg').textContent, btn: document.getElementById('startBtn').textContent, st: window.__testHook && window.__testHook.state()})`);
      check('[테스트] 시작 동작(카운트인/진행)', false, dbg);
    }
    await pp.shot('02_04_test_popup');
    await sleep(500);
    check('[테스트] 팝업 콘솔 오류 없음', pp.errors.length === 0, pp.errors.join(' | '));
    page.errors.push(...pp.errors);
    await pp.send('Page.close');
    pp.close();
  }

  // ===== 6. 업로드 곡 =====
  const doc = await page.send('DOM.getDocument');
  const q = await page.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileInput' });
  await page.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [uploadPath.replace(/\//g, '\\')] });
  await page.waitFor(`${E.songId} && ${E.songId} !== ${JSON.stringify(demo.songId)} && ${E.hasAnalysis} === false`, 20000, '업로드 곡 열림');
  await sleep(500);
  check('업로드 곡(WAV) 올리기 → 곡 열림', true, await page.ev(`document.getElementById('songName').textContent`));
  const up = await flow('업로드곡', 'drums', '02_05_upload');
  await page.navigate(base);
  await page.waitFor(`document.querySelectorAll('#songList li:not(.help)').length >= 2`, 20000, '곡 목록 2개');
  await page.ev(`[...document.querySelectorAll('#songList li')].find(li => li.querySelector('.sname').textContent.includes('smoke02')).click()`);
  await page.waitFor(`${E.songId} === ${JSON.stringify(up.songId)} && ${E.hasAnalysis}`, 20000, '업로드 곡 다시 열기');
  const restoredUp = await page.ev(E.noteCount);
  check('[업로드곡] 새로고침 후 노트·분석 복원', restoredUp === up.savedCount, `노트 ${restoredUp}/${up.savedCount}`);
  await exportCheck('업로드곡', restoredUp);

  // ===== 7. 같은 파일 다시 올리기 =====
  page.dialogs.length = 0;
  const doc2 = await page.send('DOM.getDocument');
  const q2 = await page.send('DOM.querySelector', { nodeId: doc2.result.root.nodeId, selector: '#fileInput' });
  await page.send('DOM.setFileInputFiles', { nodeId: q2.result.nodeId, files: [uploadPath.replace(/\//g, '\\')] });
  await sleep(2500);
  const songCount = await page.ev(`document.querySelectorAll('#songList li:not(.help)').length`);
  check('같은 파일을 다시 올리면 "이미 있는 곡입니다. 열까요?"', page.dialogs.some((d) => d.includes('이미 있는 곡입니다')) && songCount === 2, `${page.dialogs.join(' / ')} (목록 ${songCount}개)`);

  // ===== 8. 곡 지우기·되돌리기(휴지통) =====
  await page.ev(`[...document.querySelectorAll('#songList li')].find(li => li.querySelector('.sname').textContent.includes('데모')).querySelector('.songdel').click()`);
  await page.waitFor(`document.getElementById('deleteSongDialog').open`, 5000, '지우기 확인 창');
  await page.click('#deleteSongOk');
  await sleep(800);
  check('곡 지우기(휴지통으로)', (await page.ev(`document.querySelectorAll('#songList li:not(.help)').length`)) === 1);
  await page.click('#btnUndoDelete');
  await sleep(800);
  check('지운 곡 되돌리기', (await page.ev(`document.querySelectorAll('#songList li:not(.help)').length`)) === 2);

  await page.shot('02_06_final');
} catch (e) {
  check('스모크 테스트 진행 중 예외', false, e.message);
  try {
    await page.shot('02_99_failure');
  } catch {
    /* 무시 */
  }
}

// ---------- 콘솔 오류 ----------
check('콘솔 오류 0건', page.errors.length === 0, page.errors.slice(0, 5).join(' | '));
writeFileSync(join(root, 'log', 'smoke02_result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8');
page.close();
chrome.kill();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n합계 ${results.length}개 중 실패 ${failed}개`);
process.exit(failed ? 1 : 0);
