/**
 * 파이썬 random.Random(정수 시드)와 같은 난수열을 만드는 메르센 트위스터(MT19937) 구현.
 * 원본 생성 엔진이 random.Random(seed)를 쓰므로, 같은 시드·같은 입력이면 원본과 같은 채보가 나오게 하려고 직접 옮겼다.
 * 지원: random()(0~1 실수), getrandbits(k≤32), randrange(n)(n>0).
 */
const N = 624;
const M = 397;

export class PyRandom {
  private mt = new Uint32Array(N);
  private index = N + 1;

  /** 파이썬 random.seed(int) 와 같은 방식(init_by_array)으로 초기화한다. 시드는 0 이상 정수. */
  constructor(seed: number) {
    let n = Math.abs(Math.trunc(seed));
    const key: number[] = [];
    if (n === 0) key.push(0);
    while (n > 0) {
      key.push(n % 4294967296);
      n = Math.floor(n / 4294967296);
    }
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.index = N;
  }

  private initByArray(key: number[]): void {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    let k = Math.max(N, key.length);
    for (; k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1664525)) + key[j]! + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
    this.index = N;
  }

  /** 32비트 난수 한 개 */
  private genrandInt32(): number {
    const mt = this.mt;
    if (this.index >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      const y = (mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff);
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.index = 0;
    }
    let y = mt[this.index++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** 0 이상 1 미만의 실수 (파이썬 random.random()) */
  random(): number {
    const a = this.genrandInt32() >>> 5;
    const b = this.genrandInt32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** k비트(1~32) 난수 (파이썬 getrandbits) */
  getrandbits(k: number): number {
    return this.genrandInt32() >>> (32 - k);
  }

  /** 0 이상 n 미만 정수 (파이썬 randrange(n)) */
  randrange(n: number): number {
    const k = n.toString(2).length;
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }
}
