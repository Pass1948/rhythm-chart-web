/**
 * 모드 테스트용 합성 음원: 드럼(킥·스네어·하이햇) + 사인파 멜로디를 한 곡으로 섞는다. 파일은 만들지 않고 메모리에서만 쓴다.
 * 드럼과 멜로디 음의 시작 시각이 서로 ±50ms 안에 겹치지 않게 배치해서, 어느 모드가 어느 쪽을 잡는지 가릴 수 있다.
 */
import { makeSyntheticDrums } from './synth.ts';

export interface DrumMelodyOptions {
  seconds: number;
  /** 드럼 BPM(기본 120) */
  bpm?: number;
  /** 첫 킥 위치(ms) */
  drumStartMs?: number;
  /** 드럼을 뺄지 */
  noDrums?: boolean;
  /** 멜로디를 뺄지 */
  noMelody?: boolean;
}

export interface DrumMelody {
  samples: Float32Array;
  /** 드럼이 들어간 시각(ms, 킥·스네어·하이햇 전부) */
  drumHits: number[];
  /** 멜로디 음 시작 시각(ms) */
  melodyOnsets: number[];
}

const SR = 22050;

/** 멜로디 한 음: 기본음 + 2배음·3배음, 10ms 부드러운 시작, 길이 len 초, 끝에 짧게 줄어듦 */
function addTone(y: Float32Array, startMs: number, freq: number, len: number, amp: number): void {
  const s0 = Math.floor((startMs / 1000) * SR);
  const n = Math.floor(len * SR);
  for (let i = 0; i < n && s0 + i < y.length; i++) {
    const t = i / SR;
    const attack = Math.min(1, t / 0.01);
    const release = Math.min(1, (len - t) / 0.03);
    const env = attack * Math.max(0, release);
    const ph = 2 * Math.PI * freq * t;
    y[s0 + i]! += amp * env * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph));
  }
}

/** 120BPM 드럼 + 멜로디(0.5초마다, 드럼과 125ms 어긋난 위치, 음높이가 매번 바뀜) */
export function makeDrumMelody(o: DrumMelodyOptions): DrumMelody {
  const bpm = o.bpm ?? 120;
  const drumStart = o.drumStartMs ?? 300;
  const n = Math.floor(o.seconds * SR);
  const drums = makeSyntheticDrums({ bpm, seconds: o.seconds, startMs: drumStart });
  const y = new Float32Array(n);
  if (!o.noDrums) for (let i = 0; i < n; i++) y[i] = drums.samples[i]!;
  const beatMs = 60000 / bpm;
  const pitches = [330, 392, 494, 440, 523, 392, 659, 494]; // 음높이가 계속 바뀐다
  const melodyOnsets: number[] = [];
  if (!o.noMelody) {
    let k = 0;
    for (let t = drumStart + beatMs / 4; t < o.seconds * 1000 - 600; t += beatMs, k++) {
      addTone(y, t, pitches[k % pitches.length]!, (beatMs / 1000) * 0.9, 0.35);
      melodyOnsets.push(t);
    }
  }
  // 최대 진폭 0.99 로 맞춘다
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(y[i]!));
  if (peak > 0) for (let i = 0; i < n; i++) y[i]! *= 0.99 / peak;
  return { samples: y, drumHits: o.noDrums ? [] : drums.hits, melodyOnsets };
}
