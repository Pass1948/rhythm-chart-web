// 08단계 단위 테스트: PC 채보 편집 폭(끌어서 조절) 범위 계산
import { describe, expect, it } from 'vitest';
import { EDITOR_WIDTH_CONFIG, clampEditorWidth, defaultEditorWidth, editorWidthRange, widthFromPointer } from '../src/ui/layout/editorWidth';

/** 바깥 여백 12×2 + 열 간격 12×2 */
const CHROME = 48;

describe('편집 폭 범위', () => {
  it('기본 폭은 지금의 clamp 값과 같다', () => {
    expect(defaultEditorWidth(1920)).toBe(520 > 1920 * 0.28 ? 1920 * 0.28 : 520); // 537.6 → 상한 520
    expect(defaultEditorWidth(1920)).toBe(520);
    expect(defaultEditorWidth(1440)).toBeCloseTo(403.2, 6);
    expect(defaultEditorWidth(1280)).toBe(380);
    expect(defaultEditorWidth(1200)).toBeCloseTo(336, 6);
    expect(defaultEditorWidth(1024)).toBeCloseTo(300, 0);
  });

  it('최소는 380px, 최대는 화면의 65%와 "가운데 420px 남기기" 중 작은 값', () => {
    const r = editorWidthRange(1920, 385, CHROME);
    expect(r.min).toBe(380);
    // 1920×0.65 = 1248, 1920−48−385−420 = 1067 → 작은 값
    expect(r.max).toBeCloseTo(1067, 6);
    const small = editorWidthRange(1440, 331, CHROME);
    // 1440×0.65 = 936, 1440−48−331−420 = 641
    expect(small.max).toBeCloseTo(641, 6);
  });

  it('화면 폭의 65%가 더 작은 경우', () => {
    const r = editorWidthRange(1600, 100, CHROME); // 65% = 1040, 가운데 기준 = 1032 → 가운데 기준
    expect(r.max).toBeCloseTo(1032, 6);
    const r2 = editorWidthRange(1600, 0, 0); // 65% = 1040, 가운데 기준 = 1180
    expect(r2.max).toBeCloseTo(1040, 6);
  });

  it('창이 좁아 최대가 최소보다 작아지면 최소로 고정', () => {
    const r = editorWidthRange(1024, 320, CHROME);
    expect(r.max).toBe(r.min);
    expect(clampEditorWidth(700, 1024, 320, CHROME)).toBe(380);
  });

  it('범위 밖 폭은 가까운 값으로, 정수로 맞춘다', () => {
    expect(clampEditorWidth(100, 1440, 331, CHROME)).toBe(380);
    expect(clampEditorWidth(5000, 1440, 331, CHROME)).toBe(641);
    expect(clampEditorWidth(512.6, 1440, 331, CHROME)).toBe(513);
    expect(clampEditorWidth(Number.NaN, 1440, 331, CHROME)).toBeNull();
  });

  it('창 크기가 바뀌면 같은 폭도 새 범위로 다시 맞춰진다', () => {
    const wide = clampEditorWidth(800, 1920, 385, CHROME);
    const narrow = clampEditorWidth(800, 1440, 331, CHROME);
    expect(wide).toBe(800);
    expect(narrow).toBe(641);
  });

  it('끌기: 포인터가 왼쪽으로 갈수록 오른쪽 열이 넓어진다', () => {
    // 오른쪽 열의 오른쪽 끝 1428, 간격 12
    expect(widthFromPointer(1000, 1428, 12)).toBe(422);
    expect(widthFromPointer(900, 1428, 12)).toBe(522);
    expect(EDITOR_WIDTH_CONFIG.minPx).toBe(380);
  });
});
