/** 작은 공용 도구들(원본 Python 표준 동작을 그대로 따라 하는 함수 포함). 한국어 주석. */

/** JSON으로 표현 가능한 값을 깊은 복사한다. */
export function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Python의 round()와 같은 '가장 가까운 짝수로' 반올림(0.5일 때만 짝수 쪽). numpy round·Python round 동작을 맞추는 데 쓴다. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** 오류 메시지용 소수 한 자리 표기(Python의 '%.1f'). */
export function fmt(x: number, digits: number): string {
  return x.toFixed(digits);
}

/** Python의 '%g' 비슷한 표기(불필요한 0 제거). */
export function fmtG(x: number): string {
  return String(Number(x.toPrecision(6)));
}
