/**
 * 01a 비교 측정: 원본(Python) 결과와 브라우저용 새 엔진 결과를 비교해 log\비교_01a.md 를 만든다.
 * 실행: node tools/compare01a.ts   (먼저 log\ref_python\make_reference.py 로 기준 결과가 만들어져 있어야 한다)
 * 원본 폴더의 곡 분석 캐시(audio22k.npy)는 읽기만 한다. 음원 파일은 복사하지 않는다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeAudio } from '../src/analysis/analyze.ts';
import type { AnalysisResult } from '../src/analysis/types.ts';
import { generateChart } from '../src/generate/generate.ts';
import type { GenerateOptions } from '../src/generate/types.ts';
import { makeSyntheticDrums, matchOnsets, phaseDiffMs, readNpyFloat32 } from './lib.ts';

const ROOT = resolve('.');
const PROJ = 'D:\\MusicNoteDesignProgram\\projects';
const OUT = resolve(ROOT, 'log', 'ref_python', 'out');

interface ManifestEntry {
  id: string;
  name: string;
  orig_bpm: number;
  orig_offset_ms: number;
  candidates: number;
  generated: { key: string; total: number; errors: number }[];
}
interface RefGen {
  options: GenerateOptions;
  result: { notes: { id: number; type: string; lane: unknown; tick: number; length_tick?: number; count?: number }[]; stats: { total: number; tap_percent: number; hold_percent: number; burst_percent: number }; validation: { error_count: number; warning_count: number } };
}

const manifest = JSON.parse(readFileSync(resolve(OUT, 'manifest.json'), 'utf8')) as ManifestEntry[];
const lines: string[] = [];
const out = (s = ''): void => {
  lines.push(s);
  console.log(s);
};

/** BPM 이 같거나(±0.5) 2배·반 관계인지 */
function bpmRelation(a: number, b: number): string {
  if (Math.abs(a - b) <= 0.5) return '같음';
  if (Math.abs(a * 2 - b) <= 1.0) return '새=원본x2';
  if (Math.abs(a / 2 - b) <= 0.5) return '새=원본/2';
  return '다름';
}

out('# 01a 비교 측정 (원본 Python 엔진 vs 브라우저용 새 엔진)');
out();
out('- 기준: 원본 `detect.select_candidates`(종합 hybrid, 민감도 60, 최소 간격 75ms) + `refine_with_onsets`. 입력은 원본 분석 캐시 `audio22k.npy`(읽기만).');
out('- 새 엔진은 같은 `audio22k.npy`를 입력으로 받아 `analyzeAudio`(종합 hybrid, 60, 75ms)를 Node 에서 실행했다. 박자(BPM·시작점)는 새 엔진이 처음부터 자기상관으로 추정한다(원본은 librosa 박 추적 결과를 출발점으로 쓴다).');
out();
out('## 1. 소리 시작 지점·BPM·속도');
out();
out('| 곡 | 길이(초) | 원본 후보 | 새 후보 | 정밀도 | 재현율 | F1(±50ms) | 원본 BPM | 새 BPM | 관계 | 원본 BPM이 BPM 후보에 있나 | 시작점 차이(ms) | 분석 시간(초) |');
out('|---|---|---|---|---|---|---|---|---|---|---|---|---|');

const analyses: Record<string, AnalysisResult> = {};
const f1s: number[] = [];
const times: number[] = [];
for (const m of manifest) {
  const samples = readNpyFloat32(`${PROJ}\\${m.name}\\analysis\\audio22k.npy`);
  const ref = JSON.parse(readFileSync(resolve(OUT, `${m.id}_analysis.json`), 'utf8')) as { candidates: { time_ms: number }[]; timing: { bpm: number; audio_offset_ms: number } };
  const t0 = Date.now();
  const res = await analyzeAudio(samples, { detector: 'hybrid', sensitivity: 60, minGapMs: 75 });
  const sec = (Date.now() - t0) / 1000;
  analyses[m.id] = res;
  const mt = matchOnsets(
    ref.candidates.map((c) => c.time_ms),
    res.candidates.map((c) => c.time_ms),
    50,
  );
  const period = 60000 / ref.timing.bpm;
  const rel = bpmRelation(ref.timing.bpm, res.timing.bpm);
  const pd = rel === '같음' ? phaseDiffMs(ref.timing.audio_offset_ms, res.timing.audio_offset_ms, period).toFixed(1) : '-';
  f1s.push(mt.f1);
  times.push(sec);
  out(
    `| ${m.id} | ${(samples.length / 22050).toFixed(0)} | ${ref.candidates.length} | ${res.candidates.length} | ${mt.precision.toFixed(3)} | ${mt.recall.toFixed(3)} | ${mt.f1.toFixed(3)} | ${ref.timing.bpm} | ${res.timing.bpm} | ${rel} | ${res.beats.bpm_candidates.some((c) => Math.abs(c.bpm - ref.timing.bpm) <= 0.5) ? '있음(' + res.beats.bpm_candidates.filter((c) => Math.abs(c.bpm - ref.timing.bpm) <= 0.5).map((c) => c.kind).join(',') + ')' : '없음'} | ${pd} | ${sec.toFixed(1)} |`,
  );
}
const meanF1 = f1s.reduce((s, x) => s + x, 0) / f1s.length;
out();
out(`- F1 평균 ${meanF1.toFixed(3)} (목표 0.85 이상), 가장 낮은 곡 ${Math.min(...f1s).toFixed(3)}`);
out(`- 분석 시간: 평균 ${(times.reduce((s, x) => s + x, 0) / times.length).toFixed(1)}초, 최대 ${Math.max(...times).toFixed(1)}초 (곡 길이 약 4분, Node 22 이상, 목표 25초 이하)`);

// ---------- 합성 음원 ----------
out();
out('## 2. 합성 음원 (120BPM, 코드로 만든 킥·스네어·하이햇, 첫 킥 300ms)');
{
  const { samples, hits } = makeSyntheticDrums({ bpm: 120, seconds: 60, startMs: 300 });
  const uniq = [...new Set(hits.map((h) => Math.round(h)))];
  const t0 = Date.now();
  const res = await analyzeAudio(samples, { detector: 'hybrid', sensitivity: 60, minGapMs: 75 });
  const mt = matchOnsets(uniq, res.candidates.map((c) => c.time_ms), 50);
  out(`- 새 BPM ${res.timing.bpm} (정답 120), 시작점 ${res.timing.audio_offset_ms}ms (정답 -200 = 300 - 500), 시작 지점 재현율 ${mt.recall.toFixed(3)}, 정밀도 ${mt.precision.toFixed(3)}, 박자 맞춤 ${res.grid_fit.percent}%, 분석 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
}

// ---------- 생성 비교 ----------
out();
out('## 3. 채보 생성 비교 (같은 시드 19491, 같은 옵션)');
out();
out('### 3-1. 이식 정확도: 원본과 **같은 분석 결과(원본 후보)**를 넣었을 때 노트 목록이 완전히 같은가');
out();
let exact = 0;
let exactTotal = 0;
const exactFail: string[] = [];
const rows: string[] = [];
for (const m of manifest) {
  const refAnalysis = JSON.parse(readFileSync(resolve(OUT, `${m.id}_analysis.json`), 'utf8')) as AnalysisResult;
  for (const g of m.generated) {
    const ref = JSON.parse(readFileSync(resolve(OUT, `${g.key}.json`), 'utf8')) as RefGen;
    const mine = generateChart(refAnalysis, ref.options);
    const same = JSON.stringify(mine.notes) === JSON.stringify(ref.result.notes);
    exactTotal++;
    if (same) exact++;
    else exactFail.push(g.key);
    // 새 후보로 만든 결과 (같은 옵션)
    const mine2 = generateChart({ ...analyses[m.id]!, song: refAnalysis.song }, ref.options);
    rows.push(
      `| ${g.key} | ${ref.result.stats.total} | ${mine.stats.total} | ${same ? '같음' : '다름'} | ${mine2.stats.total} | ${ref.result.stats.tap_percent}/${ref.result.stats.hold_percent}/${ref.result.stats.burst_percent} | ${mine2.stats.tap_percent}/${mine2.stats.hold_percent}/${mine2.stats.burst_percent} | ${ref.result.validation.error_count} | ${mine.validation.error_count} | ${mine2.validation.error_count} |`,
    );
  }
}
out(`- 결과: ${exact} / ${exactTotal} 조합에서 노트 목록이 원본과 완전히 같다 (곡 6 × 디자인 모드 3 × 난이도 3).${exactFail.length ? ' 다른 조합: ' + exactFail.join(', ') : ''}`);
out();
out('### 3-2. 조합별 표 (원본 후보 → 원본/새 엔진 노트 수·같은지, 새 후보 → 노트 수·비율, 검증 오류 수)');
out();
out('| 조합 | 원본 노트 수 | 이식 노트 수(같은 입력) | 같은지 | 새 후보로 만든 노트 수 | 원본 비율 탭/롱/연타(%) | 새 후보 비율(%) | 원본 오류 | 이식 오류 | 새 후보 오류 |');
out('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) out(r);

writeFileSync(resolve(ROOT, 'log', '비교_01a.md'), lines.join('\n') + '\n', 'utf8');
console.log('\n저장: log/비교_01a.md');
