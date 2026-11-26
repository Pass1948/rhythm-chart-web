/**
 * 슬라이딩 중앙값(창을 한 칸씩 밀며 중앙값을 구함). 창 안의 값을 '정렬된 상태'로 유지해서
 * 값 하나를 빼고 하나를 넣는 비용만 든다(매번 전체를 정렬하지 않는다). HPSS 의 속도를 좌우하는 부분이다.
 */

/**
 * 정렬된 창 w[off .. off+size-1] 에서 oldV 하나를 빼고 newV 를 넣어 정렬을 유지한다.
 * oldV 는 반드시 창 안에 있어야 한다(같은 Float32 값이므로 정확히 같은 값을 찾는다).
 */
export function replaceSorted(w: Float32Array, off: number, size: number, oldV: number, newV: number): void {
  // oldV 위치 찾기(이진 탐색: 처음으로 oldV 이상인 자리)
  let lo = 0;
  let hi = size;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (w[off + mid]! < oldV) lo = mid + 1;
    else hi = mid;
  }
  let j = lo;
  if (newV >= oldV) {
    // 오른쪽으로 옮겨 넣는다
    while (j + 1 < size && w[off + j + 1]! < newV) {
      w[off + j] = w[off + j + 1]!;
      j++;
    }
  } else {
    // 왼쪽으로 옮겨 넣는다
    while (j > 0 && w[off + j - 1]! > newV) {
      w[off + j] = w[off + j - 1]!;
      j--;
    }
  }
  w[off + j] = newV;
}

/**
 * 1차원 배열의 슬라이딩 중앙값(가장자리는 끝 값을 되풀이해 채움). 창 크기 size 는 홀수.
 * src 와 dst 는 길이가 같고, scratch 는 길이 size 이상인 작업 공간이다.
 */
export function medianFilter1d(src: Float32Array, dst: Float32Array, size: number, scratch: Float32Array): void {
  const n = src.length;
  const r = (size - 1) >> 1;
  const at = (i: number): number => src[i < 0 ? 0 : i >= n ? n - 1 : i]!;
  for (let j = 0; j < size; j++) scratch[j] = at(j - r);
  scratch.subarray(0, size).sort();
  const mid = r;
  for (let i = 0; i < n; i++) {
    dst[i] = scratch[mid]!;
    if (i + 1 < n) replaceSorted(scratch, 0, size, at(i - r), at(i + 1 + r));
  }
}
