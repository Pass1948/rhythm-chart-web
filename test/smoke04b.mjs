// 04b 게임 플레이 옵션 스모크(헤드리스 Chrome): 판정 프리셋·직접 입력·볼륨(도중 즉시 적용)·음소거·일시정지/처음부터 다시/결과 표시·긴 곡 이름·버튼 잘림.
// 사용: npm run build 뒤에  node test/smoke04b.mjs   (결과: log\smoke04b_result.json, 스크린샷 log\screens\04b_play_*.png)
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, launchChrome, sleep, startServer } from './chromeKit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shots = ensureDir(join(root, 'log', 'screens'));
const tmp = ensureDir(join(root, '_to_delete', '점검_임시'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const app = await startServer({ mapPath: (url) => join(dist, url === '/' ? 'index.html' : url) });
const { chrome, page } = await launchChrome({ port: 9412, profile: join(tmp, `chrome_profile_04b_play_${Date.now()}`) });

const PLAY = (expr) => `window.__rcwPlay && ${expr}`;
const settings = () => page.ev(`JSON.parse(localStorage.getItem('rcw.settings.v1') || '{}')`);
const shot = async (name) => page.shotTo(join(shots, `04b_play_${name}.png`));
/** 버튼 글자로 누른다 */
const clickText = (text, root = '.rcw-play') => page.ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(root + ' button')})].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
/** 슬라이더 값을 바꾸고 input 이벤트를 보낸다 */
const setRange = (sel, value) => page.ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false; i.value = ${value}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const setNumber = (sel, value) => page.ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false; i.value = ${value}; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

// 자동 플레이어(smoke03 과 같다: 키보드 이벤트로 노트를 친다)
const AUTO = `
window.__auto = function () {
  const p = window.__rcwPlay; const notes = p.notes(); const ev = [];
  notes.forEach((n) => {
    if (n.type === 'tap') { ev.push({ t: n.timeMs, k: 'd', lane: n.lane }, { t: n.timeMs + 40, k: 'u', lane: n.lane }); }
    else if (n.type === 'hold') { ev.push({ t: n.timeMs, k: 'd', lane: n.lane }, { t: n.timeMs + n.durationMs, k: 'u', lane: n.lane }); }
    else { const total = n.count + 2; const step = n.durationMs / total; for (let j = 0; j < total; j++) { const lane = j % 2; const t = n.timeMs + step * (j + 0.3); ev.push({ t, k: 'd', lane }, { t: t + step * 0.4, k: 'u', lane }); } }
  });
  ev.sort((a, b) => a.t - b.t || (a.k === b.k ? 0 : a.k === 'u' ? -1 : 1));
  const state = { idx: 0, stop: false }; window.__autoState = state;
  const keys = ['KeyS', 'KeyF'];
  const timer = setInterval(() => {
    const q = window.__rcwPlay; if (!q || state.stop) { clearInterval(timer); return; }
    if (q.phase() !== 'playing') return;
    const now = q.heardSongMs();
    while (state.idx < ev.length && ev[state.idx].t <= now) { const e = ev[state.idx]; window.dispatchEvent(new KeyboardEvent(e.k === 'd' ? 'keydown' : 'keyup', { code: keys[e.lane], key: keys[e.lane].slice(3).toLowerCase(), bubbles: true, cancelable: true })); state.idx++; }
  }, 1);
  return ev.length;
};
window.__autoStop = () => { if (window.__autoState) window.__autoState.stop = true; };
`;

try {
  await page.resize(1280, 720);
  await page.navigate(app.origin + '/');
  await page.waitFor(`document.getElementById('btnDemo') && !document.getElementById('welcome').hidden`, 30000, '첫 화면');
  // 데모 곡 → 분석 → 노트 생성
  await page.click('#btnDemo');
  await page.waitFor(`window.__editor && window.__editor().S.song`, 30000, '곡 열림');
  await page.click('#btnAnalyze');
  await page.waitFor(`window.__editor().S.analysis`, 120000, '분석');
  await sleep(400);
  await page.click('#btnGenerate');
  await page.waitFor(`window.__editor().S.chart.difficulties[0].notes.length > 0`, 60000, '노트 생성');
  await sleep(500);
  await page.ev(AUTO);

  // ============================================================ PC: 시작 전 창
  await page.click('#btnPlayTest');
  await page.waitFor(`document.querySelector('.rcw-play .pl-start')`, 30000, '시작 창');
  await sleep(400);
  check('시작 창에 볼륨(음악·효과음·음소거)과 [판정 설정]이 있다', await page.ev(`!!document.querySelector('.pl-start [data-volume=music]') && !!document.querySelector('.pl-start [data-volume=sfx]') && !!document.querySelector('.pl-start [data-mute]') && !!document.querySelector('.pl-start details.pl-judge')`));
  check('화면 모드 기본은 화이트(저장값 없음)', (await page.ev(`document.documentElement.getAttribute('data-theme')`)) === 'light');
  // 긴 곡 이름(공백 없음)이 창 밖으로 넘치지 않는다
  await page.ev(`(() => { const t = document.querySelector('.pl-start .pl-dialog-text'); t.textContent = '가나다라마바사아자차카타파하'.repeat(6) + ' · NORMAL · 노트 47개'; })()`);
  const over = await page.ev(`(() => { const d = document.querySelector('.rcw-play .pl-start'); const t = d.querySelector('.pl-dialog-text'); const r = d.getBoundingClientRect(); const q = t.getBoundingClientRect(); return { dw: d.scrollWidth, dc: d.clientWidth, right: q.right, dr: r.right }; })()`);
  check('공백 없는 긴 곡 이름이 시작 창 밖으로 넘치지 않는다', over.dw <= over.dc + 1 && over.right <= over.dr + 1, JSON.stringify(over));
  const btnClip = await page.ev(`[...document.querySelectorAll('.rcw-play .pl-buttons .btn')].map((b) => b.scrollHeight - b.clientHeight)`);
  check('시작 창 버튼 글자 아래가 잘리지 않는다', btnClip.every((d) => d <= 1), JSON.stringify(btnClip));
  // 판정 설정 펼치기 + 프리셋
  await page.ev(`document.querySelector('.pl-start details.pl-judge').open = true`);
  await sleep(200);
  await shot('pc_start_judge');
  await page.ev(`document.querySelector('.pl-start [data-preset=loose]').click()`);
  let st = await settings();
  check('프리셋 [넉넉하게] 저장(60/120/180/240, 100/80/50/20)', st.playJudge && st.playJudge.perfectMs === 60 && st.playJudge.badMs === 240 && st.playJudge.weights.great === 80, JSON.stringify(st.playJudge));
  await setNumber('.pl-start .pl-judge-row input[type=number]', 500);
  const clamp = await page.ev(`(() => { const row = document.querySelector('.pl-start .pl-judge-row'); return { v: row.querySelector('input[type=number]').value, msg: row.querySelector('.pl-judge-msg').textContent }; })()`);
  check('범위 밖 입력(PERFECT 500)은 80으로 맞추고 한국어 안내', clamp.v === '80' && /10~80ms/.test(clamp.msg), JSON.stringify(clamp));
  await setNumber('.pl-start .pl-judge-row input[type=number]', 25);
  st = await settings();
  check('직접 입력(PERFECT 25ms) 저장 → 프리셋 표시는 [직접]', st.playJudge.perfectMs === 25 && (await page.ev(`document.querySelector('.pl-start [data-preset=custom]').classList.contains('on')`)));
  await page.ev(`document.querySelector('.pl-start [data-judge-reset]').click()`);
  st = await settings();
  check('[기본값으로 되돌리기] → 원본 값(45/95/150/200)', st.playJudge.perfectMs === 45 && st.playJudge.goodMs === 150 && st.playJudge.weights.great === 70 && !('burstGrade' in st.playJudge));
  check('연타 성공 등급 선택 항목이 없고 "연타 성공은 GREAT로 계산됩니다" 안내가 있다', (await page.ev(`!document.querySelector('[data-burst]') && document.querySelector('.pl-start .pl-judge-burst')?.textContent.includes('연타 성공은 GREAT로 계산됩니다')`)) === true);
  await page.ev(`document.querySelector('.pl-start [data-preset=strict]').click()`);
  // 볼륨: 마우스로 슬라이더 끌기
  const rect = await page.ev(`(() => { const r = document.querySelector('.pl-start [data-volume=music]').getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; })()`);
  await page.mouseDrag(rect.x + rect.w * 0.8, rect.y, rect.x + rect.w * 0.3, rect.y);
  st = await settings();
  check('음악 볼륨 슬라이더를 마우스로 끌면 저장된다(settingsStore.musicVolume)', st.musicVolume >= 20 && st.musicVolume <= 40, `musicVolume ${st.musicVolume}`);
  await setRange('.pl-start [data-volume=sfx]', 55);
  st = await settings();
  check('효과음 볼륨 저장(sfxVolume)', st.sfxVolume === 55);
  // 1.25배로 시작(짧게)
  await page.ev(`document.querySelector('.pl-start [data-rate="1.25"]').click()`);
  await page.ev(`document.querySelector('.pl-start details.pl-judge').open = false`);
  await clickText('시작');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'playing'`), 20000, '재생');
  const vol0 = await page.ev(`window.__rcwPlay.volumes()`);
  check('재생 시작: 음악 게인 = (v/100)^2, 판정 설정 = 엄격', Math.abs(vol0.musicGain - (vol0.music / 100) ** 2) < 1e-6 && (await page.ev(`window.__rcwPlay.activeJudge().perfectMs`)) === 30, JSON.stringify(vol0));
  await shot('pc_playing_panel');
  // ---- 재생 도중 PC 옆 패널에서 볼륨 즉시 적용
  check('PC 옆 패널에 음악·효과음 볼륨·음소거·[판정 설정]이 있다', await page.ev(`!!document.querySelector('.rcw-side-right [data-volume=music]') && !!document.querySelector('.rcw-side-right [data-volume=sfx]') && !!document.querySelector('.rcw-side-right [data-mute]') && [...document.querySelectorAll('.rcw-side-right button')].some((b) => b.textContent.trim() === '판정 설정')`));
  await setRange('.rcw-side-right [data-volume=music]', 50);
  await sleep(150);
  let v = await page.ev(`window.__rcwPlay.volumes()`);
  check('재생 도중 옆 패널 음악 볼륨 50 → 게인 0.25 즉시 적용', v.music === 50 && Math.abs(v.musicGain - 0.25) < 1e-6 && (await page.ev(`window.__rcwPlay.phase()`)) === 'playing', JSON.stringify(v));
  await setRange('.rcw-side-right [data-volume=sfx]', 0);
  await sleep(100);
  v = await page.ev(`window.__rcwPlay.volumes()`);
  check('효과음 슬라이더 0 → 효과음 게인 0(끄기)', v.sfxGain === 0, JSON.stringify(v));
  await setRange('.rcw-side-right [data-volume=sfx]', 80);
  await page.ev(`document.querySelector('.rcw-side-right [data-mute]').click()`);
  await sleep(100);
  v = await page.ev(`window.__rcwPlay.volumes()`);
  check('음소거 → 음악·효과음 게인 0', v.muted && v.musicGain === 0 && v.sfxGain === 0, JSON.stringify(v));
  await page.ev(`document.querySelector('.rcw-side-right [data-mute]').click()`);
  await sleep(100);
  v = await page.ev(`window.__rcwPlay.volumes()`);
  check('음소거를 풀면 이전 값으로 돌아간다(음악 50 → 0.25)', !v.muted && Math.abs(v.musicGain - 0.25) < 1e-6 && v.sfxGain > 0, JSON.stringify(v));
  // ---- 일시정지 시트에서 판정 설정 바꾸기: 도중에는 적용되지 않는다
  await page.key('Escape');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'paused'`), 5000, '일시정지');
  await sleep(300);
  await shot('pc_pause');
  const fit = await page.ev(`(() => [...document.querySelectorAll('.rcw-play .pl-pause-dialog .pl-buttons button')].map((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }))()`);
  check('PC 일시정지 시트: 이어하기·처음부터 다시·나가기 버튼이 모두 화면 안에 보인다', fit.length === 3 && fit.every(Boolean), JSON.stringify(fit));
  await setRange('.pl-pause-dialog [data-volume=music]', 90);
  await sleep(100);
  v = await page.ev(`window.__rcwPlay.volumes()`);
  check('일시정지 시트 볼륨도 바로 적용(음악 90 → 0.81)', Math.abs(v.musicGain - 0.81) < 1e-6, JSON.stringify(v));
  check('옆 패널 슬라이더도 같은 값으로 따라온다', (await page.ev(`document.querySelector('.rcw-side-right [data-volume=music]').value`)) === '90');
  await page.ev(`document.querySelector('.pl-pause-dialog details.pl-judge').open = true`);
  await page.ev(`document.querySelector('.pl-pause-dialog [data-preset=loose]').click()`);
  check('일시정지 중 판정 설정을 바꿔도 이번 판 판정은 그대로(엄격 30ms)', (await page.ev(`window.__rcwPlay.activeJudge().perfectMs`)) === 30);
  await shot('pc_pause_judge');
  await clickText('이어하기');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'playing'`), 15000, '이어하기 뒤 재생');
  check('이어하기 뒤에도 볼륨 유지(0.81)·판정은 여전히 엄격', Math.abs((await page.ev(`window.__rcwPlay.volumes().musicGain`)) - 0.81) < 1e-6 && (await page.ev(`window.__rcwPlay.activeJudge().perfectMs`)) === 30);
  // ---- 옆 패널 [판정 설정] 버튼 → 일시정지 + 판정 설정 펼침
  await clickText('판정 설정', '.rcw-side-right');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'paused'`), 5000, '판정 설정 버튼 → 일시정지');
  check('옆 패널 [판정 설정]이 일시정지 시트의 판정 설정을 펼쳐 연다', await page.ev(`document.querySelector('.pl-pause-dialog details.pl-judge').open`));
  // ---- 처음부터 다시 → 새 판정 설정 적용
  await clickText('처음부터 다시');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'countdown'`), 10000, '처음부터 다시');
  check('[처음부터 다시]부터 새 판정 설정(넉넉하게 60ms) 적용', (await page.ev(`window.__rcwPlay.activeJudge().perfectMs`)) === 60);
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'playing'`), 15000, '재생');
  const n = await page.ev(`window.__auto()`);
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'cleared' || window.__rcwPlay.phase() === 'failed'`), 120000, `끝까지 자동 플레이(${n}건 입력)`);
  await page.ev(`window.__autoStop()`);
  await sleep(500);
  const note = await page.ev(`(document.querySelector('.rcw-play .pl-judge-note') || {}).textContent || ''`);
  check('결과 화면 맨 위에 "판정 설정: 넉넉하게 (PERFECT ±60ms …)" 표시', /^판정 설정: 넉넉하게 \(PERFECT ±60ms · GREAT ±120ms · GOOD ±180ms · BAD ±240ms/.test(note), note);
  await shot('pc_result');
  // 결과 화면 [다시하기] 뒤에도 볼륨 유지
  await clickText('다시하기');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'countdown'`), 10000, '다시하기');
  check('결과 → 다시하기 뒤에도 볼륨 값 유지', (await page.ev(`window.__rcwPlay.volumes().music`)) === 90);
  // 기본값일 때는 결과에 표시하지 않는다
  await page.key('Escape');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'paused'`), 5000);
  await page.ev(`document.querySelector('.pl-pause-dialog [data-judge-reset]').click()`);
  await clickText('처음부터 다시');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'playing'`), 15000, '재생');
  await page.ev(`window.__auto()`);
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'cleared' || window.__rcwPlay.phase() === 'failed'`), 120000, '끝까지 자동 플레이 2');
  await page.ev(`window.__autoStop()`);
  await sleep(400);
  check('원본 기본 판정이면 결과에 "판정 설정" 문구가 없다', (await page.ev(`!document.querySelector('.rcw-play .pl-judge-note')`)));
  await clickText('편집기로');
  await page.waitFor(`!document.querySelector('.rcw-play')`, 10000, '편집기 복귀');

  // ============================================================ 폰 390x844: 시작 창·일시정지·결과 육안 확인용 스크린샷
  await page.resize(390, 844, { touch: true, dpr: 2 });
  await sleep(500);
  await page.ev(`document.getElementById('btnPlayTest').click()`);
  await page.waitFor(`document.querySelector('.rcw-play .pl-start')`, 30000, '폰 시작 창');
  await sleep(400);
  await page.ev(`(() => { const t = document.querySelector('.pl-start .pl-dialog-text'); t.textContent = '가나다라마바사아자차카타파하'.repeat(6) + ' · NORMAL · 노트 47개'; })()`);
  const pover = await page.ev(`(() => { const d = document.querySelector('.rcw-play .pl-start'); const t = d.querySelector('.pl-dialog-text'); return { dw: d.scrollWidth, dc: d.clientWidth, right: t.getBoundingClientRect().right, dr: d.getBoundingClientRect().right, ow: innerWidth, sw: document.documentElement.scrollWidth }; })()`);
  check('폰: 긴 곡 이름이 시작 창 밖으로 넘치지 않는다', pover.dw <= pover.dc + 1 && pover.right <= pover.dr + 1 && pover.sw <= pover.ow + 1, JSON.stringify(pover));
  await shot('phone_start');
  const small = await page.ev(`(() => [...document.querySelectorAll('.rcw-play .pl-start button, .rcw-play .pl-start input[type=range], .rcw-play .pl-start summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.height < 43.5 || r.width < 43.5) && !e.closest('details:not([open])') ; }).map((e) => e.textContent.trim().slice(0, 10) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)))()`);
  check('폰: 시작 창의 버튼·슬라이더·요약이 모두 44px 이상', small.length === 0, JSON.stringify(small));
  await page.ev(`document.querySelector('.pl-start details.pl-judge').open = true`);
  await sleep(300);
  await page.ev(`document.querySelector('.rcw-play .pl-overlay').scrollTop = 400`);
  await sleep(200);
  await shot('phone_start_judge');
  await page.ev(`document.querySelector('.pl-start details.pl-judge').open = false`);
  await page.ev(`document.querySelector('.pl-start [data-rate="1.25"]').click()`);
  await clickText('시작');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'playing'`), 20000, '폰 재생');
  await page.ev(`window.__rcwPlay.pause()`);
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'paused'`), 5000);
  await sleep(300);
  await shot('phone_pause');
  const pfit = await page.ev(`(() => [...document.querySelectorAll('.rcw-play .pl-pause-dialog .pl-buttons button')].map((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }))()`);
  check('폰 일시정지 시트: 세 버튼이 화면 안에 보인다(또는 스크롤로 닿는다)', pfit.length === 3);
  await setRange('.pl-pause-dialog [data-volume=music]', 40);
  check('폰 일시정지 시트 볼륨 즉시 적용', Math.abs((await page.ev(`window.__rcwPlay.volumes().musicGain`)) - 0.16) < 1e-6);
  await clickText('이어하기');
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'playing'`), 15000);
  await page.ev(`window.__auto()`);
  await page.waitFor(PLAY(`window.__rcwPlay.phase() === 'cleared' || window.__rcwPlay.phase() === 'failed'`), 120000, '폰 끝까지');
  await page.ev(`window.__autoStop()`);
  await sleep(400);
  await shot('phone_result');
  const pbtn = await page.ev(`[...document.querySelectorAll('.rcw-play .pl-buttons .btn')].map((b) => b.scrollHeight - b.clientHeight)`);
  check('폰 결과 화면 버튼 글자가 잘리지 않는다', pbtn.every((d) => d <= 1), JSON.stringify(pbtn));
  await clickText('편집기로');
  await page.waitFor(`!document.querySelector('.rcw-play')`, 10000);
} catch (e) {
  check('스모크 테스트 진행 중 예외', false, e.message);
}
check('콘솔 오류 0건', page.errors.length === 0, page.errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok).length;
writeFileSync(join(root, 'log', 'smoke04b_result.json'), JSON.stringify({ ranAt: new Date().toISOString(), total: results.length, failed, results }, null, 2));
console.log(`\n합계 ${results.length}개 중 실패 ${failed}개`);
chrome.kill();
app.server.close();
process.exit(failed ? 1 : 0);
