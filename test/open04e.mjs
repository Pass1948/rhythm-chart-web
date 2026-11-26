// 04e 열기 점검(한 번): 앱이 열리고 콘솔 오류가 없는지, 파형이 생기는지, 변속 구간 카드가 보이는지만 확인한다. (화면 모양·동작은 사용자가 직접 확인)
// 사용: npm run build 뒤에  node test/open04e.mjs
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, launchChrome, sleep, startServer } from './chromeKit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const tmp = ensureDir(join(root, '_to_delete', '점검_임시'));
const app = await startServer({ mapPath: (url) => join(dist, url === '/' ? 'index.html' : url) });
const { chrome, page } = await launchChrome({ port: 9431, profile: join(tmp, `chrome_profile_04e_${Date.now()}`) });
const out = [];
const check = (name, ok, detail = '') => { out.push(ok); console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? '  — ' + detail : ''}`); };
try {
  await page.resize(1440, 900);
  await page.navigate(app.origin + '/');
  await page.waitFor(`document.getElementById('btnDemo') && !document.getElementById('welcome').hidden`, 30000, '첫 화면');
  await page.click('#btnDemo');
  await page.waitFor(`window.__editor && window.__editor().S.song`, 30000, '곡 열림');
  await sleep(1500); // 07: 곡이 열리며 왼쪽 열 높이가 바뀌므로 분석 버튼 위치가 자리 잡은 뒤에 누른다
  await page.click('#btnAnalyze');
  await page.waitFor(`window.__editor().S.analysis && window.__editor().S.wave`, 120000, '분석+파형');
  await sleep(500);
  const info = await page.ev(`(() => { const S = window.__editor().S; return { frames: S.wave.frames, len: S.wave.data.length, max: Math.max(...S.wave.data), card: !!document.getElementById('cardTempo'), rows: document.querySelectorAll('#tempoList .trow').length, findEnabled: !document.getElementById('btnTempoFind').disabled, showWave: S.showWave, label: document.getElementById('btnWave').textContent }; })()`);
  check('분석 뒤 파형이 저장돼 있다(길이 맞음, 소리 있음)', info.len === info.frames * 4 && info.max > 100, JSON.stringify({ frames: info.frames, max: info.max }));
  check('[파형] 토글, PC 기본 켬', info.label === '파형' && info.showWave === true);
  check('변속 구간 카드가 보이고 목록에 첫 구간이 있다, 분석 뒤 [변속 자동 찾기] 켜짐', info.card && info.rows === 2 && info.findEnabled, JSON.stringify(info));
  await page.click('#btnTempoFind');
  await sleep(300);
  const msg = await page.ev(`document.getElementById('tempoMsg').textContent`);
  check('자동 찾기를 누르면 결과 안내가 나온다', msg.length > 5, msg);
  await sleep(500);
  const errs = page.errors.length;
  check('콘솔 오류 0건', errs === 0, errs ? JSON.stringify(page.errors.slice(0, 5)) : '0');
} catch (e) {
  console.log('실패  ' + e.message);
  out.push(false);
} finally {
  page.close();
  chrome.kill();
  app.server.close();
}
process.exit(out.every(Boolean) ? 0 : 1);
