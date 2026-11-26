// 05단계 게시 호환 스모크 테스트 (헤드리스 Chrome + 개발자 도구 프로토콜, 새 패키지 없음).
// 사용: npm run build 뒤에  node test/smoke05.mjs   (결과: log\smoke05_result.json, 화면: log\screens\05_*.png)
// 세 가지 상황을 각각 새 크롬으로 시험한다. dist 는 tools\staticServe.mjs 로 "/임의/하위/경로/" 아래에서 서빙한다.
//  A. 보통: 데모 곡 → 분석 → 생성 → 게임 테스트(자동 키 입력) → 결과. 모든 파일이 하위 경로 아래 상대 경로로 로드되는지.
//  B. 저장소 차단(indexedDB 제거 + localStorage 접근 오류): 메모리 모드 안내가 뜨고 분석·생성이 계속 동작.
//  C. Web Worker 생성 실패(Worker 제거 / 생성 시 오류): 화면 스레드에서 조각 나눠 분석, "속도가 느릴 수 있습니다" 안내, 화면이 멈추지 않음.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'log', 'screens');
const tmp = join(root, '_to_delete', '점검_임시');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const d of [shots, tmp]) mkdirSync(d, { recursive: true });

const results = [];
const info = {};
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---------- 정적 서버: tools\staticServe.mjs 를 하위 경로로 띄운다 ----------
const PREFIX = '/임의/하위/경로/';
const serve = spawn('node', [join(root, 'tools', 'staticServe.mjs'), '--port', '4310', '--prefix', PREFIX], { stdio: ['ignore', 'pipe', 'inherit'] });
const base = await new Promise((ok, fail) => {
  serve.stdout.on('data', (d) => {
    const m = /URL: (\S+)/.exec(String(d));
    if (m) ok(encodeURI(m[1]));
  });
  setTimeout(() => fail(new Error('서버 시작 시간 초과')), 8000);
});
console.log('서빙 주소: ' + base);

/** 새 크롬을 띄우고 연결한다 */
async function launch(port, tag) {
  const profile = join(tmp, `chrome_profile_05_${tag}_${Date.now()}`);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,720', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
  ], { stdio: 'ignore' });
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
  const ws = new WebSocket(first.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const warnings = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(`[${tag}] 예외: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`[${tag}] console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') warnings.push(`[${tag}] console.warn: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`[${tag}] 로그: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'warning') warnings.push(`[${tag}] 로그경고: ${m.params.entry.text} ${m.params.entry.url || ''}`);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
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
  const clickText = async (text, rootSel = '.rcw-play') => {
    const r = await ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(rootSel + ' button')})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    if (!r) throw new Error('버튼 없음: ' + text);
    await clickAt(r.x + r.w / 2, r.y + r.h / 2);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const close = () => {
    try { ws.close(); } catch { /* 무시 */ }
    chrome.kill();
  };
  return { send, ev, waitFor, click, clickText, shot, errors, warnings, close };
}

const E = {
  noteCount: '(() => { const {S}=window.__editor(); return S.chart ? S.chart.difficulties[S.diffIndex].notes.length : -1; })()',
  hasAnalysis: '(!!window.__editor().S.analysis)',
  phase: `(window.__rcwPlay ? window.__rcwPlay.phase() : 'none')`,
};
const AUTO = `
window.__auto = function () {
  const p = window.__rcwPlay; const notes = p.notes(); const ev = [];
  notes.forEach((n) => {
    if (n.type === 'tap') { ev.push({ t: n.timeMs, k: 'd', lane: n.lane }, { t: n.timeMs + 40, k: 'u', lane: n.lane }); }
    else if (n.type === 'hold') { ev.push({ t: n.timeMs, k: 'd', lane: n.lane }, { t: n.timeMs + n.durationMs, k: 'u', lane: n.lane }); }
    else { const total = n.count + 2; const step = n.durationMs / total; for (let j = 0; j < total; j++) { const lane = j % 2; const t = n.timeMs + step * (j + 0.3); ev.push({ t, k: 'd', lane }, { t: t + step * 0.4, k: 'u', lane }); } }
  });
  ev.sort((a, b) => a.t - b.t || (a.k === b.k ? 0 : a.k === 'u' ? -1 : 1));
  const state = { idx: 0, stop: false }; window.__autoState = state; const keys = ['KeyS', 'KeyF'];
  const timer = setInterval(() => {
    const q = window.__rcwPlay; if (!q || state.stop) { clearInterval(timer); return; }
    if (q.phase() !== 'playing') return; const now = q.heardSongMs();
    while (state.idx < ev.length && ev[state.idx].t <= now) { const e = ev[state.idx]; window.dispatchEvent(new KeyboardEvent(e.k === 'd' ? 'keydown' : 'keyup', { code: keys[e.lane], key: keys[e.lane].slice(3).toLowerCase(), bubbles: true, cancelable: true })); state.idx++; }
  }, 1);
  return ev.length;
};
window.__autoStop = () => { if (window.__autoState) window.__autoState.stop = true; };
`;
/** 화면이 멈추는 정도를 재는 도구: 50ms 간격 타이머가 가장 늦어진 시간 */
const GAP = `(() => { window.__gap = { max: 0 }; let last = performance.now(); setInterval(() => { const n = performance.now(); window.__gap.max = Math.max(window.__gap.max, n - last - 50); last = n; }, 50); })();`;

/** 데모 곡 열기 → 분석 → 채보 생성. 분석에 걸린 시간(ms)을 돌려준다 */
async function demoToChart(page) {
  await page.waitFor(`document.getElementById('btnDemo')`, 20000, '데모 곡 버튼');
  await page.click('#btnDemo');
  await page.waitFor(`window.__editor && window.__editor().S.song && ${E.hasAnalysis} === false`, 20000, '곡 열림');
  await page.ev(`window.__gap && (window.__gap.max = 0)`);
  const t0 = Date.now();
  await page.click('#btnAnalyze');
  await page.waitFor(E.hasAnalysis, 180000, '분석');
  const analysisMs = Date.now() - t0;
  await page.click('#btnGenerate');
  await page.waitFor(`${E.noteCount} > 10`, 60000, '노트 생성');
  return analysisMs;
}

try {
  // ===== A. 보통 =====
  {
    const page = await launch(9421, 'A');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTO + GAP });
    const t0 = Date.now();
    await page.send('Page.navigate', { url: base });
    await page.waitFor(`document.getElementById('btnDemo') && !!window.__editor`, 30000, '첫 화면');
    const loadMs = Date.now() - t0;
    info.firstScreenMs = loadMs;
    check('A1 하위 경로에서 첫 화면 열림', true, `첫 화면까지 약 ${loadMs}ms (헤드리스·로컬)`);
    await page.shot('05_A1_first');
    const analysisMs = await demoToChart(page);
    info.analysisMsDemo = analysisMs;
    const warns = await page.ev(`window.__editor().S.analysis.warnings || []`);
    check('A2 데모 곡 분석(워커) → 채보 생성', true, `분석 ${analysisMs}ms, 노트 ${await page.ev(E.noteCount)}개`);
    check('A3 워커로 분석됨(느림 안내 없음)', !warns.some((w) => /느릴 수 있습니다/.test(w)), JSON.stringify(warns));
    const res = await page.ev(`(() => performance.getEntriesByType('resource').map((r) => ({ url: r.name, status: r.responseStatus })))()`);
    // 이 PC 의 광고 차단 프로그램(adguard)이 끼워 넣는 요청은 앱과 무관하므로 제외한다
    const bad = res.filter((r) => !r.url.startsWith(base) && !r.url.startsWith('data:') && !r.url.startsWith('blob:') && !/adguard/.test(r.url));
    const failed = res.filter((r) => r.status >= 400);
    info.resourceCount = res.length;
    check('A4 읽은 파일이 모두 하위 경로 아래(상대 경로)', res.length >= 5 && bad.length === 0 && failed.length === 0, `${res.length}개, 경로 밖 ${bad.length} ${bad.map((b) => b.url).join(',')}, 실패 ${failed.length}`);
    const workerLoaded = await page.ev(`performance.getEntriesByType('resource').some((r) => /worker-.*\\.js/.test(r.name))`);
    check('A5 Worker 파일이 하위 경로에서 로드됨', workerLoaded);
    // 게임 테스트
    await page.click('#btnPlayTest');
    await page.waitFor(`!!document.querySelector('.rcw-play .pl-start')`, 20000, '시작 준비 화면');
    await page.clickText('시작');
    await page.waitFor(`${E.phase} === 'countdown' || ${E.phase} === 'playing'`, 20000, '카운트다운');
    await page.ev(`window.__auto()`);
    await page.waitFor(`${E.phase} === 'playing'`, 15000, '재생 시작');
    const ctxState = await page.ev(`${E.phase}`);
    check('A6 사용자 클릭 뒤에 재생 시작', ctxState === 'playing', ctxState);
    await page.waitFor(`!!document.querySelector('.rcw-play .pl-result')`, 180000, '결과 화면');
    await page.ev(`window.__autoStop()`);
    const sum = await page.ev(`window.__rcwPlay.summary()`);
    await page.shot('05_A2_result');
    check('A7 게임 테스트 끝까지 → 결과 화면', sum && sum.totalNotes > 10 && sum.score > 0, `점수 ${sum?.score}, 최대 콤보 ${sum?.maxCombo}`);
    await page.clickText('편집기로');
    await page.waitFor(`document.querySelectorAll('.rcw-play').length === 0`, 5000, '나가기');
    check('A8 콘솔 오류 0건', page.errors.length === 0, page.errors.join(' | '));
    // 'Permissions-Policy header' 경고는 이 PC 의 광고 차단 프로그램이 응답에 붙이는 헤더 때문이라 앱과 무관하다
    const ownWarnings = page.warnings.filter((w) => !/Permissions-Policy/.test(w));
    check('A9 콘솔 경고 0건(환경 요인 제외)', ownWarnings.length === 0, ownWarnings.join(' | '));
    info.consoleWarningsA = page.warnings;
    page.close();
    await sleep(500);
  }

  // ===== B. 저장소 차단 =====
  {
    const page = await launch(9422, 'B');
    const BLOCK = `(() => {
      try { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); } catch (e) {}
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('차단됨', 'SecurityError'); } });
    })();`;
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: BLOCK + GAP });
    await page.send('Page.navigate', { url: base });
    await page.waitFor(`document.getElementById('btnDemo') && !!window.__editor`, 30000, '첫 화면');
    const blocked = await page.ev(`(() => { let ls = 'ok'; try { void window.localStorage; } catch (e) { ls = 'blocked'; } return { idb: typeof indexedDB, ls }; })()`);
    check('B1 저장소가 막힌 상태로 모의됨', blocked.idb === 'undefined' && blocked.ls === 'blocked', JSON.stringify(blocked));
    const analysisMs = await demoToChart(page);
    await page.waitFor(`!document.getElementById('storageNote').hidden`, 10000, '저장소 안내');
    const note = await page.ev(`document.getElementById('storageNote').textContent`);
    check('B2 메모리 모드 안내가 뜸', /저장되지 않습니다/.test(note), note.slice(0, 60));
    check('B3 막힌 상태에서도 분석·생성이 계속 동작', true, `분석 ${analysisMs}ms, 노트 ${await page.ev(E.noteCount)}개`);
    await page.shot('05_B1_storage_blocked');
    check('B4 콘솔 오류 0건', page.errors.length === 0, page.errors.join(' | '));
    info.consoleWarningsB = page.warnings;
    page.close();
    await sleep(500);
  }

  // ===== C. Worker 생성 실패 (두 가지: Worker 없음 / 생성 시 오류) =====
  for (const [tag, port, mode] of [['C1', 9423, 'none'], ['C2', 9424, 'throw']]) {
    const page = await launch(port, tag);
    const KILL = mode === 'none' ? `delete window.Worker; window.Worker = undefined;` : `window.Worker = function () { throw new Error('Worker 생성 막힘'); };`;
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: KILL + GAP });
    await page.send('Page.navigate', { url: base });
    await page.waitFor(`document.getElementById('btnDemo') && !!window.__editor`, 30000, '첫 화면');
    check(`${tag}-1 Worker 가 막힌 상태로 모의됨`, await page.ev(mode === 'none' ? `typeof Worker === 'undefined'` : `(() => { try { new Worker('x'); return false; } catch (e) { return true; } })()`));
    const analysisMs = await demoToChart(page);
    const warns = await page.ev(`window.__editor().S.analysis.warnings || []`);
    const gap = await page.ev(`window.__gap.max`);
    check(`${tag}-2 화면 스레드 분석으로 끝까지 동작`, true, `분석 ${analysisMs}ms, 노트 ${await page.ev(E.noteCount)}개`);
    check(`${tag}-3 "속도가 느릴 수 있습니다" 안내`, warns.some((w) => /느릴 수 있습니다/.test(w)), JSON.stringify(warns).slice(0, 160));
    check(`${tag}-4 분석 중 화면이 오래 멈추지 않음(가장 긴 멈춤 < 1000ms)`, gap < 1000, `가장 긴 멈춤 ${Math.round(gap)}ms`);
    info[`${tag}_longestFreezeMs`] = Math.round(gap);
    info[`${tag}_analysisMs`] = analysisMs;
    await page.shot(`05_${tag}_noworker`);
    check(`${tag}-5 콘솔 오류 0건`, page.errors.length === 0, page.errors.join(' | '));
    page.close();
    await sleep(500);
  }
} catch (e) {
  check('스모크 실행 중 예외', false, e instanceof Error ? e.message : String(e));
} finally {
  serve.kill();
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(root, 'log', 'smoke05_result.json'), JSON.stringify({ info, results, failed: failed.length }, null, 2), 'utf8');
  console.log(`\n합계: ${results.length - failed.length}/${results.length} 통과, 실패 ${failed.length}`);
  setTimeout(() => process.exit(failed.length ? 1 : 0), 500);
}
