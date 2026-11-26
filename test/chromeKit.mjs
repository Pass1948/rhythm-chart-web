// 04b 점검용 헤드리스 Chrome 도구 모음(개발자 도구 프로토콜, 새 패키지 없음). layoutSkeletonCheck.mjs · smoke04b.mjs 가 함께 쓴다.
// 방식은 layoutCheck/smoke 와 같다: Chrome 을 원격 디버깅 포트로 띄우고 WebSocket 으로 명령을 보낸다.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

/** 정적 파일 서버. mapPath(url) 이 파일 경로(또는 null)를 돌려주고, custom(req,res) 이 true 를 돌려주면 직접 응답한 것이다 */
export async function startServer({ mapPath, custom }) {
  const server = createServer((req, res) => {
    if (custom && custom(req, res)) return;
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = mapPath(url);
    if (!file || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

/** Chrome 을 띄우고 첫 탭에 연결한다 */
export async function launchChrome({ port, profile, size = [1280, 720], extra = [] }) {
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required',
      `--window-size=${size[0]},${size[1]}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...extra, 'about:blank',
    ],
    { stdio: 'ignore' },
  );
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
  const page = await connect(first.webSocketDebuggerUrl);
  return { chrome, page };
}

/** 한 탭에 연결해 쓰기 쉬운 함수들을 만든다 */
export async function connect(wsUrl, tag = '메인') {
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
  const send = (method, params = {}) =>
    new Promise((r) => {
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
  /** 화면 크기를 바꾼다(손가락 화면이면 touch=true) */
  const resize = async (w, h, { touch = false, dpr = 1 } = {}) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: touch });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch });
    await sleep(250);
  };
  const navigate = async (url) => {
    await send('Page.navigate', { url });
    await sleep(300);
  };
  /** 스크린샷을 파일로 저장하고 경로를 돌려준다 */
  const shotTo = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  };
  const click = async (selector) => {
    const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!r) throw new Error('요소 없음: ' + selector);
    await mouseClick(r.x, r.y);
  };
  const mouseClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  /** 마우스 끌기: (x1,y1) 에서 눌러 (x2,y2) 까지 끌고 뗀다(슬라이더 조작용) */
  const mouseDrag = async (x1, y1, x2, y2) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
  };
  const key = async (code, k) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k || code, windowsVirtualKeyCode: code === 'Escape' ? 27 : 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k || code, windowsVirtualKeyCode: code === 'Escape' ? 27 : 0 });
  };
  /** 손가락 입력 */
  const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  const touchTapAt = async (x, y) => {
    await touch('touchStart', [{ x, y }]);
    await sleep(40);
    await touch('touchEnd', []);
    await sleep(60);
  };
  return { ws, send, ev, waitFor, resize, navigate, shotTo, click, mouseClick, mouseDrag, key, touch, touchTapAt, errors, close: () => ws.close() };
}

/** 폴더 만들기 */
export function ensureDir(d) {
  mkdirSync(d, { recursive: true });
  return d;
}
