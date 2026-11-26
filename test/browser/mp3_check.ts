/**
 * 브라우저 속도 확인 페이지(개발용): 선택한 실제 곡 파일(읽기만 하고 어디에도 저장하지 않음)을
 * 크롬에서 디코딩하고 분석 워커로 분석하는 데 걸린 시간을 적는다.
 */
import { analyzeInWorker, decodeToMono22k } from '../../src/analysis/index.ts';

const input = document.getElementById('f') as HTMLInputElement;
const out = document.getElementById('out')!;
input.addEventListener('change', async () => {
  const file = input.files![0]!;
  const report: Record<string, unknown> = { fileBytes: file.size };
  try {
    const t0 = performance.now();
    const dec = await decodeToMono22k(file);
    report.decodeMs = Math.round(performance.now() - t0);
    report.durationSec = Math.round(dec.durationMs / 100) / 10;
    const t1 = performance.now();
    const res = await analyzeInWorker(dec.samples, { detector: 'hybrid', sensitivity: 60, minGapMs: 75 });
    report.analyzeMs = Math.round(performance.now() - t1);
    report.totalMs = Math.round(performance.now() - t0);
    report.bpm = res.timing.bpm;
    report.offsetMs = res.timing.audio_offset_ms;
    report.candidates = res.candidate_count;
    report.gridFitPercent = res.grid_fit.percent;
    report.done = true;
  } catch (e) {
    report.error = String(e);
  }
  out.textContent = JSON.stringify(report);
  document.title = report.done ? 'DONE' : 'FAILED';
});
