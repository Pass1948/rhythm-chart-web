// 04단계 반응형 계산 단위 테스트(화면 요소 없이 순수 함수만)
import { describe, expect, it } from 'vitest';
import { actionOnMove, clampSpan, computePlayLayout, dragScroll, layoutModeOf, pinchView, startPinch, isPhoneLandscape } from '../src/ui/layout/layoutLogic';

describe('화면 크기 기준', () => {
  it('모바일·태블릿·PC·가로 모바일을 나눈다', () => {
    expect(layoutModeOf(390, 844)).toBe('mobile');
    expect(layoutModeOf(639, 1000)).toBe('mobile');
    expect(layoutModeOf(640, 900)).toBe('tablet');
    // 04b: PC 3열은 폭 960 이상, 그보다 좁으면 하단 탭 배치(단일 기준)
    expect(layoutModeOf(1023, 768)).toBe('tablet');
    expect(layoutModeOf(1024, 768)).toBe('pc');
    expect(layoutModeOf(1024, 768)).toBe('pc');
    expect(layoutModeOf(844, 390)).toBe('mobile');
    expect(layoutModeOf(1000, 400)).toBe('mobile');
    expect(layoutModeOf(1280, 400)).toBe('pc');
    expect(isPhoneLandscape(844, 390)).toBe(true);
    expect(isPhoneLandscape(1280, 400)).toBe(false);
  });
});

describe('손가락 조작 계산', () => {
  it('핀치로 벌리면 구간이 짧아지고 한계 안에 머문다', () => {
    const view = { start: 1000, span: 6000 };
    const a = startPinch(view, 200, 400, 100);
    const zoomIn = pinchView(a, 200, 200, 400);
    expect(zoomIn.span).toBeCloseTo(3000, 5);
    const zoomOut = pinchView(a, 50, 200, 400);
    expect(zoomOut.span).toBeCloseTo(12000, 5);
    expect(pinchView(a, 100000, 200, 400).span).toBe(clampSpan(0));
    expect(clampSpan(1e9)).toBe(40000);
  });
  it('핀치 중 가운데 점 밑의 곡 시각이 그대로다', () => {
    const view = { start: 1000, span: 6000 };
    const a = startPinch(view, 150, 400, 100);
    const next = pinchView(a, 250, 150, 400);
    const t = (400 - 22 - 150) / (400 - 36);
    expect(next.start + t * next.span).toBeCloseTo(a.anchorMs, 5);
  });
  it('한 손가락 스크롤은 손가락 밑 시각을 유지한다', () => {
    expect(dragScroll(1000, 6000, 0, 400)).toBe(1000);
    expect(dragScroll(1000, 6000, 36, 436)).toBeCloseTo(1000 + (36 / 400) * 6000, 5);
  });
  it('도구에 따라 한 손가락 끌기 동작이 다르다', () => {
    expect(actionOnMove('select', false)).toBe('scroll');
    expect(actionOnMove('tap', false)).toBe('scroll');
    expect(actionOnMove('hold', false)).toBe('drag-create');
    expect(actionOnMove('burst', false)).toBe('drag-create');
    expect(actionOnMove('select', true)).toBe('paste-preview');
  });
});

describe('플레이 화면 배치', () => {
  it('무대는 항상 세로 720x1280 비율', () => {
    for (const [w, h] of [[390, 844], [844, 390], [768, 1024], [1280, 720], [1920, 1080]] as const) {
      const r = computePlayLayout(w, h);
      expect(r.stageHeight / r.stageWidth).toBeCloseTo(1280 / 720, 5);
      expect(r.fit.left).toBeGreaterThanOrEqual(0);
      expect(r.fit.left + r.stageWidth).toBeLessThanOrEqual(w + 0.001);
      expect(r.fit.top + r.stageHeight).toBeLessThanOrEqual(h + 0.001);
    }
  });
  it('PC 는 양옆 패널, 태블릿은 아래 HUD, 모바일은 아무것도 없다', () => {
    expect(computePlayLayout(1280, 720).sidePanelWidth).toBeGreaterThan(180);
    expect(computePlayLayout(1920, 1080).mode).toBe('pc');
    const t = computePlayLayout(768, 1024);
    expect(t.bottomBarHeight).toBeGreaterThan(0);
    expect(t.fit.top + t.stageHeight).toBeLessThanOrEqual(1024 - t.bottomBarHeight + 0.001);
    const p = computePlayLayout(390, 844);
    expect([p.sidePanelWidth, p.bottomBarHeight]).toEqual([0, 0]);
    const l = computePlayLayout(844, 390);
    expect(l.mode).toBe('phone-landscape');
    expect(l.fit.left + l.stageWidth / 2).toBeCloseTo(422, 3);
  });
  it('안전 영역만큼 무대를 안쪽으로 놓는다', () => {
    const r = computePlayLayout(390, 844, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(r.fit.top).toBeGreaterThanOrEqual(47);
    expect(r.fit.top + r.stageHeight).toBeLessThanOrEqual(844 - 34 + 0.001);
  });
});
