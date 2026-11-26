/**
 * 스테레오 보존 디코딩(보컬 근사 모드용). 01a 의 decodeToMono22k 는 고치지 않고 따로 만들었다.
 * 22050Hz 로 읽어 왼쪽·오른쪽을 각각 돌려준다. 화면(메인 스레드)에서만 쓴다(워커에는 OfflineAudioContext 가 없다).
 * 모노 합성 결과(mono)는 decodeToMono22k 와 같은 값(채널 평균 → 최대 진폭 0.99)이다. 왼쪽·오른쪽도 같은 배율을 곱한다.
 */
import { finalizeMono, ANALYSIS_SR } from '../prepare.ts';
import { AnalysisError } from '../types.ts';

export interface DecodedStereo {
  left: Float32Array;
  right: Float32Array;
  /** 채널 평균 모노(분석 입력으로 그대로 쓴다) */
  mono: Float32Array;
  /** 원래 모노 파일이거나 채널이 하나뿐이었는가(보컬 모드의 정확도가 낮아진다) */
  isMono: boolean;
  sampleRate: 22050;
  durationMs: number;
  leadSilenceMs: number;
  originalPeak: number;
}

/** 파일(또는 파일 내용)을 22050Hz 스테레오로 읽는다. 실패하면 쉬운 한국어로 안내한다. */
export async function decodeStereo22k(file: File | ArrayBuffer): Promise<DecodedStereo> {
  let bytes: ArrayBuffer;
  try {
    bytes = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  } catch {
    throw new AnalysisError('파일을 열지 못했습니다. 다시 선택해 주세요.');
  }
  const Ctor: typeof OfflineAudioContext | undefined =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) throw new AnalysisError('이 브라우저는 소리 파일을 읽는 기능을 지원하지 않습니다. 최신 크롬·엣지·사파리로 열어 주세요.');
  let audio: AudioBuffer;
  try {
    const ctx = new Ctor(2, ANALYSIS_SR, ANALYSIS_SR);
    audio = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new AnalysisError('이 파일을 읽지 못했습니다. mp3나 wav로 바꿔 올려 보세요.');
  }
  const channels = audio.numberOfChannels;
  const length = audio.length;
  const raw0 = audio.getChannelData(0);
  const raw1 = channels >= 2 ? audio.getChannelData(1) : raw0;
  // 모노 합성은 decodeToMono22k 와 같게 '모든 채널의 평균'
  const monoRaw = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < length; i++) monoRaw[i]! += data[i]! / channels;
  }
  const fin = finalizeMono(monoRaw);
  const scale = fin.originalPeak > 0 ? 0.99 / fin.originalPeak : 1;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = raw0[i]! * scale;
    right[i] = raw1[i]! * scale;
  }
  return {
    left,
    right,
    mono: fin.samples,
    isMono: channels < 2,
    sampleRate: ANALYSIS_SR,
    durationMs: fin.durationMs,
    leadSilenceMs: fin.leadSilenceMs,
    originalPeak: fin.originalPeak,
  };
}
