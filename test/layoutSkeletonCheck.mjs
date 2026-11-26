// 07 배치 검사(헤드리스 Chrome): 새 편집기 배치(00 공통규칙 6절)가 지켜지는지 자동으로 확인한다.
//  PC(폭 1024 이상, 기본 1280x720 · 1440x900 · 1920x1080, 곡 없음/노트 있음):
//   - 맨 위 가로 줄(#dropBar)이 상단 바 바로 아래에 한 줄 높이로 폭 전체를 쓰고, 그 안의 #dropZone 이 눌러진다
//   - 왼쪽 열 위→아래: 곡 정보(#cardSong) → 검사(#rightCol) → 분석(#cardAnalyze), 같은 x·같은 폭
//   - 가운데 열 위→아래: 음원(#cardAudio) → 변속 구간(#cardTempo) → 노트 생성(#cardGen), 같은 x·가운데 열 폭 전체(가로로 나란히 두지 않음)
//   - 오른쪽 열: 채보 편집(#cardEdit). 열 순서 왼쪽 < 가운데 < 오른쪽
//   - 왼쪽·가운데 열은 각각 따로 세로 스크롤(한쪽을 내려도 다른 쪽·상단 바·곡 등록 줄·채보 편집이 안 움직임), 페이지 전체는 안 밀림, 가로 스크롤 없음
//   - 카드 안 글자 잘림·삐져나옴 0건(왼쪽 열 폭이 충분한지 확인)
//  탭 배치(폭 1024 미만, 390x844 · 1000x700): 하단 탭 5개, 탭마다 보이는 카드와 순서가 layoutLogic.ts 의 TAB_CARDS 와 같다
// 사용: npm run build 뒤에   node test/layoutSkeletonCheck.mjs           (기본 PC 3종 + 탭 2종)
//                           node test/layoutSkeletonCheck.mjs narrow    (좁은 PC 폭 1024~1279 만)
// 결과: log\layoutSkeleton.json, 스크린샷 log\screens\07_layout_*.png
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, launchChrome, sleep, startServer } from './chromeKit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shots = ensureDir(join(root, 'log', 'screens'));
const tmp = ensureDir(join(root, '_to_delete', '점검_임시'));
const mode = process.argv[2] || 'default';

const PC_SIZES = mode === 'narrow' ? [[1024, 768], [1100, 720], [1279, 720]] : [[1280, 720], [1440, 900], [1920, 1080]];
const TAB_SIZES = mode === 'narrow' ? [] : [[390, 844, true], [1000, 700, false]];
/** 탭마다 보여야 할 카드(위→아래 순서). layoutLogic.ts 의 TAB_CARDS 와 같아야 한다 */
const TAB_CARDS = {
  song: ['dropBar', 'cardSong'],
  analyze: ['cardAnalyze', 'cardAudio', 'cardTempo', 'cardGen'],
  edit: ['cardEdit'],
  inspect: ['rightCol'],
};
const CARD_IDS = ['dropBar', 'cardSong', 'rightCol', 'cardAnalyze', 'cardAudio', 'cardTempo', 'cardGen', 'cardEdit'];
const EPS = 2;

/** 페이지 안에서 카드·열 위치를 모으는 식 */
const BOXES = `(() => {
  const ids = ${JSON.stringify(CARD_IDS)};
  const box = (e) => { if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display === 'none' || !r.width ? null : { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const out = { vw: innerWidth, vh: innerHeight, cards: {}, panes: {} };
  for (const id of ids) out.cards[id] = box(document.getElementById(id));
  out.topbar = box(document.querySelector('.topbar'));
  for (const [k, id] of [['left', 'paneLeft'], ['mid', 'paneMid'], ['right', 'paneRight']]) {
    const e = document.getElementById(id);
    const cs = getComputedStyle(e);
    out.panes[k] = { box: box(e), overflowY: cs.overflowY, scrollH: e.scrollHeight, clientH: e.clientHeight, clientW: e.clientWidth };
  }
  out.hscroll = document.documentElement.scrollWidth > innerWidth + 1;
  out.pageVScroll = document.documentElement.scrollHeight > innerHeight + 1 || document.body.scrollHeight > innerHeight + 1;
  const dz = document.getElementById('dropZone');
  if (dz) { const r = dz.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); out.dropHit = !!(hit && hit.closest('#dropZone')); out.dropText = dz.textContent.trim().slice(0, 60); }
  out.dropH = dz ? Math.round(dz.getBoundingClientRect().height) : 0;
  out.tabs = [...document.querySelectorAll('#tabBar button')].map((b) => b.textContent.trim());
  out.tabBarShown = (() => { const t = document.getElementById('tabBar'); return !!t && getComputedStyle(t).display !== 'none'; })();
  return out;
})()`;

/** 카드 안 글자 잘림·삐져나옴 검사 식: 가로로 넘치는 요소(말줄임으로 일부러 줄인 것은 제외) */
const OVERFLOW = `(() => {
  const bad = [];
  for (const card of document.querySelectorAll('.card, .topbar, .dropbar')) {
    const cr = card.getBoundingClientRect();
    if (!cr.width) continue;
    for (const e of card.querySelectorAll('*')) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'inline' || cs.display === 'contents') continue;
      if (e.closest('[hidden], details:not([open]) > :not(summary)')) continue;
      if (e.tagName === 'CANVAS' || e.tagName === 'OPTION' || e.closest('canvas')) continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const ell = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '');
      const hOver = e.scrollWidth > e.clientWidth + 1 && !ell && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll';
      const outside = r.right > cr.right + 1.5 && !e.closest('.soundpop, .popover, .menu') && !(e.closest('.transport') && getComputedStyle(e.closest('.transport')).position === 'fixed');
      if (hOver || outside) bad.push({ el: e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0], card: card.id || String(card.className).split(' ')[0], text: (e.textContent || '').trim().slice(0, 18), kind: hOver ? 'scroll' : 'outside', sw: e.scrollWidth, cw: e.clientWidth });
    }
  }
  return bad.filter((o) => !/^(#songName|#statusLine|\\.sname|\\.audiosub|\\.drop)/.test(o.el)).slice(0, 40);
})()`;

/** 따로 스크롤 검사 식: 왼쪽·가운데 열을 각각 끝까지 내려 보고, 다른 열·고정 요소가 안 움직이는지 본다 */
const SCROLL = `(() => {
  const g = (id) => document.getElementById(id);
  const L = g('paneLeft'), M = g('paneMid');
  const ys = () => ['dropBar', 'cardEdit'].map((id) => Math.round(g(id).getBoundingClientRect().y)).concat([Math.round(document.querySelector('.topbar').getBoundingClientRect().y)]);
  L.scrollTop = 0; M.scrollTop = 0;
  const fixed0 = ys();
  L.scrollTop = 99999;
  const leftMoved = L.scrollTop;
  const midWhileLeft = M.scrollTop;
  const fixedAfterLeft = ys();
  L.scrollTop = 0;
  M.scrollTop = 99999;
  const midMoved = M.scrollTop;
  const leftWhileMid = L.scrollTop;
  const fixedAfterMid = ys();
  const docTop = document.scrollingElement.scrollTop;
  L.scrollTop = 0; M.scrollTop = 0;
  return { leftCan: L.scrollHeight > L.clientHeight + 1, midCan: M.scrollHeight > M.clientHeight + 1, leftMoved, midMoved, midWhileLeft, leftWhileMid, fixedStill: JSON.stringify(fixed0) === JSON.stringify(fixedAfterLeft) && JSON.stringify(fixed0) === JSON.stringify(fixedAfterMid), docTop };
})()`;

const app = await startServer({ mapPath: (url) => join(dist, url === '/' ? 'index.html' : url) });
const { chrome, page } = await launchChrome({ port: 9411, profile: join(tmp, `chrome_profile_07_layout_${Date.now()}`) });
const results = { ranAt: new Date().toISOString(), mode, pc: [], tabs: [] };
let failed = 0;
const fail = (list, msg) => {
  list.push(msg);
};

/** 새 화면: 노트가 있는 상태를 만든다(데모 곡 → 분석 → 노트 자동 생성) */
async function makeNotes() {
  await page.click('#btnDemo');
  await page.waitFor(`window.__editor && window.__editor().S.song`, 30000, '데모 곡 열림');
  await sleep(1500); // 곡이 열리며 왼쪽 열(곡 정보·최근 곡) 높이가 바뀌므로, 분석 버튼 위치가 자리 잡은 뒤에 누른다
  await page.click('#btnAnalyze');
  await page.waitFor(`window.__editor().S.analysis`, 120000, '분석 끝');
  await sleep(500);
  await page.click('#btnGenerate');
  await page.waitFor(`window.__editor().S.chart.difficulties[0].notes.length > 0`, 60000, '노트 생성');
  await sleep(600);
}

const near = (a, b) => Math.abs(a - b) <= EPS;

/** PC 배치 한 번 검사 → 어긋난 점 목록 */
async function checkPc(w, h, state) {
  await page.resize(w, h);
  await sleep(700);
  // 앞 단계(분석 버튼 클릭 등)에서 열이 스크롤된 채 남아 있을 수 있어, 위치를 재기 전에 맨 위로 되돌린다
  await page.ev(`(() => { document.getElementById('paneLeft').scrollTop = 0; document.getElementById('paneMid').scrollTop = 0; })()`);
  await sleep(100);
  const b = await page.ev(BOXES);
  const bad = [];
  const c = b.cards;
  for (const id of ['dropBar', 'cardSong', 'rightCol', 'cardAnalyze', 'cardAudio', 'cardTempo', 'cardGen', 'cardEdit']) if (!c[id]) fail(bad, `${id} 가 안 보임`);
  if (bad.length === 0) {
    // 맨 위 가로 줄
    const gap = c.dropBar.y - (b.topbar.y + b.topbar.h);
    if (gap < -EPS || gap > 24) fail(bad, `곡 등록 줄이 상단 바 바로 아래가 아님(간격 ${Math.round(gap)}px)`);
    if (b.dropH < 36 || b.dropH > 64) fail(bad, `곡 등록 줄 높이 ${b.dropH}px (한 줄 약 48px, 36~64px 기대)`);
    if (c.dropBar.w < b.vw * 0.9) fail(bad, `곡 등록 줄이 폭 전체가 아님(${Math.round(c.dropBar.w)}px)`);
    if (!b.dropHit) fail(bad, '곡 등록 영역 한가운데를 눌러도 #dropZone 이 눌리지 않음');
    if (c.dropBar.y + c.dropBar.h > c.cardSong.y + EPS) fail(bad, '곡 등록 줄이 왼쪽 열과 겹침');
    // 왼쪽 열
    const left = ['cardSong', 'rightCol', 'cardAnalyze'];
    for (const id of left) if (!near(c[id].x, c.cardSong.x) || !near(c[id].w, c.cardSong.w)) fail(bad, `왼쪽 열 ${id} 의 x·폭이 다름`);
    if (!(c.cardSong.y + c.cardSong.h <= c.rightCol.y + EPS && c.rightCol.y + c.rightCol.h <= c.cardAnalyze.y + EPS)) fail(bad, '왼쪽 열 순서가 곡 정보 → 검사 → 분석이 아님');
    // 가운데 열
    const mid = ['cardAudio', 'cardTempo', 'cardGen'];
    for (const id of mid) {
      if (!near(c[id].x, c.cardAudio.x) || !near(c[id].w, c.cardAudio.w)) fail(bad, `가운데 열 ${id} 의 x·폭이 다름(가로로 나란히 놓였는지 확인)`);
      if (c[id].w < b.panes.mid.clientW * 0.95) fail(bad, `${id} 가 가운데 열 폭 전체를 쓰지 않음(${Math.round(c[id].w)} / ${b.panes.mid.clientW})`);
    }
    if (!(c.cardAudio.y + c.cardAudio.h <= c.cardTempo.y + EPS && c.cardTempo.y + c.cardTempo.h <= c.cardGen.y + EPS)) fail(bad, '가운데 열 순서가 음원 → 변속 구간 → 노트 생성이 아님');
    // 열 순서
    if (!(c.cardSong.x + c.cardSong.w <= c.cardAudio.x + EPS && c.cardAudio.x + c.cardAudio.w <= c.cardEdit.x + EPS)) fail(bad, '열 순서가 왼쪽 < 가운데 < 오른쪽이 아님');
    // 스크롤
    for (const k of ['left', 'mid']) if (!['auto', 'scroll'].includes(b.panes[k].overflowY)) fail(bad, `${k} 열이 따로 스크롤되지 않음(overflow-y ${b.panes[k].overflowY})`);
    if (b.panes.right.overflowY !== 'hidden') fail(bad, `오른쪽 열이 고정되지 않음(overflow-y ${b.panes.right.overflowY})`);
  }
  if (b.hscroll) fail(bad, '가로 스크롤이 생김');
  if (b.pageVScroll) fail(bad, '페이지 전체가 세로로 밀림');
  const s = await page.ev(SCROLL);
  if (s.docTop !== 0) fail(bad, '페이지 스크롤이 움직임');
  if (s.leftCan && !(s.leftMoved > 0 && s.midWhileLeft === 0)) fail(bad, '왼쪽 열이 따로 스크롤되지 않음');
  if (s.midCan && !(s.midMoved > 0 && s.leftWhileMid === 0)) fail(bad, '가운데 열이 따로 스크롤되지 않음');
  if (!s.fixedStill) fail(bad, '열을 스크롤하자 상단 바·곡 등록 줄·채보 편집이 움직임');
  const overflow = await page.ev(OVERFLOW);
  if (overflow.length) fail(bad, `글자 잘림·삐져나옴 ${overflow.length}건`);
  const file = join(tmp, `pc_${state}_${w}x${h}.png`);
  await page.shotTo(file);
  const shot = `07_layout_${w}x${h}_${state === 'empty' ? '곡없음' : '노트있음'}.png`;
  copyFileSync(file, join(shots, shot));
  const row = { state, size: `${w}x${h}`, pass: bad.length === 0, problems: bad, overflow: overflow.slice(0, 10), leftWidth: c.cardSong ? Math.round(c.cardSong.w) : null, midWidth: c.cardAudio ? Math.round(c.cardAudio.w) : null, dropBarHeight: b.dropH, leftScrollable: s.leftCan, midScrollable: s.midCan, shot };
  if (!row.pass) failed += 1;
  results.pc.push(row);
  console.log(`${row.pass ? '통과' : '미충족'}  ${state === 'empty' ? '곡 없음' : '노트 있음'} ${w}x${h}  왼쪽 열 ${row.leftWidth}px · 가운데 열 ${row.midWidth}px · 곡 등록 줄 높이 ${row.dropBarHeight}px · 왼쪽 스크롤 ${s.leftCan ? '가능' : '없음'} · 가운데 스크롤 ${s.midCan ? '가능' : '없음'}${bad.length ? '\n    - ' + bad.join('\n    - ') : ''}`);
  for (const o of overflow.slice(0, 6)) console.log('      ', JSON.stringify(o));
}

/** 탭 배치 검사: 탭마다 보이는 카드·순서 */
async function checkTabs(w, h, touch) {
  await page.resize(w, h, touch ? { touch: true, dpr: 2 } : {});
  await sleep(700);
  const bad = [];
  const first = await page.ev(BOXES);
  if (!first.tabBarShown) fail(bad, '하단 탭 바가 안 보임');
  if (JSON.stringify(first.tabs.map((t) => t.replace(/^\S\s*/, '').trim())) !== JSON.stringify(['곡', '분석', '편집', '검사', '플레이'])) fail(bad, `탭 이름이 [곡][분석][편집][검사][플레이]가 아님: ${first.tabs.join('|')}`);
  for (const [tab, expected] of Object.entries(TAB_CARDS)) {
    await page.ev(`window.__rcwLayout.layout.setTab(${JSON.stringify(tab)})`);
    await sleep(350);
    const b = await page.ev(BOXES);
    const shown = CARD_IDS.filter((id) => b.cards[id] && !(tab === 'edit' && id === 'cardAudio' && b.cards[id].h < 1)).sort((a, z) => b.cards[a].y - b.cards[z].y);
    if (JSON.stringify(shown) !== JSON.stringify(expected)) fail(bad, `[${tab}] 탭에 보이는 카드 ${shown.join('→') || '없음'} (기대 ${expected.join('→')})`);
    if (b.hscroll) fail(bad, `[${tab}] 탭에서 가로 스크롤이 생김`);
    if (tab === 'edit') {
      // 06: 편집 탭에는 재생 줄(음원 카드와 같은 요소)이 탭 바 바로 위에 고정되고 편집 영역을 가리지 않는다
      const t = await page.ev(`(() => { const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { y: r.y, b: r.bottom, h: r.height, w: r.width, shown: getComputedStyle(e).display !== 'none' && r.width > 0 }; }; return { tr: q('#transport'), tab: q('#tabBar'), edit: q('#cardEdit'), play: q('#btnPlay'), seek: q('#seek'), n: document.querySelectorAll('#btnPlay').length }; })()`);
      if (!t.tr || !t.tr.shown || !t.play.shown || !t.seek.shown) fail(bad, '[edit] 탭에 재생 줄(▶·위치 막대)이 안 보임');
      else {
        if (Math.abs(t.tr.b - t.tab.y) > 2) fail(bad, `[edit] 재생 줄이 탭 바 바로 위에 있지 않음(차이 ${Math.round(t.tab.y - t.tr.b)}px)`);
        if (t.edit.b > t.tr.y + 2) fail(bad, '[edit] 재생 줄이 채보 편집 화면을 가림');
      }
      if (t.n !== 1) fail(bad, '재생 버튼이 둘 이상(새 재생기를 만들면 안 됨)');
    }
    const overflow = await page.ev(OVERFLOW);
    if (overflow.length) fail(bad, `[${tab}] 탭에서 글자 잘림·삐져나옴 ${overflow.length}건 (${overflow.slice(0, 3).map((o) => o.el).join(', ')})`);
    const file = join(tmp, `tab_${tab}_${w}x${h}.png`);
    await page.shotTo(file);
    copyFileSync(file, join(shots, `07_layout_tab_${tab}_${w}x${h}.png`));
  }
  const row = { size: `${w}x${h}`, pass: bad.length === 0, problems: bad };
  if (!row.pass) failed += 1;
  results.tabs.push(row);
  console.log(`${row.pass ? '통과' : '미충족'}  탭 배치 ${w}x${h}${bad.length ? '\n    - ' + bad.join('\n    - ') : ''}`);
}

await page.navigate(app.origin + '/');
await page.waitFor(`document.getElementById('cardSong') && document.getElementById('statusLine')`, 30000, '새 화면');
await sleep(800);
console.log('\n편집기 배치 검사 (07)');
for (const [w, h] of PC_SIZES) await checkPc(w, h, 'empty');
await makeNotes();
for (const [w, h] of PC_SIZES) await checkPc(w, h, 'notes');
for (const [w, h, touch] of TAB_SIZES) await checkTabs(w, h, touch);

results.summary = { failed };
writeFileSync(join(root, 'log', mode === 'narrow' ? 'layoutSkeleton_narrow.json' : 'layoutSkeleton.json'), JSON.stringify(results, null, 2));
console.log(`\n${failed === 0 ? '모두 통과' : failed + '건 미충족'}  (log\\layoutSkeleton.json, log\\screens\\07_layout_*.png)`);
chrome.kill();
app.server.close();
process.exit(failed === 0 ? 0 : 1);
