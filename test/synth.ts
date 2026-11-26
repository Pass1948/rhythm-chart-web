/**
 * 합성 테스트 음원(킥·스네어·하이햇)과 소리 시작 지점 비교 도우미. Node 기능을 쓰지 않아 브라우저 확인 페이지에서도 쓴다.
 * 음원 파일을 만들지 않고 메모리에서만 쓴다.
 */
/** 결정적 난수(같은 시드면 같은 소리) */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

export interface SyntheticOptions {
  bpm: number;
  seconds: number;
  /** 첫 킥의 위치(ms) */
  startMs: number;
}

/**
 * 합성 테스트 음원(22050Hz 모노): 킥(박마다), 스네어(2·4박), 하이햇(8분마다).
 * 반환 kicks 는 킥이 들어간 시각(ms), hits 는 모든 타격(킥+스네어+하이햇)의 시각이다.
 */
export function makeSyntheticDrums(o: SyntheticOptions): { samples: Float32Array; kicks: number[]; hits: number[] } {
  const sr = 22050;
  const n = Math.floor(o.seconds * sr);
  const y = new Float32Array(n);
  const rnd = lcg(12345);
  const beatMs = 60000 / o.bpm;
  const kicks: number[] = [];
  const hits: number[] = [];
  const addKick = (t: number): void => {
    const s0 = Math.floor((t / 1000) * sr);
    let phase = 0;
    for (let i = 0; i < Math.floor(0.18 * sr) && s0 + i < n; i++) {
      const tt = i / sr;
      const f = 50 + 110 * Math.exp(-tt * 38); // 떨어지는 저음
      phase += (2 * Math.PI * f) / sr;
      y[s0 + i]! += 0.9 * Math.sin(phase) * Math.exp(-tt * 18);
    }
  };
  const addNoise = (t: number, len: number, decay: number, amp: number, highpass: boolean): void => {
    const s0 = Math.floor((t / 1000) * sr);
    let prev = 0;
    for (let i = 0; i < Math.floor(len * sr) && s0 + i < n; i++) {
      const x = rnd();
      const v = highpass ? x - prev : x; // 차분 = 간단한 고음 강조
      prev = x;
      y[s0 + i]! += amp * v * Math.exp(-(i / sr) * decay);
    }
  };
  let beat = 0;
  for (let t = o.startMs; t < o.seconds * 1000 - 300; t += beatMs, beat++) {
    addKick(t);
    kicks.push(t);
    hits.push(t);
    if (beat % 2 === 1) {
      addNoise(t, 0.16, 22, 0.8, false); // 스네어
      hits.push(t);
    }
    const t8 = t + beatMs / 2;
    if (t8 < o.seconds * 1000 - 300) {
      addNoise(t8, 0.05, 70, 0.6, true); // 하이햇
      hits.push(t8);
    }
  }
  return { samples: y, kicks, hits };
}

/** 소리 시작 지점 비교: 허용 오차(tolMs) 안에서 1대1로 맞춰 정밀도·재현율·F1 을 돌려준다(기준: ref, 새 결과: test). */
export function matchOnsets(ref: number[], test: number[], tolMs = 50): { precision: number; recall: number; f1: number; matched: number } {
  const a = [...ref].sort((x, y) => x - y);
  const b = [...test].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let matched = 0;
  while (i < a.length && j < b.length) {
    const d = b[j]! - a[i]!;
    if (Math.abs(d) <= tolMs) {
      matched++;
      i++;
      j++;
    } else if (d < 0) j++;
    else i++;
  }
  const precision = b.length ? matched / b.length : 0;
  const recall = a.length ? matched / a.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, matched };
}

/** 박 간격으로 나눈 나머지 차이(ms, -간격/2 ~ +간격/2): 시작점(위상) 비교용 */
export function phaseDiffMs(aMs: number, bMs: number, periodMs: number): number {
  let d = (aMs - bMs) % periodMs;
  if (d > periodMs / 2) d -= periodMs;
  if (d < -periodMs / 2) d += periodMs;
  return d;
}
