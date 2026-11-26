/**
 * 분석 모드 측정 페이지(개발용, 01b): 선택한 실제 곡(읽기만, 저장 안 함)을 크롬에서 디코딩(모노·스테레오)하고
 * 모드 5개 + 보컬(모노만 쓴 경우)을 분석 워커로 돌려 걸린 시간과 후보 시각을 JSON 으로 적는다.
 */
import { analyzeInWorker, decodeToMono22k } from '../../src/analysis/index.ts';
import { decodeStereo22k, withStereo } from '../../src/analysis/modes/api.ts';

const input = document.getElementById('f') as HTMLInputElement;
const out = document.getElementById('out')!;

input.addEventListener('change', async () => {
  const file = input.files![0]!;
  const report: Record<string, unknown> = { fileBytes: file.size, modes: {} };
  const modes = report.modes as Record<string, unknown>;
  try {
    const t0 = performance.now();
    const mono = await decodeToMono22k(file);
    report.decodeMonoMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const st = await decodeStereo22k(file);
    report.decodeStereoMs = Math.round(performance.now() - t1);
    report.durationSec = Math.round(mono.durationMs / 100) / 10;
    report.isMono = st.isMono;
    const runs: [string, string, Parameters<typeof analyzeInWorker>[1]][] = [
      ['hybrid', 'hybrid', { detector: 'hybrid' }],
      ['bass', 'bass', { detector: 'bass' }],
      ['drums', 'drums', { detector: 'drums' }],
      ['melody', 'melody', { detector: 'melody' }],
      ['vocal', 'vocal', st.isMono ? { detector: 'vocal' } : withStereo({ detector: 'vocal' }, st.left, st.right)],
      ['vocal_mono', 'vocal', { detector: 'vocal' }],
    ];
    for (const [key, , opts] of runs) {
      const t = performance.now();
      const res = await analyzeInWorker(mono.samples, opts);
      modes[key] = {
        analyzeMs: Math.round(performance.now() - t),
        count: res.candidate_count,
        bpm: res.timing.bpm,
        warnings: res.warnings,
        times: res.candidates.map((c) => c.time_ms),
        bands: res.candidates.map((c) => c.band[0]).join(''),
      };
    }
    report.done = true;
  } catch (e) {
    report.error = String(e);
  }
  out.textContent = JSON.stringify(report);
  document.title = report.done ? 'DONE' : 'FAILED';
});
