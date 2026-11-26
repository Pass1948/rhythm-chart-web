/**
 * 분석 Web Worker: 화면이 멈추지 않도록 무거운 계산을 여기서 한다. 진행률을 중간중간 보낸다.
 * 메시지 형식(메인 → 워커): { type: 'analyze', id, samples(Float32Array, 소유권 이전), options }
 * 메시지 형식(워커 → 메인): { type: 'progress', id, p, label } / { type: 'done', id, result } / { type: 'error', id, message }
 * 취소는 메인 쪽이 워커를 종료(terminate)하는 방식으로 한다(계산 도중에도 즉시 멈춘다).
 */
import { analyzeAudio } from './analyze.ts';
import { computeWave } from './wave.ts';
import { AnalysisError } from './types.ts';
import type { AnalyzeOptions } from './types.ts';

interface AnalyzeRequest {
  type: 'analyze';
  id: number;
  samples: Float32Array;
  options: Partial<AnalyzeOptions>;
}

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<AnalyzeRequest>) => void) | null;
  postMessage: (msg: unknown) => void;
};

interface WaveRequest {
  type: 'wave';
  id: number;
  samples: Float32Array;
}

scope.onmessage = (ev: MessageEvent<AnalyzeRequest | WaveRequest>): void => {
  const req = ev.data;
  if (req.type === 'wave') {
    // [04e] 이미 저장된 곡의 파형만 따로 계산한다
    let last = 0;
    computeWave(req.samples, 22050, (f) => {
      const now = Date.now();
      if (now - last > 100) {
        last = now;
        scope.postMessage({ type: 'progress', id: req.id, p: f, label: '파형을 만드는 중' });
      }
    })
      .then((result) => scope.postMessage({ type: 'wave-done', id: req.id, result }))
      .catch(() => scope.postMessage({ type: 'error', id: req.id, message: '파형을 만들지 못했습니다.' }));
    return;
  }
  if (req.type !== 'analyze') return;
  let lastReport = 0;
  analyzeAudio(req.samples, req.options, (p, label) => {
    const now = Date.now();
    if (p >= 1 || now - lastReport > 100) {
      lastReport = now;
      scope.postMessage({ type: 'progress', id: req.id, p, label });
    }
  })
    .then((result) => scope.postMessage({ type: 'done', id: req.id, result }))
    .catch((err: unknown) => {
      const message = err instanceof AnalysisError ? err.message : '분석 중 문제가 생겼습니다. 다른 파일로 다시 시도해 주세요.';
      scope.postMessage({ type: 'error', id: req.id, message, detail: err instanceof Error ? err.message : String(err) });
    });
};
