// [테스트] 팝업: 현재 채보를 낙하 미리보기로 보며 키보드(설정 가능) 또는 화면 터치로 판정해 본다. 메인 화면과 독립적으로 동작한다.
// 판정에만 입력 지연 보정을 적용한다. 채보 데이터·내보내기 시각은 바꾸지 않는다.
import { api } from '../../app/localApi.js';
import { AudioEngine } from './audio.js';
import { isLong, noteEnd } from './edit_rules.js';
import { judgeBurst, judgeHold, judgeTap } from './judge_rules.js';
import { COLORS, drawBurst, drawHold, drawTap } from './shapes.js';
import { theme } from './theme.js';
import { initThemeMode } from './theme_mode.js';
import { BpmMap } from './timing.js';
import {
  DEFAULT_SETTINGS, HIST_RANGE, MEASURE_BEATS, MEASURE_BPM, PRACTICE_BEATS, clampLatency, clampLead, clampVolume, errorStats, estimateLatency, judgeLabel, keyLabel, laneForCode, pairPresses, sanitizeSettings, laneOfRelativeX, suggestLatency, validateKey,
} from './test_rules.js';
import { adjustTimeRate, clampRate, countedItems, excludeInProgress, excludeUnfinished, rateNotice, scaleCfg, toRealMs, usableForLatency } from './test_control.js';
import { barStartTick, beatMsAt, buildMissList, countIn, itemsFrom, resolveStart } from './test_start.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const audio = new AudioEngine();
let cfg = null;
let allItems = []; // 채보의 모든 노트
let items = [];    // 이번 테스트 대상 노트 {note, startMs, endMs, state, ...} (시작 위치 앞의 노트는 빠진다)
let map = null;
let counting = false; // 시작 전 카운트인 중
let paused = false;   // 일시정지 중
let resuming = false; // 이어하기 카운트인 중
let resumeToken = 0;  // 이어하기를 취소하면 올린다
let rate = 1;         // 재생 속도 (저장하지 않음, 매번 1.0 배로 시작)
let usedRates = new Set(); // 이번 테스트에서 쓴 속도들
let session = false;  // 시작해서 아직 끝나지 않은 테스트
let held = [false, false, false, false];
let km = 2; // 열린 채보의 키 모드 (2 | 4). 4키는 S D K L 고정, 화면 4등분
let stats = null;
let running = false;
let ready = false;    // 음원·설정을 모두 불러와 시작할 수 있는 상태
let starting = false; // [시작]을 누른 뒤 음악이 실제로 나오기 시작할 때까지 (그 사이 또 눌러도 무시)
let settings = { ...DEFAULT_SETTINGS }; // 사용자 설정 (서버 config 폴더의 user_settings.json 에 저장)
let capturing = null;                   // 키 바꾸기 중이면 'left' / 'right'
let measuring = null;                   // 지연 측정 중이면 {beats:[ms], presses:[ms]}
let measureResult = null;
let outputLatencyMs = null;
const leadMs = () => settings.lead_ms; // 노트가 화면 위에서 판정선까지 내려오는 시간
const adj = (p) => adjustTimeRate(p, settings.latency_ms, rate); // 입력 지연 보정은 실제 시간 기준
const jcfg = () => scaleCfg(cfg, rate); // 판정 폭도 실제 시간 기준 → 곡 시간으로 환산해 비교

function fail(text) {
  $('judgeText').textContent = text;
}

// 메인 화면의 현재 채보를 받아 온다 (저장하지 않은 상태 그대로)
async function init() {
  initThemeMode(); // 메인과 같은 화면 모드로 열리고, 메인에서 바꾸면 함께 바뀐다(storage 이벤트)
  const data = window.opener && window.opener.__getTestData ? window.opener.__getTestData() : null;
  if (!data) return fail('메인 화면에서 [테스트] 버튼으로 열어 주세요.');
  $('judgeText').textContent = '곡을 불러오는 중입니다… (끝나면 [시작]이 켜집니다)';
  try {
    cfg = (await api.config()).judge; // 판정 폭은 서버 설정(config/judge.json)을 사용
    await loadSettings();
    km = data.chart.keyMode === 4 ? 4 : 2;
    map = new BpmMap(data.chart.timing.bpm_map, data.chart.song.audio_offset_ms || 0);
    allItems = data.chart.difficulties[data.diffIndex].notes.map((n) => ({
      note: n, startMs: map.tickToAudioMs(n.tick), endMs: map.tickToAudioMs(noteEnd(n)), state: 'wait', presses: [],
    })).sort((a, b) => a.startMs - b.startMs);
    items = allItems;
    if (data.startMode) $('startMode').value = data.startMode; // 메인의 [여기서부터 테스트]로 열린 경우
    await audio.load(data.audioUrl);
    readOutputLatency();
    renderSettings();
    renderRate();
    audio.setVolume(settings.volume / 100);
    ready = true;
    $('startBtn').textContent = '시작';
    syncControls();
    $('judgeText').textContent = `노트 ${allItems.length}개 · 시작을 누르세요`;
  } catch (e) {
    $('startBtn').textContent = '시작할 수 없음';
    fail(e.message);
  }
  resize();
  requestAnimationFrame(frame);
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 메인 화면이 알려 주는 현재 재생 위치·선택한 노트 (연결이 없으면 null)
function mainHints() {
  try {
    return window.opener && !window.opener.closed && window.opener.__getTestHints ? window.opener.__getTestHints() : null;
  } catch (e) {
    return null;
  }
}

// [시작]: 준비가 안 됐거나 이미 시작 중이면 무시하고(버튼도 잠김), 한 번 누르면 항상 한 번만 시작한다
async function start() {
  if (!ready) return msg('곡을 아직 불러오는 중입니다. 잠시 뒤에 눌러 주세요.');
  if (starting) return;
  starting = true;
  syncControls();
  try {
    await startInner();
  } catch (e) {
    running = false;
    counting = false;
    msg('시작하지 못했습니다: ' + e.message);
    fail('시작하지 못했습니다. 다시 눌러 주세요.');
  } finally {
    starting = false;
    syncControls();
  }
}

async function startInner() {
  if (!allItems.length) return fail('노트가 없습니다.');
  if (!audio.buffer) return fail('음원을 불러오지 못했습니다. 테스트 창을 닫고 다시 열어 주세요.');
  if (measuring || counting || resuming) return;
  const st = resolveStart({ mode: $('startMode').value, hints: mainHints(), bar: Number($('startBar').value), map });
  if (!st.ok) { msg(st.reason); return fail(st.reason); }
  items = st.full ? allItems : itemsFrom(allItems, st.ms); // 시작 위치 앞의 노트(걸쳐 있는 롱노트·연타 포함)는 나오지 않고 집계에도 넣지 않는다
  if (!items.length) { msg('시작 위치 뒤에 노트가 없습니다. 더 앞쪽을 골라 주세요.'); return fail('시작 위치 뒤에 노트가 없습니다.'); }
  for (const it of items) { it.state = 'wait'; it.presses = []; it.grade = null; }
  stats = { perfect: 0, great: 0, good: 0, clear: 0, miss: 0, combo: 0, maxCombo: 0, diffs: [], misses: [] };
  held = [false, false, false, false];
  running = false;
  paused = false;
  const tok = ++resumeToken; // 카운트인 중에 [중지]·[처음부터 다시]를 누르면 올라가서, 늦게 도착한 시작을 취소한다
  session = true;
  usedRates = new Set([rate]);
  audio.rate = rate;
  $('pauseBox').hidden = true;
  $('result').hidden = true;
  $('combo').textContent = '콤보 0';
  msg('');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // 설정 칸에 글자가 들어가지 않게
  if (st.full) {
    await audio.play(Math.max(0, items[0].startMs - 2000));
    running = true;
    showJudge('시작!');
    syncControls();
    return;
  }
  // 중간부터: 박자 소리 카운트인(2~3초) 뒤에 그 위치부터 음악을 재생한다
  audio.pause();
  await audio.seek(st.ms);
  await audio.ensureContext();
  const c = audio.ctx;
  const beatMs = beatMsAt(map, st.ms) / rate; // 카운트인 박자 소리는 실제 시간(속도에 맞춰 느려짐)
  const ci = countIn(beatMs);
  const t0 = c.currentTime + 0.15;
  for (let k = 0; k < ci.beats; k++) audio.tone(t0 + (k * beatMs) / 1000, 'triangle', k === 0 ? 1760 : 1100, k === 0 ? 0.5 : 0.35, 0.05);
  counting = true;
  syncControls();
  showJudge(`준비… (박자 소리 ${ci.beats}번 뒤 시작)`);
  const wait = (t0 + (ci.beats * beatMs) / 1000 - c.currentTime) * 1000 - 30;
  await new Promise((ok) => setTimeout(ok, Math.max(0, wait)));
  if (tok !== resumeToken) { counting = false; return; }
  await audio.play(st.ms);
  if (tok !== resumeToken) { audio.pause(); counting = false; return; }
  counting = false;
  running = true;
  showJudge('시작!');
  syncControls();
}

// 판정 결과를 집계한다
function record(it, res) {
  it.state = 'done';
  it.grade = res.result;
  stats[res.result]++;
  if (res.diff !== undefined) res.diff = toRealMs(res.diff, rate); // 곡 시간 오차 → 실제 오차
  if (res.diff !== undefined) stats.diffs.push(res.diff);
  if (res.result === 'miss') stats.misses.push({ id: it.note.id, type: it.note.type, tick: it.note.tick, startMs: it.startMs });
  if (res.success) {
    stats.combo++;
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
  } else {
    stats.combo = 0;
  }
  const label = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', clear: 'CLEAR', miss: 'MISS' }[res.result];
  showJudge(judgeLabel(label, res.diff, settings.show_diff));
  $('combo').textContent = `콤보 ${stats.combo}`;
}

function showJudge(text) {
  $('judgeText').textContent = text;
  const j = $('judgeText');
  j.classList.toggle('j-miss', text.startsWith('MISS'));
  j.classList.toggle('j-perfect', text.startsWith('PERFECT'));
  j.classList.toggle('j-auto', text.includes('자동으로 멈췄습니다'));
}

// 키·터치를 눌렀을 때
function press(lane) {
  if (measuring) return measurePress();
  if (!running || held[lane]) return;
  held[lane] = true;
  const pos = adj(audio.position); // 누른 시각 − 보정값
  // 연타노트는 양쪽 레인 노트: 구간 안에서는 양쪽 키 어느 쪽을 눌러도 횟수가 올라간다
  const burst = items.find((it) => it.note.type === 'burst' && it.state !== 'done' && pos >= it.startMs && pos <= it.endMs);
  if (burst) { burst.state = 'active'; burst.presses.push(pos); return; }
  const cand = items.filter((it) => it.note.type !== 'burst' && it.note.lane === lane && it.state === 'wait' && Math.abs(it.startMs - pos) <= jcfg().good_ms)
    .sort((a, b) => Math.abs(a.startMs - pos) - Math.abs(b.startMs - pos))[0];
  if (!cand) return;
  const n = cand.note;
  if (n.type === 'tap') record(cand, judgeTap(cand.startMs, pos, jcfg()));
  else { cand.state = 'active'; cand.pressMs = pos; }
}

// 키·터치를 뗐을 때: 롱노트 중간 이탈은 miss
function release(lane) {
  held[lane] = false;
  if (!running) return;
  const pos = adj(audio.position); // 뗀 시각도 같은 보정
  const hold = items.find((it) => it.note.lane === lane && it.note.type === 'hold' && it.state === 'active');
  if (hold) record(hold, judgeHold(hold.startMs, hold.endMs - hold.startMs, hold.pressMs, pos, jcfg()));
}

// 지나간 노트를 자동으로 마무리한다 (pos = 보정한 현재 위치)
function update(pos) {
  for (const it of items) {
    if (it.state === 'done') continue;
    const n = it.note;
    if (it.state === 'wait' && n.type !== 'burst' && pos > it.startMs + jcfg().good_ms) record(it, { result: 'miss', success: false });
    else if (it.state === 'active' && n.type === 'hold' && pos >= it.endMs) {
      record(it, judgeHold(it.startMs, it.endMs - it.startMs, it.pressMs, held[n.lane] ? null : pos, jcfg())); // 끝까지 누르고 있으면 자동 성공
    } else if (it.state === 'active' && n.type === 'burst' && pos > it.endMs) {
      record(it, judgeBurst(it.startMs, it.endMs - it.startMs, it.presses, n.count));
    }
  }
  // 연타노트를 한 번도 누르지 못한 경우: 구간이 끝나면 실패
  for (const it of items) {
    if (it.state === 'wait' && it.note.type === 'burst' && pos > it.endMs) record(it, judgeBurst(it.startMs, it.endMs - it.startMs, it.presses, it.note.count));
  }
  if (running && items.every((it) => it.state === 'done')) finish();
}

// 결과 화면: 등급 집계·콤보 + 평균 오차·빠름/느림 비율·오차 분포·보정 제안
function finish() {
  running = false;
  paused = false;
  session = false;
  $('pauseBox').hidden = true;
  audio.pause();
  syncControls();
  const total = countedItems(items).length;
  const ok = total - stats.miss;
  const box = $('result');
  box.hidden = false;
  box.replaceChildren();
  const add = (text) => {
    const d = document.createElement('div');
    d.className = 'line';
    d.textContent = text;
    box.appendChild(d);
    return d;
  };
  const notice = rateNotice(usedRates);
  if (notice) add(notice).id = 'resRate';
  add('결과');
  add(`PERFECT ${stats.perfect} · GREAT ${stats.great} · GOOD ${stats.good} · CLEAR(연타) ${stats.clear} · MISS ${stats.miss}`);
  add(`최대 콤보 ${stats.maxCombo} · 성공률 ${total ? Math.round((100 * ok) / total) : 0}%`);
  const st = errorStats(stats.diffs);
  if (st.count) {
    const mean = Math.round(st.mean);
    const sign = mean > 0 ? '+' : mean < 0 ? '−' : '';
    add(`평균 오차 ${sign}${Math.abs(mean)}ms (${mean < 0 ? '전체적으로 빠름' : mean > 0 ? '전체적으로 느림' : '정확함'}) · 빠름 ${st.fastPct}% / 느림 ${st.slowPct}% (${st.count}개 기준)`).id = 'resMean';
    const hist = document.createElement('div');
    hist.className = 'hist';
    hist.id = 'resHist';
    const max = Math.max(...st.bins, 1);
    const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v)}`;
    st.bins.forEach((n, i) => {
      const lo = -HIST_RANGE + i * st.binWidth;
      const name = document.createElement('span');
      name.textContent = `${fmt(lo)}~${fmt(lo + st.binWidth)}`;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.width = `${Math.round((100 * n) / max)}%`;
      const cnt = document.createElement('span');
      cnt.textContent = String(n);
      hist.append(name, bar, cnt);
    });
    box.appendChild(hist);
    const rec = usableForLatency(usedRates) ? suggestLatency(st, settings.latency_ms) : null;
    if (!usableForLatency(usedRates)) add('1배 속도가 아니어서 입력 지연 보정 권장값은 계산하지 않습니다.').id = 'resNoSuggest';
    if (rec !== null) {
      const row = add(`평균 오차가 큰 편입니다. 입력 지연 보정을 ${rec > 0 ? '+' : ''}${rec}ms 로 바꿔 보세요. `);
      row.id = 'resSuggest';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sm primary';
      btn.id = 'btnApplyRec';
      btn.textContent = '권장값 적용';
      btn.addEventListener('click', () => { setLatency(rec, '권장값을 적용했습니다. 다시 시작해서 확인해 보세요.'); btn.disabled = true; });
      row.appendChild(btn);
    }
  } else {
    add('오차를 계산할 판정이 없습니다.');
  }
  renderMissList(box, add);
  $('startBtn').textContent = '다시 시작';
}

// MISS 노트 목록: "12마디 3박 · 연타". 클릭하면 메인 편집기가 그 노트로 이동·선택한다 (메인 화면과 연결이 없으면 목록만 보인다)
function renderMissList(box, add) {
  const list = buildMissList(stats.misses, map);
  if (!list.entries.length) return;
  const linked = (() => { try { return !!(window.opener && !window.opener.closed && window.opener.__focusNote); } catch (e) { return false; } })();
  add(`MISS 노트 ${stats.misses.length}개${linked ? ' (클릭하면 메인 편집기에서 그 노트로 이동합니다)' : ''}`).id = 'missTitle';
  if (list.summary) add(list.summary.text).id = 'missSummary';
  const ul = document.createElement('ul');
  ul.className = 'misslist';
  ul.id = 'missList';
  for (const e of list.entries) {
    const li = document.createElement('li');
    li.textContent = e.label;
    li.dataset.id = String(e.id);
    if (linked) {
      li.className = 'link';
      li.addEventListener('click', () => { try { window.opener.__focusNote(e.id); } catch (err) { msg('메인 화면과 연결할 수 없습니다.'); } });
    }
    ul.appendChild(li);
  }
  if (list.extra > 0) {
    const li = document.createElement('li');
    li.textContent = `외 ${list.extra}개`;
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

// ----- 멈춤 · 이어하기 · 중지 -----

// 버튼 상태를 지금 상황에 맞춘다
function syncControls() {
  $('pauseBtn').disabled = !(running || resuming);
  const idle = !running && !counting && !resuming; // 속도는 시작 전·일시정지 중에만 바꿀 수 있다
  for (const b of document.querySelectorAll('.rate')) b.disabled = !(idle || paused);
  $('rateNum').disabled = !(idle || paused);
  $('startBtn').disabled = !ready || starting || running || counting || resuming || paused;
}

// 일시정지: 곡 위치를 그대로 저장하고 시계·낙하·판정을 멈춘다. reason = 자동으로 멈춘 이유(없으면 직접 누름)
function pauseTest(reason) {
  if (resuming) { // 이어하기 카운트인 중이면 취소하고 다시 멈춤 상태로
    resumeToken++;
    resuming = false;
    audio.cancelScheduled();
    audio.pause();
    showJudge(reason || '일시정지');
    syncControls();
    return;
  }
  if (!running) return;
  running = false;
  paused = true;
  held = [false, false];
  audio.pause(); // 이 순간의 곡 위치가 pausedPos 에 저장된다
  const dropped = excludeInProgress(items, adj(audio.pausedPos)); // 진행 중이던 롱노트·연타는 결과에서 제외
  showJudge(reason || '일시정지');
  $('pauseText').textContent = `${reason ? reason + ' ' : ''}일시정지 중입니다. 설정을 바꿀 수 있습니다. (Esc 로도 이어하기)${dropped ? ` 진행 중이던 롱노트·연타 ${dropped}개는 결과에서 빠집니다.` : ''}`;
  $('pauseBox').hidden = false;
  syncControls();
}

// 이어하기: 박자 소리 카운트인(2~3초) 뒤 저장해 둔 곡 위치에서 다시 시작한다. 그동안 입력은 무시한다.
async function resumeTest() {
  if (!paused || resuming) return;
  resuming = true;
  const tok = ++resumeToken;
  const at = audio.pausedPos;
  audio.rate = rate;
  usedRates.add(rate);
  await audio.ensureContext();
  const c = audio.ctx;
  const beatMs = beatMsAt(map, at) / rate;
  const ci = countIn(beatMs);
  const t0 = c.currentTime + 0.15;
  for (let k = 0; k < ci.beats; k++) audio.tone(t0 + (k * beatMs) / 1000, 'triangle', k === 0 ? 1760 : 1100, k === 0 ? 0.5 : 0.35, 0.05);
  showJudge(`준비… (박자 소리 ${ci.beats}번 뒤 이어서 시작)`);
  syncControls();
  const wait = (t0 + (ci.beats * beatMs) / 1000 - c.currentTime) * 1000 - 30;
  await new Promise((ok) => setTimeout(ok, Math.max(0, wait)));
  if (tok !== resumeToken) return; // 그 사이 다시 멈추거나 끝냈다
  await audio.play(at);
  resuming = false;
  paused = false;
  held = [false, false];
  running = true;
  $('pauseBox').hidden = true;
  showJudge('이어서 시작!');
  syncControls();
}

// 중지(끝내기): 결과 화면을 보거나 그냥 닫는다. 결과는 지나간 노트만 집계한다.
function stopTest() {
  if (!session) return;
  const show = $('stopShowResult').checked;
  resumeToken++;
  resuming = false;
  counting = false;
  running = false;
  paused = false;
  audio.cancelScheduled();
  audio.pause();
  excludeUnfinished(items); // 안 나온 노트·진행 중이던 노트는 집계에서 제외
  $('pauseBox').hidden = true;
  if (show && countedItems(items).length) {
    finish();
    const first = $('result').firstChild;
    const d = document.createElement('div');
    d.className = 'line';
    d.textContent = '중지해서 지나간 구간만 집계했습니다.';
    $('result').insertBefore(d, first);
  } else {
    session = false;
    showJudge(show ? '지나간 노트가 없어 결과가 없습니다.' : '중지했습니다.');
    syncControls();
  }
  $('startBtn').textContent = '다시 시작';
}

// 속도를 바꾼다 (시작 전·일시정지 중에만)
function setRate(raw) {
  if (running || counting || resuming) return msg('테스트 중에는 속도를 바꿀 수 없습니다. 일시정지 후 바꿔 주세요.');
  const c = clampRate(raw, rate);
  rate = c.value;
  audio.rate = rate;
  renderRate();
  msg(c.note);
}

function renderRate() {
  $('rateNum').value = rate;
  for (const b of document.querySelectorAll('.rate')) b.classList.toggle('on', Number(b.dataset.rate) === rate);
}

// 화면이 가려지거나 다른 창을 누르면 자동으로 멈춘다 (체크로 끌 수 있음)
function autoPause() {
  if (!$('autoPause').checked) return;
  if (running || resuming) pauseTest('자동으로 멈췄습니다.');
}

// 낙하 그리기 (Canvas, 모니터 주사율)
function frame() {
  const r = canvas.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  const pos = audio.position;
  if (running) update(adj(pos));
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  const laneW = w / km;
  const lineY = h - 90;
  const yOf = (ms) => lineY - ((ms - pos) / leadMs()) * (lineY - 10);
  for (let l = 0; l < km; l++) {
    ctx.fillStyle = held[l] ? theme.laneHeld : l % 2 ? COLORS.laneB : COLORS.laneA;
    ctx.fillRect(l * laneW, 0, laneW - 1, h);
  }
  for (const it of items) {
    if (it.state === 'done' && it.grade !== 'miss' && !isLong(it.note)) continue;
    if (it.endMs < pos - 300 || it.startMs > pos + leadMs()) continue;
    const n = it.note;
    const cx = n.type === 'burst' ? w / 2 : laneW * (n.lane + 0.5); // 연타노트는 판정선 폭 전체
    const y0 = yOf(it.startMs);
    const y1 = yOf(it.endMs);
    ctx.globalAlpha = it.state === 'done' ? 0.35 : 1;
    if (n.type === 'tap') drawTap(ctx, cx, y0, Math.min(16, laneW * 0.1), false);
    else if (n.type === 'hold') drawHold(ctx, cx, y0, y1, laneW * 0.5, false);
    else drawBurst(ctx, cx, y0, y1, w - 16, Math.max(0, n.count - it.presses.length), false); // 숫자 = 남은 횟수
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = theme.playhead;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, lineY);
  ctx.lineTo(w, lineY);
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.font = theme.font(12);
  ctx.textAlign = 'center';
  if (km === 4) {
    ['S', 'D', 'K', 'L'].forEach((label, l) => ctx.fillText(`${l + 1}레인 (${label})`, laneW * (l + 0.5), h - 20));
  } else {
    ctx.fillText(`왼쪽 (${keyLabel(settings.key_left)})`, laneW * 0.5, h - 20);
    ctx.fillText(`오른쪽 (${keyLabel(settings.key_right)})`, laneW * 1.5, h - 20);
  }
  requestAnimationFrame(frame);
}

// ----- 설정 (입력 지연 보정, 키, 표시) -----

function msg(text) {
  $('settingsMsg').textContent = text || '';
}

// 안내 문구·키 표시를 설정에 맞춘다
function renderSettings() {
  const l = keyLabel(settings.key_left);
  const r = keyLabel(settings.key_right);
  $('keyLeft').textContent = capturing === 'left' ? '…' : l;
  $('keyRight').textContent = capturing === 'right' ? '…' : r;
  $('keyLeft').classList.toggle('wait', capturing === 'left');
  $('keyRight').classList.toggle('wait', capturing === 'right');
  $('btnKeyLeft').textContent = capturing === 'left' ? '원하는 키를 누르세요' : '키 바꾸기';
  $('btnKeyRight').textContent = capturing === 'right' ? '원하는 키를 누르세요' : '키 바꾸기';
  $('latNum').value = settings.latency_ms;
  $('latRange').value = settings.latency_ms;
  $('showDiff').checked = settings.show_diff;
  $('volRange').value = settings.volume;
  $('volVal').textContent = settings.volume;
  $('leadRange').value = settings.lead_ms;
  $('leadVal').textContent = settings.lead_ms;
  $('help').textContent = km === 4 ? '4키 채보입니다. 키보드 S D K L (왼쪽부터 1~4레인) 또는 화면을 4등분해서 누르세요. 같은 시각에 노트가 2개 나올 수 있으니 두 키를 함께 누르세요. 롱노트는 끝까지 누르고 있으세요. 연타노트(넓은 주황 막대)는 4개 키 어느 쪽이든 눌러서 횟수를 채우세요. (4키의 키 배치는 바꿀 수 없습니다)' : `키보드 ${l}(왼쪽) · ${r}(오른쪽) 또는 화면 왼쪽/오른쪽을 누르세요. 롱노트는 끝까지 누르고 있으세요. 연타노트(넓은 주황 막대)는 양쪽 키 어느 쪽이든 눌러서 숫자(남은 횟수)를 0으로 만드세요.`;
  const est = outputLatencyMs;
  $('outLatency').textContent = est === null ? '이 컴퓨터의 소리 출력 지연을 알 수 없습니다. [지연 측정]을 이용해 주세요.' : `이 컴퓨터의 소리 출력 지연 약 ${est}ms (참고용, 자동 적용되지 않습니다)`;
  $('btnApplyEst').hidden = est === null;
}

async function loadSettings() {
  try {
    const res = await api.userSettings();
    const clean = sanitizeSettings(res.settings);
    settings = clean.settings;
    const notes = [...(res.notes || []), ...clean.notes];
    if (notes.length) msg(notes.join(' '));
  } catch (e) {
    settings = { ...DEFAULT_SETTINGS };
    msg('설정을 불러오지 못해 기본값으로 시작합니다.');
  }
  readOutputLatency();
  renderSettings();
}

// 브라우저가 알려 주는 소리 출력 지연 (없으면 null)
function readOutputLatency() {
  const c = audio.ctx;
  const sec = c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
  outputLatencyMs = sec > 0 ? Math.round(sec * 1000) : null;
}

// 바꾼 항목만 서버에 저장한다 (저장에 실패해도 이번 테스트에는 적용된다)
async function saveSettings(patch) {
  try {
    const res = await api.saveUserSettings(patch);
    settings = sanitizeSettings(res.settings).settings;
    if (res.notes && res.notes.length) msg(res.notes.join(' '));
    renderSettings();
    return true;
  } catch (e) {
    msg(e.message);
    return false;
  }
}

async function setLatency(value, okText) {
  const c = clampLatency(value);
  settings.latency_ms = c.value;
  renderSettings();
  await saveSettings({ latency_ms: c.value });
  msg(c.clamped ? `−500~+500ms 범위만 쓸 수 있어 가까운 값(${c.value})으로 맞췄습니다.` : okText || '');
}

function beginCapture(side) {
  if (running || measuring) return msg('테스트나 측정 중에는 키를 바꿀 수 없습니다.');
  capturing = capturing === side ? null : side;
  msg(capturing ? '원하는 키를 누르세요. (취소: Esc)' : '');
  renderSettings();
}

// 키 바꾸기 중에 눌린 키를 처리한다
async function captureKey(e) {
  e.preventDefault();
  if (e.code === 'Escape') {
    capturing = null;
    msg('키 바꾸기를 취소했습니다.');
    renderSettings();
    return;
  }
  const side = capturing;
  const other = side === 'left' ? settings.key_right : settings.key_left;
  const v = validateKey(e, other);
  if (!v.ok) { msg(v.reason); return; }
  capturing = null;
  const name = side === 'left' ? 'key_left' : 'key_right';
  settings[name] = e.code;
  renderSettings();
  if (await saveSettings({ [name]: e.code })) msg(`${side === 'left' ? '왼쪽' : '오른쪽'} 키를 ${keyLabel(e.code)} 로 바꿨습니다.`);
}

async function resetKeys() {
  capturing = null;
  settings.key_left = DEFAULT_SETTINGS.key_left;
  settings.key_right = DEFAULT_SETTINGS.key_right;
  renderSettings();
  if (await saveSettings({ key_left: DEFAULT_SETTINGS.key_left, key_right: DEFAULT_SETTINGS.key_right })) msg('키를 기본값(S/F)으로 되돌렸습니다.');
}

// ----- 지연 측정 -----

// 박자 소리를 MEASURE_BEATS 번 들려주고 키 입력을 모은다. 시간은 오디오 시계(게임 판정과 같은 기준)를 쓴다.
async function startMeasure() {
  if (running) return msg('테스트 중에는 측정할 수 없습니다.');
  if (measuring) return;
  capturing = null;
  renderSettings();
  await audio.ensureContext();
  const c = audio.ctx;
  const interval = 60 / MEASURE_BPM;
  const t0 = c.currentTime + 1.5;
  const beats = [];
  for (let i = 0; i < MEASURE_BEATS; i++) {
    const when = t0 + i * interval;
    beats.push(when * 1000);
    const strong = i % 4 === 0;
    audio.tone(when, 'triangle', strong ? 1760 : 1100, strong ? 0.5 : 0.3, 0.05);
  }
  measuring = { beats, presses: [] };
  measureResult = null;
  $('measureBox').hidden = false;
  $('btnMeasureApply').hidden = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const endMs = beats[beats.length - 1] + 700;
  const timer = setInterval(() => {
    if (!measuring) { clearInterval(timer); return; }
    const now = c.currentTime * 1000;
    const pastBeats = beats.filter((b) => b <= now).length;
    $('measureText').textContent = now < beats[0]
      ? '곧 박자 소리가 납니다. 소리에 맞춰 같은 박자로 키를 누르세요. (처음 4번은 연습이라 계산에서 빠집니다)'
      : `박자에 맞춰 누르세요 ${Math.min(pastBeats, MEASURE_BEATS)}/${MEASURE_BEATS} (입력 ${measuring.presses.length}회)`;
    if (now >= endMs) {
      clearInterval(timer);
      finishMeasure();
    }
  }, 100);
}

function measurePress() {
  if (measuring) measuring.presses.push(audio.ctx.currentTime * 1000);
}

function finishMeasure() {
  const m = measuring;
  measuring = null;
  const est = estimateLatency(pairPresses(m.beats, m.presses), PRACTICE_BEATS);
  measureResult = est;
  const text = $('measureText');
  if (!est.ok) {
    text.textContent = `입력이 너무 적어 계산하지 못했습니다 (쓸 수 있는 입력 ${est.used}개). 박자 소리에 맞춰 다시 해 주세요.`;
    return;
  }
  const sign = est.recommended > 0 ? '+' : '';
  text.textContent = `보정값 ${sign}${est.recommended}ms 를 권장합니다. (${est.used}회 기준${est.outliers ? `, 튀는 값 ${est.outliers}회 제외` : ''})`;
  $('btnMeasureApply').hidden = false;
}

// ----- 입력 연결 -----

$('startBtn').addEventListener('click', start);
$('pauseBtn').addEventListener('click', () => pauseTest());
$('resumeBtn').addEventListener('click', resumeTest);
$('restartBtn').addEventListener('click', () => { paused = false; resumeToken++; resuming = false; audio.pause(); syncControls(); start(); });
$('stopBtn').addEventListener('click', stopTest);
for (const b of document.querySelectorAll('.rate')) b.addEventListener('click', () => setRate(b.dataset.rate));
$('rateNum').addEventListener('change', () => setRate($('rateNum').value));
window.addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
window.addEventListener('resize', resize);
new ResizeObserver(() => resize()).observe(canvas); // 레이아웃이 바뀌어도 Canvas 해상도를 다시 맞춘다
const typingInField = (e) => e.target && e.target.tagName === 'INPUT' && e.target.type === 'number';
window.addEventListener('keydown', (e) => {
  if (capturing) { captureKey(e); return; }
  if (e.code === 'Escape' && !e.repeat) { if (paused) resumeTest(); else if (running) pauseTest(); return; } // Esc = 일시정지 / 이어하기 (레인 키로는 쓸 수 없는 키)
  if (e.repeat || typingInField(e)) return;
  const lane = laneForCode(e.code, settings, km);
  if (lane >= 0) press(lane);
});
window.addEventListener('keyup', (e) => {
  if (typingInField(e)) return;
  const lane = laneForCode(e.code, settings, km);
  if (lane >= 0) release(lane);
});
// 설정 칸 연결
$('latRange').addEventListener('input', () => { $('latNum').value = $('latRange').value; });
$('latRange').addEventListener('change', () => setLatency($('latRange').value));
$('latNum').addEventListener('change', () => setLatency($('latNum').value));
$('btnApplyEst').addEventListener('click', () => {
  readOutputLatency();
  if (outputLatencyMs !== null) setLatency(outputLatencyMs, `추정값 ${outputLatencyMs}ms 를 적용했습니다. 실제와 다를 수 있으니 [지연 측정]으로 확인해 보세요.`);
});
$('btnMeasure').addEventListener('click', startMeasure);
$('btnMeasureApply').addEventListener('click', () => {
  if (!measureResult || !measureResult.ok) return;
  setLatency(measureResult.recommended, `보정값 ${measureResult.recommended}ms 를 적용했습니다.`);
  $('btnMeasureApply').hidden = true;
});
$('btnKeyLeft').addEventListener('click', () => beginCapture('left'));
$('btnKeyRight').addEventListener('click', () => beginCapture('right'));
$('btnKeyReset').addEventListener('click', resetKeys);
$('startBar').addEventListener('input', () => { $('startMode').value = 'bar'; }); // 마디 숫자를 만지면 "마디 번호부터"로 바뀐다
$('showDiff').addEventListener('change', () => { settings.show_diff = $('showDiff').checked; saveSettings({ show_diff: settings.show_diff }); });
$('volRange').addEventListener('input', () => { settings.volume = clampVolume($('volRange').value); $('volVal').textContent = settings.volume; audio.setVolume(settings.volume / 100); });
$('volRange').addEventListener('change', () => saveSettings({ volume: settings.volume }));
$('leadRange').addEventListener('input', () => { settings.lead_ms = clampLead($('leadRange').value); $('leadVal').textContent = settings.lead_ms; });
$('leadRange').addEventListener('change', () => saveSettings({ lead_ms: settings.lead_ms }));
// 화면 터치/클릭: 2키는 왼쪽 절반 = 왼쪽 레인·오른쪽 절반 = 오른쪽 레인, 4키는 화면을 4등분
const pointerLane = new Map();
canvas.addEventListener('pointerdown', (e) => {
  const lane = laneOfRelativeX(e.offsetX / canvas.getBoundingClientRect().width, km); // 2키 절반, 4키 4등분
  pointerLane.set(e.pointerId, lane);
  canvas.setPointerCapture(e.pointerId);
  press(lane);
});
const up = (e) => {
  const lane = pointerLane.get(e.pointerId);
  pointerLane.delete(e.pointerId);
  if (lane !== undefined) release(lane);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
window.addEventListener('beforeunload', () => audio.stop());
// 자동 확인용: 화면 점검 도구가 박자 시각을 읽을 수 있게 한다 (사용자 기능 아님)
window.__testHook = { audio, rate: () => rate, state: () => ({ running, paused, resuming, counting }), stats: () => stats, pause: pauseTest, resume: resumeTest, measuring: () => measuring, settings: () => settings, items: () => items, allItems: () => allItems, barStartTick: (b) => barStartTick(map, b) };
init();
