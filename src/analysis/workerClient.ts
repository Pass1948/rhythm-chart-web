/**
 * 메인(화면) 쪽에서 분석 워커를 부르는 한 곳.
 * - 파일을 읽어(22050Hz 모노) 워커로 보내고, 진행률·결과를 받는다.
 * - 분석 중 다른 분석이 오면 앞의 것을 취소한다(워커를 종료하고 새로 만든다).
 * - cancelAnalysis() 로 직접 취소할 수 있다. 취소된 분석의 Promise 는 AnalysisAborted 로 거부된다.
 */
import { AnalysisAborted } from './dsp.ts';
import { analyzeAudio } from './analyze.ts';
import { decodeToMono22k } from './prepare.ts';
import { computeWave } from './wave.ts';
import type { WaveMap } from './wave.ts';
import { AnalysisError } from './types.ts';
import type { AnalysisResult, AnalyzeOptions, ProgressFn } from './types.ts';

interface Running {
  id: number;
  /** 워커로 도는 중이면 워커, 화면 스레드 폴백이면 null */
  worker: Worker | null;
  /** 폴백 분석을 취소할 때 쓴다 */
  abort: AbortController;
  reject: (e: unknown) => void;
}

/** 워커를 못 쓸 때 화면에 보여 줄 안내 문구 */
export const NO_WORKER_NOTICE = '이 환경에서는 분석을 백그라운드로 돌릴 수 없어 화면에서 직접 분석합니다. 속도가 느릴 수 있습니다.';

/** 다음 화면 갱신 때까지 양보한다(분석을 조각 내서 화면이 멈추지 않게). */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let current: Running | null = null;
let nextId = 1;

/** 지금 돌고 있는 분석이 있으면 멈춘다. */
export function cancelAnalysis(): void {
  if (!current) return;
  const running = current;
  current = null;
  running.abort.abort();
  running.worker?.terminate();
  running.reject(new AnalysisAborted());
}

/** 분석이 돌고 있는지 */
export function isAnalyzing(): boolean {
  return current !== null;
}

/**
 * 소리 파일(또는 이미 디코딩한 소리)을 분석한다. 진행률은 0~1 로 알린다.
 * 앞 15%는 소리 불러오기, 나머지는 워커의 분석 진행률이다.
 */
export async function analyzeInWorker(
  input: File | ArrayBuffer | Float32Array,
  options: Partial<AnalyzeOptions>,
  onProgress?: ProgressFn,
): Promise<AnalysisResult> {
  cancelAnalysis(); // 앞의 분석이 있으면 취소
  const myId = nextId++;
  let samples: Float32Array;
  if (input instanceof Float32Array) {
    samples = input;
  } else {
    onProgress?.(0, '소리 불러오는 중');
    samples = (await decodeToMono22k(input)).samples;
    if (current !== null || myId !== nextId - 1) throw new AnalysisAborted(); // 불러오는 동안 새 분석이 시작됨
  }
  onProgress?.(0.15, '분석 준비하는 중');
  let worker: Worker | null = null;
  try {
    if (typeof Worker === 'undefined') throw new Error('Worker 없음');
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null; // 워커를 만들 수 없는 환경(아티팩트 등) → 화면 스레드에서 조각 나눠 분석
  }
  if (worker === null) return runOnMainThread(myId, samples, options, onProgress);
  const w = worker;
  return new Promise<AnalysisResult>((resolve, reject) => {
    const running: Running = { id: myId, worker: w, abort: new AbortController(), reject };
    current = running;
    let gotMessage = false; // 워커에서 한 번이라도 소식이 왔는가(시작 자체를 못 한 경우와 구분)
    const finish = (): void => {
      if (current === running) current = null;
      w.terminate();
    };
    w.onmessage = (ev: MessageEvent): void => {
      const msg = ev.data as { type: string; id: number; p?: number; label?: string; result?: AnalysisResult; message?: string };
      if (msg.id !== myId) return;
      gotMessage = true;
      if (msg.type === 'progress') onProgress?.(0.15 + 0.85 * (msg.p ?? 0), msg.label ?? '');
      else if (msg.type === 'done') {
        finish();
        const result = msg.result as AnalysisResult;
        resolve(Object.assign(result, { mode: result.options.detector }));
      } else if (msg.type === 'error') {
        finish();
        reject(new AnalysisError(msg.message ?? '분석 중 문제가 생겼습니다.'));
      }
    };
    w.onerror = (): void => {
      const wasCurrent = current === running;
      finish();
      if (!wasCurrent) return; // 이미 취소됨
      if (gotMessage) {
        reject(new AnalysisError('분석을 시작하지 못했습니다. 브라우저를 새로고침한 뒤 다시 시도해 주세요.'));
        return;
      }
      // 워커가 시작도 못 했다 → 화면 스레드로 대신 분석
      runOnMainThread(myId, samples, options, onProgress).then(resolve, reject);
    };
    // 소유권을 넘기면 복사 없이 보낼 수 있다(보낸 뒤 이 배열은 쓰지 않는다). 호출자가 계속 쓸 수 있게 복사본을 보낸다.
    const copy = new Float32Array(samples);
    try {
      w.postMessage({ type: 'analyze', id: myId, samples: copy, options }, [copy.buffer]);
    } catch {
      w.onerror?.(new ErrorEvent('error'));
    }
  });
}

/**
 * 워커를 못 쓸 때의 분석: 화면 스레드에서 같은 분석을 하되, 중간중간 양보(await)해서 화면이 멈추지 않게 한다.
 * 결과에는 안내 문구(속도가 느릴 수 있음)를 warnings 에 더한다.
 */
async function runOnMainThread(
  myId: number,
  samples: Float32Array,
  options: Partial<AnalyzeOptions>,
  onProgress?: ProgressFn,
): Promise<AnalysisResult> {
  const abort = new AbortController();
  return new Promise<AnalysisResult>((resolve, reject) => {
    const running: Running = { id: myId, worker: null, abort, reject };
    current = running;
    onProgress?.(0.15, '이 환경에서는 분석이 느릴 수 있습니다');
    analyzeAudio(
      samples,
      options,
      (p, label) => onProgress?.(0.15 + 0.85 * p, label),
      abort.signal,
      yieldToUi,
    ).then(
      (result) => {
        if (current === running) current = null;
        result.warnings.push(NO_WORKER_NOTICE);
        resolve(Object.assign(result, { mode: result.options.detector }));
      },
      (err: unknown) => {
        if (current === running) current = null;
        if (err instanceof AnalysisAborted || err instanceof AnalysisError) reject(err);
        else reject(new AnalysisError('분석 중 문제가 생겼습니다. 다른 파일로 다시 시도해 주세요.'));
      },
    );
  });
}

/**
 * [04e] 파형만 계산한다(이미 저장된 곡에 파형이 없을 때). 분석 작업과 따로 도는 워커를 쓰므로 분석을 취소하지 않는다.
 * 워커를 못 쓰면 화면 스레드에서 조각 나눠 계산한다. 진행률은 0~1.
 */
export async function computeWaveInWorker(samples: Float32Array, onProgress?: (fraction: number) => void): Promise<WaveMap> {
  let worker: Worker | null = null;
  try {
    if (typeof Worker === 'undefined') throw new Error('Worker 없음');
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker === null) return computeWave(samples, 22050, onProgress, undefined, yieldToUi);
  const w = worker;
  return new Promise<WaveMap>((resolve, reject) => {
    const fallback = (): void => {
      w.terminate();
      computeWave(samples, 22050, onProgress, undefined, yieldToUi).then(resolve, reject);
    };
    w.onmessage = (ev: MessageEvent): void => {
      const msg = ev.data as { type: string; p?: number; result?: WaveMap; message?: string };
      if (msg.type === 'progress') onProgress?.(msg.p ?? 0);
      else if (msg.type === 'wave-done') {
        w.terminate();
        resolve(msg.result as WaveMap);
      } else if (msg.type === 'error') {
        w.terminate();
        reject(new AnalysisError(msg.message ?? '파형을 만들지 못했습니다.'));
      }
    };
    w.onerror = fallback;
    const copy = new Float32Array(samples);
    try {
      w.postMessage({ type: 'wave', id: 1, samples: copy }, [copy.buffer]);
    } catch {
      fallback();
    }
  });
}
