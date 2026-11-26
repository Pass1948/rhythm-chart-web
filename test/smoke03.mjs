// 03단계 브라우저 스모크 테스트(헤드리스 Chrome, 개발자 도구 프로토콜(CDP)). 방식은 smoke02.mjs 와 같다(새 패키지 없음).
// 흐름: dist 를 작은 정적 서버로 열기 → 데모 곡 분석·생성 → [게임 화면 테스트] → 시작 준비 화면 → 자동 입력(키보드)으로 끝까지
//       → 결과 화면 → MISS 클릭 → 편집기 복귀(노트 선택) / 0.5배·중간부터 / 일시정지에서 입력 지연 저장 / 폰 크기·터치(포인터) 입력
//       → 10회 반복 시작·종료에서 요소 수·WebGL 컨텍스트·메모리 확인 → 콘솔 오류 0건.
// 사용: npm run build 뒤에  node test/smoke03.mjs   (결과는 log\smoke03_result.json, 화면은 log\screens\03_*.png)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shots = join(root, 'log', 'screens');
const tmp = join(root, '_to_delete', '점검_임시');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const d of [shots, tmp]) mkdirSync(d, { recursive: true });

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

// ---------- Chrome 연결 ----------
const port = 9403;
const profile = join(tmp, `chrome_profile_03_${Date.now()}`);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
], { stdio: 'ignore' });

async function connect(wsUrl, tag) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(`[${tag}] 예외: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`[${tag}] console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`[${tag}] 로그: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
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
  await send('HeapProfiler.enable');
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
      await sleep(100);
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
  /** 플레이 화면 안의 버튼을 글자로 찾아 누른다 */
  const clickText = async (text, root = '.rcw-play') => {
    const r = await ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(root + ' button')})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    if (!r) throw new Error('버튼 없음: ' + text);
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
  const heapMb = async () => {
    await send('HeapProfiler.collectGarbage');
    const r = await send('Runtime.getHeapUsage');
    return r.result.usedSize / (1024 * 1024);
  };
  return { ws, send, ev, waitFor, rectOf, click, clickText, clickAt, key, shot, navigate, heapMb, errors, close: () => ws.close() };
}

let first = null;
for (let i = 0; i < 60 && !first; i++) {
  try {
    first = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page')[0];
  } catch {
    /* 재시도 */
  }
  if (!first) await sleep(200);
}
if (!first) throw new Error('크롬 연결 실패');
const page = await connect(first.webSocketDebuggerUrl, '메인');
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

// WebGL 컨텍스트가 만들어지고 사라진 횟수를 센다(페이지가 열릴 때마다 먼저 실행된다)
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__gl = { created: 0, lost: 0 };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const ctx = orig.call(this, type, ...rest);
      if (ctx && /webgl/.test(String(type)) && !this.__counted) { this.__counted = true; window.__gl.created++; this.addEventListener('webglcontextlost', () => { window.__gl.lost++; }); }
      return ctx;
    };
  })();`,
});

// ---------- 자동 플레이어(페이지 안): 노트 시각에 맞춰 키보드 또는 터치(포인터) 입력을 만든다 ----------
const AUTO = `
window.__auto = function (mode, skipEvery) {
  const p = window.__rcwPlay;
  const notes = p.notes();
  const ev = [];
  notes.forEach((n, i) => {
    if (skipEvery > 0 && n.type === 'tap' && i % skipEvery === skipEvery - 1) return;
    if (n.type === 'tap') { ev.push({ t: n.timeMs, k: 'd', lane: n.lane }, { t: n.timeMs + 40, k: 'u', lane: n.lane }); }
    else if (n.type === 'hold') { ev.push({ t: n.timeMs, k: 'd', lane: n.lane }, { t: n.timeMs + n.durationMs, k: 'u', lane: n.lane }); }
    else {
      const total = n.count + 2; const step = n.durationMs / total;
      for (let j = 0; j < total; j++) { const lane = j % 2; const t = n.timeMs + step * (j + 0.3); ev.push({ t, k: 'd', lane }, { t: t + step * 0.4, k: 'u', lane }); }
    }
  });
  ev.sort((a, b) => a.t - b.t || (a.k === b.k ? 0 : a.k === 'u' ? -1 : 1));
  const state = { fired: 0, total: ev.length, idx: 0, stop: false };
  window.__autoState = state;
  const keys = ['KeyS', 'KeyF'];
  const fire = (e) => {
    if (mode === 'key') {
      window.dispatchEvent(new KeyboardEvent(e.k === 'd' ? 'keydown' : 'keyup', { code: keys[e.lane], key: keys[e.lane].slice(3).toLowerCase(), bubbles: true, cancelable: true }));
    } else {
      const layer = document.querySelector('.pl-input'); const r = layer.getBoundingClientRect();
      const x = r.left + r.width * (e.lane === 0 ? 0.25 : 0.75); const y = r.top + r.height * 0.8;
      layer.dispatchEvent(new PointerEvent(e.k === 'd' ? 'pointerdown' : 'pointerup', { pointerId: e.lane + 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: e.lane === 0 }));
    }
    state.fired++;
  };
  const timer = setInterval(() => {
    const q = window.__rcwPlay;
    if (!q || state.stop) { clearInterval(timer); return; }
    if (q.phase() !== 'playing') return;
    const now = q.heardSongMs();
    while (state.idx < ev.length && ev[state.idx].t <= now) { fire(ev[state.idx]); state.idx++; }
  }, 1);
  state.timer = timer;
  return ev.length;
};
window.__autoStop = () => { if (window.__autoState) window.__autoState.stop = true; };
`;

// ---------- 화면 상태를 읽는 식 ----------
const E = {
  noteCount: '(() => { const {S}=window.__editor(); return S.chart ? S.chart.difficulties[S.diffIndex].notes.length : -1; })()',
  hasAnalysis: '(!!window.__editor().S.analysis)',
  root: `document.querySelectorAll('.rcw-play').length`,
  phase: `(window.__rcwPlay ? window.__rcwPlay.phase() : 'none')`,
  settings: `JSON.parse(localStorage.getItem('rcw.settings.v1') || '{}')`,
};
const resultCounts = () => page.ev(`(() => { const o = {}; document.querySelectorAll('.rcw-play .pl-count').forEach((c) => { o[c.children[0].textContent] = Number(c.children[1].textContent); }); return o; })()`);

/** 게임 화면 테스트 버튼을 눌러 시작 준비 화면까지 연다 */
async function openPlay(viaScript = false) {
  // 폰 크기에서는 편집기 화면(반응형은 04단계)이 버튼을 가릴 수 있어 스크립트로 누른다
  if (viaScript) await page.ev(`document.getElementById('btnPlayTest').click()`);
  else await page.click('#btnPlayTest');
  await page.waitFor(`${E.root} === 1 && !!document.querySelector('.rcw-play .pl-start')`, 20000, '시작 준비 화면');
}
/** 시작 준비 화면에서 고르고 [시작] */
async function startPlay({ rate, editorStart } = {}) {
  if (rate !== undefined) await page.ev(`document.querySelector('.rcw-play [data-rate="${rate}"]').click()`);
  if (editorStart) await page.ev(`document.querySelector('.rcw-play [data-start="editor"]').click()`);
  await page.clickText('시작');
  await page.waitFor(`${E.phase} === 'countdown' || ${E.phase} === 'playing'`, 20000, '카운트다운');
}
/** 플레이가 끝나(결과 화면) 때까지 기다린다 */
async function waitResult(timeout = 120000) {
  await page.waitFor(`!!document.querySelector('.rcw-play .pl-result')`, timeout, '결과 화면');
}

try {
  // ===== 준비: 데모 곡 분석·생성 =====
  await page.navigate(base);
  await page.waitFor(`document.getElementById('btnDemo') && !document.getElementById('welcome').hidden`, 20000, '첫 방문 안내');
  await page.click('#btnDemo');
  await page.waitFor(`window.__editor && window.__editor().S.song && ${E.hasAnalysis} === false`, 20000, '곡 열림');
  await page.click('#btnAnalyze');
  await page.waitFor(E.hasAnalysis, 90000, '분석');
  await page.click('#btnGenerate');
  await page.waitFor(`${E.noteCount} > 10`, 30000, '노트 생성');
  const generated = await page.ev(E.noteCount);
  check('준비: 데모 곡 분석 → 채보 생성', generated > 10, `노트 ${generated}개`);
  await page.ev(AUTO);

  // 편집기 쪽 설정값(입력 지연 +20, 낙하 시간 1700)을 미리 저장해 두면 플레이 화면이 같은 값을 쓰는지 확인할 수 있다
  await page.ev(`(() => { const s = ${E.settings}; s.inputDelayMs = 20; s.fallTimeMs = 1700; localStorage.setItem('rcw.settings.v1', JSON.stringify(s)); })()`);

  // ===== 1. 데스크톱: 시작 준비 화면 → 처음부터 → 키보드 자동 입력 → 결과 =====
  await openPlay();
  check('[게임 화면 테스트] 버튼 → 시작 준비 화면(속도·시작 위치·연습 모드)', await page.ev(`document.querySelectorAll('.rcw-play [data-rate]').length === 4 && !!document.querySelector('.rcw-play [data-start="start"]') && /연습 모드/.test(document.querySelector('.rcw-play').innerText)`));
  await page.shot('03_01_desktop_ready');
  await startPlay();
  const cfg0 = await page.ev(`window.__rcwPlay.settings()`);
  check('플레이 화면이 편집기 설정과 같은 값을 읽음(입력 지연 20·낙하 1700)', cfg0.inputDelayMs === 20 && cfg0.fallTimeMs === 1700 && cfg0.practice === true, JSON.stringify(cfg0));
  await page.waitFor(`${E.phase} === 'countdown'`, 5000);
  await page.shot('03_02_desktop_countdown');
  const noteTotal = await page.ev(`window.__rcwPlay.noteCount()`);
  check('처음부터 시작: 편집기와 같은 노트 수', noteTotal === generated && (await page.ev(`window.__rcwPlay.startMs()`)) === 0, `${noteTotal}/${generated}`);
  await page.ev(`window.__auto('key', 0)`);
  await page.waitFor(`${E.phase} === 'playing'`, 15000, '재생 시작');
  await sleep(6000);
  await page.shot('03_03_desktop_playing');
  const rateNow = await page.ev(`window.__rcwPlay.rate()`);
  check('재생 중 상태(배율 1)', rateNow === 1);
  await waitResult();
  await page.ev(`window.__autoStop()`);
  const counts1 = await resultCounts();
  const sum1 = await page.ev(`window.__rcwPlay.summary()`);
  const hit1 = (counts1.PERFECT || 0) + (counts1.GREAT || 0);
  check('자동 키보드 입력으로 끝까지 → 결과 화면(점수·판정별)', sum1 && sum1.totalNotes === noteTotal && hit1 >= Math.floor(noteTotal * 0.9), `점수 ${sum1?.score}, ${JSON.stringify(counts1)}, 최대 콤보 ${sum1?.maxCombo}, 평균 오차 ${sum1?.meanErrorMs?.toFixed(1)}ms`);
  check('결과 화면에 평균 오차·MISS 목록 표시', await page.ev(`/평균 오차/.test(document.querySelector('.rcw-play .pl-result').innerText) && !!document.querySelector('.rcw-play .pl-missbox')`));
  await page.shot('03_04_desktop_result');
  // 다시하기가 처음부터 다시 시작
  await page.clickText('다시하기');
  await page.waitFor(`${E.phase} === 'countdown'`, 5000, '다시하기');
  check('결과 화면 [다시하기]가 같은 설정으로 다시 시작', (await page.ev(`window.__rcwPlay.startMs()`)) === 0 && (await page.ev(`window.__rcwPlay.summary()`)) === null);
  // Esc → 일시정지 → 입력 지연·낙하 시간 바꾸기 → 저장 확인
  await page.key('Escape', 'Escape', 27);
  await page.waitFor(`${E.phase} === 'paused'`, 5000, '일시정지');
  await page.shot('03_05_desktop_pause');
  await page.ev(`(() => { const b = [...document.querySelectorAll('.rcw-play button')]; b.find((x) => x.getAttribute('aria-label') === '입력 지연 보정 늘리기').click(); b.find((x) => x.getAttribute('aria-label') === '입력 지연 보정 늘리기').click(); b.find((x) => x.getAttribute('aria-label') === '낙하 시간 줄이기').click(); })()`);
  const saved = await page.ev(E.settings);
  check('일시정지에서 바꾼 입력 지연·낙하 시간이 settingsStore 에 저장(20→30, 1700→1600)', saved.inputDelayMs === 30 && saved.fallTimeMs === 1600, JSON.stringify({ d: saved.inputDelayMs, f: saved.fallTimeMs }));
  await page.key('Escape', 'Escape', 27);
  await page.waitFor(`${E.phase} === 'resuming' || ${E.phase} === 'countdown'`, 5000, '이어하기');
  check('Esc 를 다시 누르면 이어하기(카운트)', true);
  await page.key('Escape', 'Escape', 27);
  await page.waitFor(`${E.phase} === 'paused'`, 5000);
  await page.clickText('나가기');
  await page.waitFor(`${E.root} === 0`, 5000, '나가기');
  check('[나가기]로 편집기 복귀(플레이 요소 제거)', (await page.ev(`!window.__rcwPlay`)) && (await page.ev(`!!document.getElementById('btnPlayTest')`)));

  // ===== 2. MISS 목록 → 편집기 이동(일부러 일부 노트를 치지 않음) =====
  await page.ev(`(() => { const s = ${E.settings}; s.inputDelayMs = 0; s.fallTimeMs = 1800; localStorage.setItem('rcw.settings.v1', JSON.stringify(s)); })()`);
  await openPlay();
  await startPlay();
  await page.ev(`window.__auto('key', 4)`);
  await waitResult();
  await page.ev(`window.__autoStop()`);
  const counts2 = await resultCounts();
  const sum2 = await page.ev(`window.__rcwPlay.summary()`);
  const missRows = await page.ev(`document.querySelectorAll('.rcw-play .pl-miss').length`);
  check('치지 않은 노트가 MISS 로 센다 + MISS 목록에 표시', (counts2.MISS || 0) >= 5 && missRows === sum2.missList.length, `MISS ${counts2.MISS}개, 목록 ${missRows}줄`);
  const firstMiss = sum2.missList[0];
  await page.shot('03_06_desktop_result_miss');
  await page.ev(`document.querySelector('.rcw-play .pl-miss').click()`);
  await page.waitFor(`${E.root} === 0`, 5000, '결과 닫힘');
  await sleep(300);
  const selected = await page.ev(`window.__editor().S.selectedId`);
  check('MISS 목록 항목을 누르면 편집기로 돌아가 그 노트가 선택됨', selected === firstMiss.noteId && selected > 0, `선택된 노트 번호 ${selected}, 첫 MISS 번호 ${firstMiss.noteId} (${firstMiss.timeMs}ms)`);
  const idOk = await page.ev(`(() => { const {S} = window.__editor(); const d = S.chart.difficulties[S.diffIndex]; const n = d.notes.find((x) => x.id === S.selectedId); return !!n; })()`);
  check('선택된 번호가 편집기 채보의 실제 노트', idOk);

  // ===== 3. 중간부터 + 0.5배 =====
  await page.ev(`window.__editor().A.audio.pausedPos = 15000`);
  await openPlay();
  const hasEditorStart = await page.ev(`!!document.querySelector('.rcw-play [data-start="editor"]')`);
  check('시작 준비 화면에 "편집기 위치부터" 선택지', hasEditorStart);
  await startPlay({ rate: 0.5, editorStart: true });
  const st = await page.ev(`({ rate: window.__rcwPlay.rate(), start: window.__rcwPlay.startMs(), n: window.__rcwPlay.noteCount(), notes: window.__rcwPlay.notes() })`);
  check('중간부터(15초)·0.5배로 시작: 앞 노트는 빠지고 속도 반영', st.rate === 0.5 && st.start === 15000 && st.n < generated && st.n > 0 && st.notes[0].timeMs >= 15000, `속도 ${st.rate}, 시작 ${st.start}ms, 노트 ${st.n}/${generated}`);
  await page.waitFor(`${E.phase} === 'playing'`, 15000, '재생 시작');
  const m0 = await page.ev(`window.__rcwPlay.songMs()`);
  const t0 = Date.now();
  await sleep(2000);
  const m1 = await page.ev(`window.__rcwPlay.songMs()`);
  const elapsed = Date.now() - t0;
  const ratio = (m1 - m0) / elapsed;
  check('0.5배: 실제 시간의 약 절반만 곡이 흐름', ratio > 0.42 && ratio < 0.58, `곡 ${(m1 - m0).toFixed(0)}ms / 실제 ${elapsed}ms = ${ratio.toFixed(2)}`);
  await page.ev(`window.__auto('key', 0)`);
  await waitResult(180000);
  await page.ev(`window.__autoStop()`);
  const sum3 = await page.ev(`window.__rcwPlay.summary()`);
  const hit3 = (sum3.counts.perfect || 0) + (sum3.counts.great || 0);
  check('중간부터 0.5배로 끝까지 → 결과(대부분 성공)', sum3.totalNotes === st.n && hit3 >= Math.floor(st.n * 0.85), `${JSON.stringify(sum3.counts)}`);
  await page.clickText('편집기로');
  await page.waitFor(`${E.root} === 0`, 5000);

  // ===== 4. 폰 크기(390×844)·터치(포인터) 입력 =====
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(500);
  await page.ev(`window.__editor().A.audio.pausedPos = 20000`);
  await openPlay(true);
  await page.shot('03_07_phone_ready');
  await startPlay({ editorStart: true });
  await page.ev(`window.__auto('pointer', 0)`);
  await page.waitFor(`${E.phase} === 'playing'`, 15000, '재생 시작');
  await sleep(4000);
  await page.shot('03_08_phone_playing');
  await waitResult(120000);
  await page.ev(`window.__autoStop()`);
  const sum4 = await page.ev(`window.__rcwPlay.summary()`);
  const hit4 = (sum4.counts.perfect || 0) + (sum4.counts.great || 0);
  check('터치(손가락별 레인 고정·두 손가락 동시) 입력으로 끝까지 칠 수 있음', hit4 >= Math.floor(sum4.totalNotes * 0.85), `${JSON.stringify(sum4.counts)}`);
  const fits = await page.ev(`(() => { const r = document.querySelector('.rcw-stage').getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })()`);
  check('폰 화면에 스테이지가 비율대로 들어감', fits.w <= fits.vw + 1 && fits.h <= fits.vh + 1 && fits.w > fits.vw * 0.95, JSON.stringify(fits));
  await page.shot('03_09_phone_result');
  await page.clickText('편집기로');
  await page.waitFor(`${E.root} === 0`, 5000);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(500);

  // ===== 5. 10회 반복 시작·종료: 요소 수·WebGL 컨텍스트·메모리 =====
  await page.waitFor(`document.getElementById('btnPlayTest')`, 5000);
  const rounds = [];
  const base0 = await page.ev(`document.querySelectorAll('*').length`);
  const heap0 = await page.heapMb();
  for (let i = 0; i < 10; i++) {
    await openPlay();
    await startPlay();
    await page.waitFor(`${E.phase} === 'playing'`, 15000, '재생');
    await sleep(500);
    await page.key('Escape', 'Escape', 27);
    await page.waitFor(`${E.phase} === 'paused'`, 5000);
    await page.clickText('나가기');
    await page.waitFor(`${E.root} === 0`, 5000);
    await sleep(150);
    const snap = await page.ev(`({ els: document.querySelectorAll('*').length, canvases: document.querySelectorAll('canvas').length, gl: window.__gl, stats: window.__rcwPlayStats })`);
    snap.heap = await page.heapMb();
    rounds.push(snap);
  }
  const last = rounds[rounds.length - 1];
  check('10회 시작·종료: 화면 요소 수가 늘지 않음', last.els === base0 && rounds.every((r) => r.els === base0), `시작 전 ${base0}개 → 매회 ${[...new Set(rounds.map((r) => r.els))].join('/')}개`);
  check('10회 시작·종료: 캔버스가 남지 않음', rounds.every((r) => r.canvases === rounds[0].canvases), `캔버스 ${rounds[0].canvases}개 유지`);
  check('10회 시작·종료: WebGL 컨텍스트를 만든 만큼 모두 해제', last.gl.created === 10 + 4 && last.gl.created === last.gl.lost, `만든 ${last.gl.created}, 해제 ${last.gl.lost} (앞선 4번 + 반복 10번)`);
  check('10회 시작·종료: 시작·정리 횟수가 같음', last.stats.started === last.stats.destroyed, JSON.stringify(last.stats));
  const heapGrowth = last.heap - heap0;
  check('10회 시작·종료: 메모리(JS 힙)가 계속 늘지 않음', heapGrowth < 8, `시작 전 ${heap0.toFixed(1)}MB → ${rounds.map((r) => r.heap.toFixed(1)).join(', ')}MB`);

  // ===== 6. 금지 항목: 서버 호출·이미지 요청 없음 =====
  const reqs = await page.ev(`performance.getEntriesByType('resource').map((r) => r.name)`);
  const bad = reqs.filter((u) => /\.(png|jpg|jpeg|gif|webp|mp3|wav|ogg|m4a)(\?|$)/i.test(u) || /\/api\//.test(u));
  check('이미지·음원·서버(api) 요청이 없음', bad.length === 0, bad.join(', ') || `리소스 ${reqs.length}개`);
} catch (e) {
  check('스모크 테스트 진행 중 예외', false, e.message);
  try {
    await page.shot('03_99_failure');
  } catch {
    /* 무시 */
  }
}

// ---------- 콘솔 오류 ----------
check('콘솔 오류 0건', page.errors.length === 0, page.errors.slice(0, 5).join(' | '));
writeFileSync(join(root, 'log', 'smoke03_result.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8');
page.close();
chrome.kill();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n합계 ${results.length}개 중 실패 ${failed}개`);
process.exit(failed ? 1 : 0);
