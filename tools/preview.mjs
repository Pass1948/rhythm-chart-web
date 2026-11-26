// 미리보기.bat 가 부르는 도구 (05단계): 필요하면 설치·빌드를 하고, dist 를 로컬에서 서빙하며 브라우저를 연다.
// 안내 문구는 모두 여기서 쉬운 한국어로 출력하고, 자세한 로그는 log\preview.txt 에 남긴다. 오류면 종료 코드 1.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
mkdirSync('log', { recursive: true });
const logFile = join(root, 'log', 'preview.txt');
writeFileSync(logFile, `[${new Date().toISOString()}] 미리보기 시작\n`, 'utf8');
const note = (t) => appendFileSync(logFile, t + '\n', 'utf8');

/** 명령을 실행하고 출력은 로그 파일에 남긴다. 성공하면 true */
function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, shell: true, encoding: 'utf8', windowsHide: true });
  note(`--- ${label} (종료 코드 ${r.status}) ---\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return r.status === 0;
}
/** 안내 후 실패로 끝낸다 */
function fail(msg) {
  console.log('\n[안내] ' + msg);
  console.log('       자세한 내용은 ' + logFile + ' 에 있습니다.');
  process.exit(1);
}

if (!existsSync(join(root, 'node_modules'))) {
  console.log('처음 실행이라 필요한 부품을 설치합니다. 잠시만 기다려 주세요...');
  if (!run('npm install', 'npm', ['install'])) fail('부품 설치에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행해 주세요.');
}

const stale = spawnSync(process.execPath, [join(root, 'tools', 'staticServe.mjs'), '--check-build'], { cwd: root }).status !== 0;
if (stale) {
  console.log('화면을 새로 만드는 중입니다. 잠시만 기다려 주세요...');
  if (!run('npm run build', 'npm', ['run', 'build'])) fail('화면을 만들지 못했습니다. 프로그램 코드에 문제가 있을 수 있습니다.');
} else {
  console.log('이미 최신 상태라 빌드를 건너뜁니다.');
}

console.log('\n브라우저가 열립니다. 이 창을 닫으면 미리보기가 끝납니다.');
console.log('주소가 열리지 않으면 아래 URL 을 브라우저 주소창에 붙여 넣으세요.');
const server = spawn(process.execPath, [join(root, 'tools', 'staticServe.mjs'), '--open'], { cwd: root, stdio: 'inherit' });
server.on('exit', (code) => {
  if (code) fail('미리보기 서버를 시작하지 못했습니다.');
  process.exit(0);
});
