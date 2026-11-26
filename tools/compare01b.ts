/**
 * 01b 비교 측정 도구(개발용): 모드 5개의 후보 시각을 서로 비교하고, 분석 시간을 재고, demucs 보컬 분석과 일치율을 낸다.
 * 입력(읽기만 함): 원본 분석 캐시 audio22k.npy(모노), 크롬에서 측정한 log\modes01b\m1~m4.json(스테레오 포함),
 *                 HitRus 의 demucs 보컬 onset(log\구조분석\vocal_onsets_*.json). 음원 파일은 복사하지 않는다.
 * 실행: node tools/compare01b.ts   → log\비교_01b.md 를 쓴다.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import { loadPresets } from '../src/core/config.ts';
import { matchOnsets, readNpyFloat32 } from './lib.ts';

const PROJ = 'D:/MusicNoteDesignProgram/projects';
const DEMUCS = 'D:/RhythmActionGame_HitRus/log/구조분석';
const OUT = 'D:/RhythmChartWeb/log/비교_01b.md';
const MODES = ['hybrid', 'bass', 'drums', 'melody', 'vocal'] as const;
const TOL = 50;
const SHIFT = 373; // 우연히 겹치는 정도를 재려고 한쪽을 옮겨 보는 값(ms)

interface Song {
  id: string;
  name: string;
}
// 곡은 원본 projects 폴더 이름 앞부분으로 찾는다
const SONGS: Song[] = [
  { id: 's1', name: 'Aiobahn' },
  { id: 's2', name: 'Earth' },
  { id: 's3', name: 'Snail' },
  { id: 's4', name: 'メズ' },
  { id: 's5', name: '煌舟' },
  { id: 's6', name: '떡상' },
];

const lines: string[] = [];
const out = (s = ''): void => {
  lines.push(s);
  console.log(s);
};

/** a 의 값 중 b 에 ±tol 안의 값이 있는 비율(a, b 는 오름차순). shift 는 a 를 옮겨 보는 값 */
function coverage(a: number[], b: number[], tol = TOL, shift = 0): number {
  if (!a.length) return 0;
  let j = 0;
  let hit = 0;
  for (const t of a) {
    const x = t + shift;
    while (j < b.length && b[j]! < x - tol) j++;
    if (j < b.length && Math.abs(b[j]! - x) <= tol) hit++;
  }
  return hit / a.length;
}
const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

out('# 01b 비교 측정 (분석 모드 5개: 종합·베이스·드럼·멜로디·보컬 근사)');
out('');
out('- 모든 모드는 같은 설정(민감도 60, 최소 간격 75ms)으로 돌렸다. 악기를 진짜로 분리하지 않는 **근사**이다.');
out(`- 겹침 = 한쪽 후보 중 다른 쪽에 ±${TOL}ms 안의 후보가 있는 비율. 후보가 촘촘하면(초당 5~7개) 우연히도 겹치므로, 한쪽을 ${SHIFT}ms 옮겨 센 '우연 기준'을 같이 적는다.`);
out('');

// ---- 1. Node(원본 분석 캐시 모노)에서: 시간, 개수, 모드 사이 겹침
out('## 1. 6곡 (원본 분석 캐시 audio22k.npy 모노 입력, Node 에서 실행)');
out('');
out('### 1-1. 분석 시간(초)과 후보 개수 (시간 / 후보 수)');
out('');
out('| 곡 | 길이(초) | ' + MODES.join(' | ') + ' |');
out('|---|---|' + MODES.map(() => '---').join('|') + '|');
const nodeTimes: Record<string, Record<string, number[]>> = {};
const presetTimes: Record<string, { drums: number[]; melody: number[] }> = {};
const presetList = loadPresets().presets as { id: string; settings?: { sensitivity?: number; min_gap_ms?: number } }[];
const presetOf = (id: string): { sensitivity: number; minGapMs: number } => {
  const st = presetList.find((p) => p.id === id)?.settings ?? {};
  return { sensitivity: st.sensitivity ?? 60, minGapMs: st.min_gap_ms ?? 75 };
};
const nodeSecs: Record<string, number> = {};
const projDirs = readdirSync(PROJ);
for (const s of SONGS) {
  const dirName = projDirs.find((n) => n.startsWith(s.name));
  if (!dirName) continue;
  const samples = readNpyFloat32(`${PROJ}/${dirName}/analysis/audio22k.npy`);
  nodeSecs[s.id] = samples.length / 22050;
  nodeTimes[s.id] = {};
  const cells: string[] = [];
  for (const m of MODES) {
    const t0 = performance.now();
    const r = await analyzeAudio(samples, { detector: m });
    const dt = (performance.now() - t0) / 1000;
    nodeTimes[s.id]![m] = r.candidates.map((c) => c.time_ms);
    cells.push(`${dt.toFixed(1)} / ${r.candidate_count}`);
  }
  out(`| ${s.id} | ${nodeSecs[s.id]!.toFixed(0)} | ${cells.join(' | ')} |`);
  // 프리셋(presets.json)의 민감도·최소 간격으로 drums·melody 를 한 번 더 돌린다(실제 화면에서 쓰는 설정)
  const pd = await analyzeAudio(samples, { detector: 'drums', ...presetOf('drums') });
  const pm = await analyzeAudio(samples, { detector: 'melody', ...presetOf('melody') });
  presetTimes[s.id] = { drums: pd.candidates.map((c) => c.time_ms), melody: pm.candidates.map((c) => c.time_ms) };
}
out('');
out('(vocal 은 이 표에서 모노 입력이라 "모노 음원이라 정확도가 낮습니다" 안내가 붙는 경우의 값이다.)');
out('');
out('### 1-2. 모드 사이 겹침 (행 모드 후보 중 열 모드에 겹치는 비율)');
out('');
const gate: string[] = [];
for (const s of SONGS) {
  const t = nodeTimes[s.id];
  if (!t) continue;
  out(`**${s.id}** (우연 기준: drums 를 ${SHIFT}ms 옮겨 melody 와 비교한 값 ${pct(coverage(t.drums!, t.melody!, TOL, SHIFT))})`);
  out('');
  out('| 행＼열 | ' + MODES.join(' | ') + ' |');
  out('|---|' + MODES.map(() => '---').join('|') + '|');
  for (const a of MODES) out(`| ${a} | ` + MODES.map((b) => (a === b ? '-' : pct(coverage(t[a]!, t[b]!)))).join(' | ') + ' |');
  out('');
  const dm = coverage(t.drums!, t.melody!);
  const md = coverage(t.melody!, t.drums!);
  gate.push(`${s.id}: drums→melody ${pct(dm)}, melody→drums ${pct(md)} → ${Math.max(dm, md) < 0.8 ? '80% 미만(서로 다름)' : '80% 이상(비슷)'}`);
}
out('**drums ↔ melody 겹침 판정 — 모든 모드를 같은 설정(60/75)으로 돌린 경우 (기준: 80% 미만이면 서로 다름)**');
out('');
for (const g of gate) out(`- ${g}`);
out('');
out('### 1-3. drums ↔ melody 겹침 — 프리셋 설정으로 돌린 경우 (화면에서 실제로 쓰는 값)');
out('');
const dp = presetOf('drums');
const mp = presetOf('melody');
out(`drums 프리셋: 민감도 ${dp.sensitivity}, 최소 간격 ${dp.minGapMs}ms / melody 프리셋: 민감도 ${mp.sensitivity}, 최소 간격 ${mp.minGapMs}ms`);
out('');
out('- 방향별 겹침 = 한쪽 후보 중 다른 쪽 ±50ms 안에 후보가 있는 비율(촘촘한 쪽에 우연히 걸리는 몫이 큼)');
out('- 우연 기준 = drums 후보를 373ms 옮겨 센 drums→melody 값');
out('- 1대1 겹침 = ±50ms 안에서 서로 한 번씩만 짝지은 수 ÷ (drums 수 + melody 수 − 짝지은 수). 한 후보가 여러 후보와 짝지어지는 부풀림이 없다.');
out('');
out('| 곡 | drums 수 | melody 수 | drums→melody | melody→drums | 우연 기준 | 1대1 겹침 | 80% 미만? |');
out('|---|---|---|---|---|---|---|---|');
for (const s of SONGS) {
  const t = presetTimes[s.id];
  if (!t) continue;
  const dm = coverage(t.drums, t.melody);
  const md = coverage(t.melody, t.drums);
  const mt = matchOnsets(t.drums, t.melody, TOL).matched;
  const jac = mt / (t.drums.length + t.melody.length - mt);
  out(`| ${s.id} | ${t.drums.length} | ${t.melody.length} | ${pct(dm)} | ${pct(md)} | ${pct(coverage(t.drums, t.melody, TOL, SHIFT))} | ${pct(jac)} | ${Math.max(dm, md) < 0.8 ? '예(방향별 모두)' : jac < 0.8 ? '1대1 기준만 예' : '아니오'} |`);
}
out('');

// ---- 2. 크롬(헤드리스) 측정: 시간, 스테레오 보컬, demucs 일치율
out('## 2. 크롬(헤드리스)에서 실제 곡 4개 측정 (디코딩은 크롬, 분석은 워커)');
out('');
out('곡 파일은 `D:\\RhythmActionGame_HitRus\\Music\\` 에서 경로로 열어 읽기만 했다(복사 없음). 측정 도구: `tools\\browser_modes_check.ts`, 페이지 `test\\browser\\modes_check.html`. 결과 원본은 `log\\modes01b\\m1~m4.json`.');
out('');
interface ChromeRun {
  error?: string;
  durationSec: number;
  isMono: boolean;
  decodeMonoMs: number;
  decodeStereoMs: number;
  modes: Record<string, { analyzeMs: number; count: number; times: number[]; warnings: string[] }>;
}
const CHROME: { file: string; id: string; title: string; demucs: string }[] = [
  { file: 'm1', id: 's1', title: 'Aiobahn', demucs: '1-2' },
  { file: 'm2', id: 's2', title: 'Earth, Wind & Fire', demucs: 'tutorial' },
  { file: 'm3', id: 's3', title: "Snail's House", demucs: '1-1' },
  { file: 'm4', id: 's4', title: 'メズマライザー', demucs: '1-3' },
];
const chrome: Record<string, ChromeRun> = {};
for (const c of CHROME) {
  const p = `D:/RhythmChartWeb/log/modes01b/${c.file}.json`;
  if (existsSync(p)) chrome[c.id] = JSON.parse(readFileSync(p, 'utf8')) as ChromeRun;
}
const KEYS = ['hybrid', 'bass', 'drums', 'melody', 'vocal', 'vocal_mono'];
out('### 2-1. 분석 시간 (밀리초, 분석 워커만. 디코딩은 따로) — 괄호는 후보 수');
out('');
out('| 곡 | 길이(초) | 입력 | 디코딩 모노/스테레오(ms) | ' + KEYS.join(' | ') + ' |');
out('|---|---|---|---|' + KEYS.map(() => '---').join('|') + '|');
for (const c of CHROME) {
  const r = chrome[c.id];
  if (!r || r.error) {
    out(`| ${c.title} | - | - | - | ${r?.error ?? '측정 없음'} |`);
    continue;
  }
  out(`| ${c.title} | ${r.durationSec} | ${r.isMono ? '모노' : '스테레오'} | ${r.decodeMonoMs}/${r.decodeStereoMs} | ` + KEYS.map((k) => `${r.modes[k]?.analyzeMs ?? '-'} (${r.modes[k]?.count ?? '-'})`).join(' | ') + ' |');
}
out('');
out('### 2-2. demucs 보컬 분석과의 일치율 (±50ms, 합격선 없음 — 수치만 기록)');
out('');
out('기준 = HitRus 에서 demucs(htdemucs) 보컬 스템으로 뽑은 보컬 소리 시작(onset) 목록(`log\\구조분석\\vocal_onsets_<곡>.json`, 보컬이 있는 구간 안만). 비교 구간은 demucs 가 분석한 구간(창)이다.');
out('- **기준 포착률** = demucs onset 중 해당 모드 후보가 ±50ms 안에 있는 비율(`matchRate04N` 의 covered 와 같은 의미)');
out('- **후보 적중률** = 구간 안 해당 모드 후보 중 demucs onset ±50ms 안에 있는 비율(`matchRate04N` 의 onTop 과 같은 의미)');
out(`- **우연 기준** = 후보를 ${SHIFT}ms 옮겨서 센 같은 값(촘촘한 후보가 우연히 맞는 정도). 모드 값이 우연 기준보다 얼마나 높은지가 의미 있는 부분이다.`);
out('');
out('| 곡 | demucs onset 수 | 모드 | 구간 안 후보 수 | 기준 포착률 | 후보 적중률 | 우연 기준(포착/적중) |');
out('|---|---|---|---|---|---|---|');
const avg: Record<string, { cov: number; prec: number; covB: number; precB: number; n: number }> = {};
for (const c of CHROME) {
  const r = chrome[c.id];
  if (!r || r.error) continue;
  const dj = JSON.parse(readFileSync(`${DEMUCS}/vocal_onsets_${c.demucs}.json`, 'utf8')) as { onsets: number[][] };
  const rj = JSON.parse(readFileSync(`${DEMUCS}/vocal_regions_${c.demucs}.json`, 'utf8')) as { info: { window_start_s: number; window_s: number } };
  const w0 = rj.info.window_start_s * 1000;
  const w1 = w0 + rj.info.window_s * 1000;
  const on = dj.onsets.map((o) => o[0]!).sort((a, b) => a - b);
  for (const k of KEYS) {
    const all = r.modes[k]?.times;
    if (!all) continue;
    const inWin = all.filter((t) => t >= w0 && t <= w1);
    const cov = coverage(on, inWin);
    const prec = coverage(inWin, on);
    const covB = coverage(on, inWin.map((t) => t + SHIFT));
    const precB = coverage(inWin, on, TOL, SHIFT);
    out(`| ${c.title} | ${on.length} | ${k} | ${inWin.length} | ${pct(cov)} | ${pct(prec)} | ${pct(covB)}/${pct(precB)} |`);
    const a = (avg[k] ??= { cov: 0, prec: 0, covB: 0, precB: 0, n: 0 });
    a.cov += cov;
    a.prec += prec;
    a.covB += covB;
    a.precB += precB;
    a.n++;
  }
}
out('');
out('**4곡 평균**');
out('');
out('| 모드 | 기준 포착률 | 후보 적중률 | 우연 기준(포착/적중) |');
out('|---|---|---|---|');
for (const k of KEYS) {
  const a = avg[k];
  if (a) out(`| ${k} | ${pct(a.cov / a.n)} | ${pct(a.prec / a.n)} | ${pct(a.covB / a.n)}/${pct(a.precB / a.n)} |`);
}
out('');
out('### 2-3. 크롬에서 본 모드 사이 겹침 (drums ↔ melody)');
out('');
for (const c of CHROME) {
  const r = chrome[c.id];
  if (!r || r.error) continue;
  const d = r.modes.drums!.times;
  const m = r.modes.melody!.times;
  out(`- ${c.title}: drums→melody ${pct(coverage(d, m))}, melody→drums ${pct(coverage(m, d))} (우연 기준 ${pct(coverage(d, m, TOL, SHIFT))})`);
}
out('');
out('### 2-4. 보컬(스테레오 중앙 성분) 대 보컬(모노 대역만)');
out('');
for (const c of CHROME) {
  const r = chrome[c.id];
  if (!r || r.error) continue;
  const a = r.modes.vocal!.times;
  const b = r.modes.vocal_mono!.times;
  out(`- ${c.title}: 후보 ${a.length}개(스테레오) / ${b.length}개(모노), 서로 겹침 ${pct(coverage(a, b))} / ${pct(coverage(b, a))}, 안내 문구 수 스테레오 ${r.modes.vocal!.warnings.length}개 · 모노 ${r.modes.vocal_mono!.warnings.length}개`);
}
out('');
writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
