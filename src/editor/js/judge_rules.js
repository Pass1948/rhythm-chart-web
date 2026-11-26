// 판정 규칙 (서버 app/core/judge.py 와 같은 기준). 판정 폭은 서버 설정(config/judge.json)을 받아 쓰고 여기에는 숫자를 적지 않는다.
//  - 단타: 시간 차이로 perfect / great / good, 벗어나면 miss
//  - 롱노트: 첫 터치의 등급이 노트 전체의 등급. 끝까지 누르면 자동 성공, 중간에 떼면 miss. 끝에서 떼는 타이밍은 판정하지 않는다.
//  - 연타노트: 구간 안에서 count 회 이상 터치하면 성공(clear), 모자라면 miss.

// diffMs 에 해당하는 등급 (허용 범위 밖이면 null). cfg = {perfect_ms, great_ms, good_ms, hold_end_tolerance_ms}
export function gradeForDiff(diffMs, cfg) {
  const d = Math.abs(diffMs);
  if (d <= cfg.perfect_ms) return 'perfect';
  if (d <= cfg.great_ms) return 'great';
  if (d <= cfg.good_ms) return 'good';
  return null;
}

export function judgeTap(noteMs, pressMs, cfg) {
  if (pressMs === null || pressMs === undefined) return { result: 'miss', success: false };
  const grade = gradeForDiff(pressMs - noteMs, cfg);
  return grade ? { result: grade, success: true, diff: pressMs - noteMs } : { result: 'miss', success: false };
}

// releaseMs: 손을 뗀 시각. 끝까지 누르고 있었으면 null
export function judgeHold(noteMs, lengthMs, pressMs, releaseMs, cfg) {
  if (pressMs === null || pressMs === undefined) return { result: 'miss', success: false };
  const grade = gradeForDiff(pressMs - noteMs, cfg);
  if (!grade) return { result: 'miss', success: false };
  const end = noteMs + lengthMs;
  if (releaseMs !== null && releaseMs !== undefined && releaseMs < end - cfg.hold_end_tolerance_ms) return { result: 'miss', success: false };
  return { result: grade, success: true, diff: pressMs - noteMs };
}

export function judgeBurst(startMs, lengthMs, presses, count) {
  const end = startMs + lengthMs;
  const touches = presses.filter((t) => t >= startMs && t <= end).length;
  return touches >= count ? { result: 'clear', success: true, touches } : { result: 'miss', success: false, touches };
}
