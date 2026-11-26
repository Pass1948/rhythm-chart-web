// dist 정적 서버 (05단계). 서버 없이 올라가는 게시 환경을 흉내 내기 위한 아주 작은 서버다(새 패키지 없음).
// 사용:
//   node tools/staticServe.mjs [--port 4173] [--prefix /임의/하위/경로/] [--open] [--dir dist]
//   node tools/staticServe.mjs --check-build     (dist 가 소스보다 오래됐으면 종료 코드 1)
// --prefix 를 주면 그 주소 아래에서만 파일을 내준다(하위 경로 서빙 테스트). 기본은 "/".
// 시작하면 "URL: http://127.0.0.1:포트/prefix" 한 줄을 출력한다. 포트가 사용 중이면 다음 포트로 넘어간다.
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};

/** 폴더 안 가장 늦은 수정 시각 */
function newest(dir) {
  let t = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    t = Math.max(t, st.isDirectory() ? newest(p) : st.mtimeMs);
  }
  return t;
}

if (args.includes('--check-build')) {
  const index = join(root, 'dist', 'index.html');
  if (!existsSync(index)) process.exit(1);
  const built = statSync(index).mtimeMs;
  const srcTime = Math.max(newest(join(root, 'src')), newest(join(root, 'config')), statSync(join(root, 'index.html')).mtimeMs, statSync(join(root, 'vite.config.ts')).mtimeMs);
  process.exit(srcTime > built ? 1 : 0);
}

const dist = resolve(root, opt('--dir', 'dist'));
let prefix = opt('--prefix', '/');
if (!prefix.startsWith('/')) prefix = '/' + prefix;
if (!prefix.endsWith('/')) prefix += '/';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const hit = url.startsWith(prefix) || url + '/' === prefix;
  if (!hit) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found (prefix)');
    return;
  }
  let rel = url.slice(prefix.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = resolve(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});

let port = Number(opt('--port', '4173'));
/** 포트가 사용 중이면 다음 포트로 */
function listen() {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < Number(opt('--port', '4173')) + 50) {
      port++;
      listen();
    } else {
      console.error('서버를 시작하지 못했습니다: ' + e.message);
      process.exit(2);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${port}${prefix}`;
    console.log('URL: ' + address); // 콘솔 글꼴 문제로 깨져 보이지 않게 영문 표시
    if (args.includes('--open')) spawn('cmd', ['/c', 'start', '', address], { stdio: 'ignore', detached: true }).unref();
  });
}
listen();
