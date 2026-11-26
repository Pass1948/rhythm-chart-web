/**
 * 브라우저 확인 페이지(개발용): 코드로 합성한 소리를 WAV(44.1kHz 스테레오 16비트)로 만들어 실제 브라우저 기능으로
 * ① 디코딩(OfflineAudioContext, 22050Hz 모노 변환) ② 분석 워커 ③ 진행률 ④ 취소 를 확인하고 결과를 화면(JSON)에 적는다.
 * 음원 파일은 어디에도 저장하지 않는다(메모리에서만).
 */
import { AnalysisAborted, analyzeInWorker, cancelAnalysis, decodeToMono22k } from '../../src/analysis/index.ts';
import { makeSyntheticDrums, matchOnsets } from '../synth.ts';

const out = document.getElementById('out')!;
const report: Record<string, unknown> = {};

/** 22050Hz 모노 → 44.1kHz 스테레오 16비트 WAV (간단한 선형 보간) */
function toWavBlob(mono22: Float32Array): Blob {
  const sr = 44100;
  const n = mono22.length * 2;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const writeStr = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    const p = i / 2;
    const a = Math.floor(p);
    const f = p - a;
    const s = mono22[a]! * (1 - f) + (mono22[a + 1] ?? mono22[a]!) * f;
    const q = Math.max(-1, Math.min(1, s * 0.8)) * 32767;
    v.setInt16(44 + i * 4, q, true);
    v.setInt16(46 + i * 4, q, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function main(): Promise<void> {
  const synth = makeSyntheticDrums({ bpm: 120, seconds: 40, startMs: 300 });
  const hits = [...new Set(synth.hits.map((h) => Math.round(h)))];
  const file = new File([toWavBlob(synth.samples)], 'synthetic.wav', { type: 'audio/wav' });
  report.fileBytes = file.size;

  const t0 = performance.now();
  const dec = await decodeToMono22k(file);
  report.decode = { samples: dec.samples.length, sampleRate: dec.sampleRate, durationMs: Math.round(dec.durationMs), ms: Math.round(performance.now() - t0), leadSilenceMs: Math.round(dec.leadSilenceMs) };

  // 워커 분석(파일 → 디코딩 → 워커)
  const progress: string[] = [];
  const t1 = performance.now();
  const res = await analyzeInWorker(file, {}, (p, label) => progress.push(`${p.toFixed(2)}:${label}`));
  const m = matchOnsets(hits, res.candidates.map((c) => c.time_ms), 50);
  report.analysis = {
    bpm: res.timing.bpm,
    offset_ms: res.timing.audio_offset_ms,
    candidates: res.candidate_count,
    recall: Number(m.recall.toFixed(3)),
    precision: Number(m.precision.toFixed(3)),
    gridFitPercent: res.grid_fit.percent,
    ms: Math.round(performance.now() - t1),
    progressSteps: progress.length,
    progressLast: progress[progress.length - 1],
    labels: [...new Set(progress.map((s) => s.split(':')[1]))],
  };

  // 취소: 분석 시작 직후 취소 → 거부(AnalysisAborted)
  const slow = analyzeInWorker(dec.samples, {});
  cancelAnalysis();
  let cancelled = false;
  try {
    await slow;
  } catch (e) {
    cancelled = e instanceof AnalysisAborted;
  }
  report.cancelByCall = cancelled;

  // 앞의 분석이 도는 중 새 분석이 오면 앞의 것이 취소된다
  const first = analyzeInWorker(dec.samples, {});
  const second = analyzeInWorker(dec.samples, { sensitivity: 70 });
  let firstCancelled = false;
  try {
    await first;
  } catch (e) {
    firstCancelled = e instanceof AnalysisAborted;
  }
  const secondResult = await second;
  report.replaceCancelsFirst = firstCancelled;
  report.secondOk = secondResult.candidate_count > 0;

  // 읽을 수 없는 파일: 쉬운 한국어 안내
  try {
    await decodeToMono22k(new File([new Uint8Array(500)], 'bad.mp3'));
    report.badFile = 'no-error';
  } catch (e) {
    report.badFile = (e as Error).message;
  }
  report.done = true;
}

main()
  .catch((e: unknown) => {
    report.error = String(e);
  })
  .finally(() => {
    out.textContent = JSON.stringify(report);
    document.title = report.done ? 'DONE' : 'FAILED';
  });
