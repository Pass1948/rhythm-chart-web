// 효과음 합성 (순수 계산, 브라우저 코드 없음): 소리 설계도(layers)로 샘플 배열을 만든다. 음원 파일은 쓰지 않는다 [임시].
// 결과는 -1~1 사이 Float32Array 이며, 가장 큰 값이 설계도의 peak 와 같아지게 맞춘다.
export type SfxName =
  | 'hitPerfect'
  | 'hitGreat'
  | 'hitGood'
  | 'hitBad'
  | 'miss'
  | 'holdStart'
  | 'holdEnd'
  | 'holdTick'
  | 'burstPress'
  | 'burstSuccess'
  | 'feverStart'
  | 'feverEnd'
  | 'countTick'
  | 'countGo'
  | 'pause';

export const SFX_NAMES: readonly SfxName[] = [
  'hitPerfect',
  'hitGreat',
  'hitGood',
  'hitBad',
  'miss',
  'holdStart',
  'holdEnd',
  'holdTick',
  'burstPress',
  'burstSuccess',
  'feverStart',
  'feverEnd',
  'countTick',
  'countGo',
  'pause',
];

/** 소리 한 겹 */
export interface SfxLayer {
  wave: 'sine' | 'triangle' | 'square' | 'noise';
  /** 시작·끝 주파수 (Hz). 둘이 다르면 그 사이를 미끄러진다 */
  from: number;
  to: number;
  /** 길이 (ms) 와 시작 지연 (ms) */
  ms: number;
  delayMs?: number;
  /** 상대 크기 (0~1) */
  gain: number;
  /** 소리가 줄어드는 빠르기: 클수록 빨리 사라진다 */
  decay: number;
}

export interface SfxDesign {
  /** 가장 큰 값의 상대 크기 (0~1). 실제 크기는 SFX_CONFIG.voicePeak 에 곱해진다 */
  peak: number;
  layers: readonly SfxLayer[];
}

/** 소리 설계도. PERFECT/GREAT 는 밝고 선명하게, GOOD/BAD 는 둔하고 낮게 */
export const SFX_DESIGNS: Record<SfxName, SfxDesign> = {
  hitPerfect: {
    peak: 1,
    layers: [
      { wave: 'sine', from: 1320, to: 1320, ms: 160, gain: 0.8, decay: 4 },
      { wave: 'sine', from: 1980, to: 1980, ms: 130, gain: 0.5, decay: 5 },
      { wave: 'triangle', from: 2640, to: 2640, ms: 70, gain: 0.3, decay: 6 },
      { wave: 'noise', from: 0, to: 0, ms: 28, gain: 0.35, decay: 6 },
    ],
  },
  hitGreat: {
    peak: 0.9,
    layers: [
      { wave: 'sine', from: 1100, to: 1100, ms: 140, gain: 0.8, decay: 4.5 },
      { wave: 'sine', from: 1650, to: 1650, ms: 100, gain: 0.35, decay: 5.5 },
      { wave: 'noise', from: 0, to: 0, ms: 24, gain: 0.3, decay: 6 },
    ],
  },
  hitGood: {
    peak: 0.7,
    layers: [
      { wave: 'triangle', from: 560, to: 480, ms: 110, gain: 0.8, decay: 5 },
      { wave: 'noise', from: 0, to: 0, ms: 20, gain: 0.2, decay: 6 },
    ],
  },
  hitBad: {
    peak: 0.6,
    layers: [
      { wave: 'triangle', from: 300, to: 220, ms: 110, gain: 0.8, decay: 5 },
      { wave: 'square', from: 150, to: 120, ms: 70, gain: 0.25, decay: 7 },
    ],
  },
  miss: {
    peak: 0.55,
    layers: [
      { wave: 'triangle', from: 260, to: 90, ms: 230, gain: 0.8, decay: 3 },
      { wave: 'noise', from: 0, to: 0, ms: 80, gain: 0.15, decay: 5 },
    ],
  },
  holdStart: {
    peak: 0.7,
    layers: [
      { wave: 'sine', from: 600, to: 980, ms: 120, gain: 0.8, decay: 3 },
      { wave: 'sine', from: 1200, to: 1960, ms: 100, gain: 0.3, decay: 4 },
    ],
  },
  holdEnd: {
    peak: 0.7,
    layers: [
      { wave: 'sine', from: 1000, to: 660, ms: 140, gain: 0.8, decay: 3.5 },
      { wave: 'sine', from: 1500, to: 990, ms: 120, gain: 0.3, decay: 4 },
    ],
  },
  // 롱노트 틱: 짧고 가벼운 클릭 (약 40ms) [임시]. TapSound.wav 는 쓰지 않는다 (겹침 방지)
  holdTick: {
    peak: 0.4,
    layers: [
      { wave: 'sine', from: 1500, to: 1300, ms: 40, gain: 0.7, decay: 5 },
      { wave: 'noise', from: 0, to: 0, ms: 8, gain: 0.12, decay: 6 },
    ],
  },
  burstPress: {
    peak: 0.55,
    layers: [
      { wave: 'square', from: 1700, to: 1500, ms: 38, gain: 0.5, decay: 5 },
      { wave: 'noise', from: 0, to: 0, ms: 14, gain: 0.3, decay: 6 },
    ],
  },
  burstSuccess: {
    peak: 1,
    layers: [
      { wave: 'sine', from: 880, to: 880, ms: 160, gain: 0.7, decay: 3 },
      { wave: 'sine', from: 1320, to: 1320, ms: 160, gain: 0.7, decay: 3, delayMs: 70 },
      { wave: 'sine', from: 1760, to: 1760, ms: 260, gain: 0.8, decay: 3, delayMs: 140 },
      { wave: 'noise', from: 0, to: 0, ms: 60, gain: 0.25, decay: 5 },
    ],
  },
  feverStart: {
    peak: 1,
    layers: [
      { wave: 'sine', from: 400, to: 1800, ms: 420, gain: 0.7, decay: 1.6 },
      { wave: 'triangle', from: 800, to: 3200, ms: 380, gain: 0.3, decay: 1.8 },
      { wave: 'sine', from: 1760, to: 1760, ms: 300, gain: 0.5, decay: 3, delayMs: 220 },
    ],
  },
  feverEnd: {
    peak: 0.8,
    layers: [
      { wave: 'sine', from: 900, to: 220, ms: 360, gain: 0.8, decay: 2.5 },
      { wave: 'triangle', from: 1400, to: 440, ms: 300, gain: 0.25, decay: 3 },
    ],
  },
  countTick: { peak: 0.7, layers: [{ wave: 'sine', from: 880, to: 880, ms: 110, gain: 0.9, decay: 4 }] },
  countGo: {
    peak: 0.9,
    layers: [
      { wave: 'sine', from: 1320, to: 1320, ms: 260, gain: 0.8, decay: 3 },
      { wave: 'sine', from: 1980, to: 1980, ms: 220, gain: 0.35, decay: 3.5 },
    ],
  },
  pause: { peak: 0.6, layers: [{ wave: 'sine', from: 440, to: 280, ms: 160, gain: 0.9, decay: 3.5 }] },
};

/** 한 소리를 샘플 배열로 만든다. peak 는 설계도 peak × voicePeak 로 맞춘 최대 크기 */
export function renderSfx(design: SfxDesign, sampleRate: number, voicePeak: number): Float32Array<ArrayBuffer> {
  let totalMs = 0;
  for (const layer of design.layers) totalMs = Math.max(totalMs, (layer.delayMs ?? 0) + layer.ms);
  const length = Math.max(1, Math.ceil((totalMs / 1000) * sampleRate));
  const out = new Float32Array(length);
  // 소리를 같게 반복해 만들 수 있도록 잡음은 고정 씨앗의 간단한 난수로 만든다
  let seed = 12345;
  const nextNoise = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  for (const layer of design.layers) {
    const start = Math.floor(((layer.delayMs ?? 0) / 1000) * sampleRate);
    const count = Math.floor((layer.ms / 1000) * sampleRate);
    const attack = Math.max(1, Math.floor(sampleRate * 0.002));
    let phase = 0;
    for (let i = 0; i < count && start + i < length; i += 1) {
      const t = i / count;
      const freq = layer.from + (layer.to - layer.from) * t;
      phase += (2 * Math.PI * freq) / sampleRate;
      let value = 0;
      if (layer.wave === 'sine') value = Math.sin(phase);
      else if (layer.wave === 'triangle') value = (2 / Math.PI) * Math.asin(Math.sin(phase));
      else if (layer.wave === 'square') value = Math.sin(phase) >= 0 ? 1 : -1;
      else value = nextNoise();
      const envelope = Math.exp(-layer.decay * t) * Math.min(1, i / attack) * Math.min(1, (count - i) / attack);
      out[start + i] = out[start + i]! + value * envelope * layer.gain;
    }
  }
  let max = 0;
  for (let i = 0; i < length; i += 1) max = Math.max(max, Math.abs(out[i]!));
  if (max > 0) {
    const scale = (design.peak * voicePeak) / max;
    for (let i = 0; i < length; i += 1) out[i] = out[i]! * scale;
  }
  return out;
}

/** 판정 등급에 맞는 타격음 이름 */
export function hitSfxName(grade: 'perfect' | 'great' | 'good' | 'bad' | 'miss'): SfxName {
  if (grade === 'perfect') return 'hitPerfect';
  if (grade === 'great') return 'hitGreat';
  if (grade === 'good') return 'hitGood';
  if (grade === 'bad') return 'hitBad';
  return 'miss';
}

/** 효과음 크기 = 전체 볼륨(0~100) × 효과음 볼륨(0~100) × 기본 배율 */
export function sfxGain(masterVolume: number, sfxVolume: number, baseGain: number): number {
  return (masterVolume / 100) * (sfxVolume / 100) * baseGain;
}
