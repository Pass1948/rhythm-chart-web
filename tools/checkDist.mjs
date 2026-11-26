// dist 폴더 게시 점검 도구 (05단계, 07에서 GitHub Pages 기준으로 정리). 사용: npm run build 뒤에  node tools/checkDist.mjs
// 확인: 금지 항목(음원·글꼴·큰 이미지·서버 호출·절대 경로·localhost). 파일 수·용량·JS 크기 한도는 검사하지 않는다(아티팩트 기준 제한 폐지).
// 크기·파일 수는 참고용으로만 출력한다.
// 결과는 화면과 log\checkDist.txt 에 남긴다. 문제가 있으면 종료 코드 1.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedAudio } from './audioException.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const MB = 1024 * 1024;
const lines = [];
const say = (t) => {
  lines.push(t);
  console.log(t);
};

/** 폴더 안 모든 파일 */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(dist).map((p) => ({ path: relative(dist, p).split(sep).join('/'), size: statSync(p).size, abs: p }));
const total = files.reduce((a, f) => a + f.size, 0);
const biggest = files.reduce((a, f) => (f.size > a.size ? f : a), files[0]);
const problems = [];

say(`# dist 점검 (${new Date().toISOString()})`);
say(`파일 수: ${files.length}개 (참고용)`);
say(`총 크기: ${(total / MB).toFixed(3)} MB (참고용)`);
say(`가장 큰 파일: ${biggest.path} ${(biggest.size / MB).toFixed(3)} MB (참고용)`);

// 음원·이미지 확장자
const AUDIO = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'];
const FONT = ['.woff', '.woff2', '.ttf', '.otf']; // 04c: 글꼴 파일은 넣지 않기로 함(사용자 결정)
const IMAGE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif'];
// 04g: 사용자가 준 효과음 하나만 예외(이름·크기 고정). 지금은 JS 에 포함되지만 파일로 있어도 이 한 개만 허용한다.
for (const f of files) {
  const ext = extname(f.path).toLowerCase();
  if (AUDIO.includes(ext) && !isAllowedAudio(f.path, f.size)) problems.push(`음원 파일이 들어 있습니다: ${f.path} (${f.size} bytes)`);
  if (FONT.includes(ext)) problems.push(`글꼴 파일이 들어 있습니다: ${f.path} (${f.size} bytes)`);
  // 12: 10-C 화면 그림 폴더(img10c/)만 20KB 한도 예외. 대신 한 장당 200KB 이하인지는 검사한다(큰 원본이 실수로 들어가는 것 방지)
  const in10c = f.path.startsWith('img10c/');
  if (IMAGE.includes(ext) && in10c && f.size > 200 * 1024) problems.push(`10-C 그림이 너무 큽니다(한 장 200KB 이하): ${f.path} (${f.size} bytes)`);
  if (IMAGE.includes(ext) && !in10c && f.size > 20 * 1024) problems.push(`큰 이미지가 들어 있습니다: ${f.path} (${f.size} bytes)`);
}

// 글자 검사 (텍스트 파일만)
const TEXT = ['.html', '.js', '.css', '.json', '.svg', '.map', '.txt', '.mjs'];
const rules = [
  { name: "서버 호출 fetch('/api", re: /fetch\(\s*['"`]\/api/g },
  { name: '절대 경로 "/assets/', re: /["'`(]\/assets\//g },
  { name: '절대 경로 src="/', re: /\b(?:src|href)=["']\/(?!\/)/g },
  { name: 'localhost 문자열', re: /localhost/gi },
  { name: '127.0.0.1 문자열', re: /127\.0\.0\.1/g },
];
// 허용 목록: 표준 네임스페이스 주소(svg·w3 등)는 네트워크 요청이 아니다
const externalUrls = new Set();
for (const f of files) {
  if (!TEXT.includes(extname(f.path).toLowerCase())) continue;
  const text = readFileSync(f.abs, 'utf8');
  for (const r of rules) {
    const m = text.match(r.re);
    if (m) problems.push(`${r.name}: ${f.path} 에서 ${m.length}건 (예: ${String(m[0]).slice(0, 80)})`);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) externalUrls.add(`${m[0].slice(0, 90)}  (${f.path})`);
}
say('');
say('코드 안에 들어 있는 http(s) 주소 (참고: 네임스페이스·주석 문구는 요청이 아님):');
for (const u of [...externalUrls].sort()) say('  - ' + u);

say('');
say('파일 목록 (경로 / 크기):');
for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) say(`  ${f.path}  ${f.size} bytes`);
say('');
say(problems.length === 0 ? '결과: 통과 (문제 없음)' : '결과: 실패\n' + problems.map((p) => '  - ' + p).join('\n'));
mkdirSync(join(root, 'log'), { recursive: true });
writeFileSync(join(root, 'log', 'checkDist.txt'), lines.join('\n'), 'utf8');
process.exit(problems.length === 0 ? 0 : 1);
