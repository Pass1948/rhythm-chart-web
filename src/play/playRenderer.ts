// 플레이 화면의 Three.js 그리기: 레일과 노트. 규칙은 모르고, 위치·크기 계산은 railGeometry / noteLayout 의 순수 함수를 쓴다.
// 노트 그림은 풀(미리 만들어 둔 그림 묶음)에서 꺼내 쓰고, 프레임마다 새 객체를 만들지 않는다.
import * as THREE from 'three';
import type { ChartNote } from './core/chart/types';
import { EFFECT_CONFIG } from './effectConfig';
import { EffectsRenderer } from './effectsRenderer';
import type { EffectLevel } from './effectConfig';
import { NOTE_STATE, fillBarRange, fillNoteSpan, isTapVisible, type BarRange, type NoteSpan, type VisibleNotes } from './noteLayout';
import { PLAY_CONFIG, PLAY_VIEW } from './playConfig';
import { CAPSULE_ROWS, CAP_SEGMENTS, createCapsuleRows, fillCapsuleRows, fillQuadRows, type CapsuleInput } from './capsuleGeometry';
import { createRailShape, edgeX, halfWidthAt, judgeCircleCenter, laneCenterX, scaleAt, yAt, type RailShape } from './railGeometry';

const { colors, note: noteStyle, judgeCircle: circleStyle } = PLAY_CONFIG;
const CIRCLE_SEGMENTS = 40;

/** 그리기 순서 (큰 값이 위에 그려진다) */
// 판정원(글로우·채움·바깥 외곽선·안쪽 작은 원)은 레일 위, 노트(10~14)는 모두 판정원 위에 그린다 (가로 판정선은 없다)
const ORDER = { rail: 0, judgeGlow: 2, judgeFill: 3, judgeRing: 4, judgeInner: 5, railLine: 5, barOutline: 10, bar: 11, tapOutline: 12, tapBody: 13, tapCenter: 14 } as const;

/**
 * 막대 도형 하나를 매 프레임 꼭짓점만 바꿔 그리는 도형. 가로줄(row) 띠 구조라
 *  - 롱노트: 위·아래 끝이 반원인 둥근 긴 막대(캡슐, setCapsule)
 *  - 연타: 위쪽이 좁은 사다리꼴 줄무늬 막대(setQuad)
 * 를 같은 메시(같은 draw call 수)로 그린다. 계산은 capsuleGeometry.ts(순수 함수).
 */
class DynamicBar {
  readonly geometry = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  private readonly positions = new Float32Array(CAPSULE_ROWS * 2 * 3);
  private readonly uvs = new Float32Array(CAPSULE_ROWS * 2 * 2);
  private readonly rows = createCapsuleRows();

  constructor(material: THREE.Material, order: number) {
    const index: number[] = [];
    for (let r = 0; r < CAPSULE_ROWS - 1; r += 1) {
      const l = r * 2;
      index.push(l, l + 1, l + 3, l, l + 3, l + 2);
    }
    for (let r = 0; r < CAPSULE_ROWS; r += 1) {
      this.uvs[r * 4] = 0; // 왼쪽 꼭짓점 u
      this.uvs[r * 4 + 2] = 1; // 오른쪽 꼭짓점 u
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setIndex(index);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
  }

  /** 줄 정보를 꼭짓점·무늬 좌표로 옮긴다. y 는 화면 위에서 아래로 늘어나는 값(화면 좌표). v0 = 위쪽, v1 = 아래쪽 무늬 위치 */
  private upload(v0: number, v1: number): void {
    const p = this.positions;
    const uv = this.uvs;
    const split = CAP_SEGMENTS; // 위 반원 줄(0..split)은 v0, 아래 반원 줄은 v1
    for (let r = 0; r < CAPSULE_ROWS; r += 1) {
      const worldY = PLAY_VIEW.height - this.rows.y[r]!;
      p[r * 6] = this.rows.left[r]!;
      p[r * 6 + 1] = worldY;
      p[r * 6 + 3] = this.rows.right[r]!;
      p[r * 6 + 4] = worldY;
      const v = r <= split ? v0 : v1;
      uv[r * 4 + 1] = v;
      uv[r * 4 + 3] = v;
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.uv!.needsUpdate = true;
    this.mesh.visible = true;
  }

  /** 사다리꼴 막대(연타). y 는 화면 좌표. */
  setQuad(topLeftX: number, topRightX: number, topY: number, bottomLeftX: number, bottomRightX: number, bottomY: number, v0: number, v1: number): void {
    fillQuadRows(this.rows, topLeftX, topRightX, topY, bottomLeftX, bottomRightX, bottomY);
    this.upload(v0, v1);
  }

  /** 둥근 긴 막대(롱노트) */
  setCapsule(input: CapsuleInput): void {
    fillCapsuleRows(this.rows, input);
    this.upload(0, 0);
  }
}

/** 노트 그림 한 벌 (단타 원 3겹 + 막대 외곽선·막대). 풀에 미리 만들어 둔다. */
interface NoteSlot {
  tapOutline: THREE.Mesh;
  tapBody: THREE.Mesh;
  tapCenter: THREE.Mesh;
  barOutline: DynamicBar;
  bar: DynamicBar;
}

/** 판정원 한 개 (바닥의 동그라미). 레인마다 하나씩, 눌림 상태에 따라 채움·빛만 바뀐다 */
interface JudgeCircle {
  fill: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
  laneColor: number;
}

/** 연타 막대 위 "×n" 글자를 놓을 위치 (화면 좌표) */
export interface BurstAnchors {
  count: number;
  noteIndex: Int32Array;
  x: Float32Array;
  y: Float32Array;
}

/** 줄무늬 무늬 그림(연타 막대용) */
function makeStripeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fbf3e8';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#0e090f';
  // 비스듬한 검은 줄 (타일 가장자리에서 이어지도록 두 번 그린다)
  for (const shift of [-size, 0]) {
    g.beginPath();
    g.moveTo(0, shift + size / 2);
    g.lineTo(size, shift + size);
    g.lineTo(size, shift + size * 1.5);
    g.lineTo(0, shift + size);
    g.closePath();
    g.fill();
  }
  // 좌우 가장자리를 톱니 모양으로 깎는다 (투명하게 지움). 무늬가 시간에 붙어 반복되므로 톱니도 같이 내려온다
  g.globalCompositeOperation = 'destination-out';
  const tooth = 8;
  const period = 16;
  for (let y = 0; y < size; y += period) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(tooth, y + period / 2);
    g.lineTo(0, y + period);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(size, y);
    g.lineTo(size - tooth, y + period / 2);
    g.lineTo(size, y + period);
    g.closePath();
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class PlayRenderer {
  readonly shape: RailShape = createRailShape();
  /** 연타 막대 글자 위치 (매 프레임 갱신) */
  readonly burstAnchors: BurstAnchors;
  /** 풀 크기와 지금까지 한 프레임에 가장 많이 쓴 그림 수 */
  readonly poolSize: number;
  peakUsed = 0;
  /** 판정 이펙트 (빛기둥·링·별·롱노트·연타) */
  readonly effects: EffectsRenderer;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, PLAY_VIEW.width, PLAY_VIEW.height, 0, -10, 10);
  private readonly slots: NoteSlot[] = [];
  private usedLastFrame = 0;
  private readonly span: NoteSpan = { head: 0, tail: 0 };
  private readonly range: BarRange = { top: 0, bottom: 0 };
  private readonly disposables: Array<{ dispose(): void }> = [];
  /** 피버 때 색이 바뀌는 레일 가장자리 선 재질 */
  private readonly edgeMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly judgeCircles: JudgeCircle[] = [];
  private readonly feverColor = new THREE.Color();
  private readonly creamColor = new THREE.Color(colors.cream);
  private readonly glowColor = new THREE.Color(EFFECT_CONFIG.fever.glowColor);

  private readonly blackMat: THREE.MeshBasicMaterial;
  private readonly pinkMat: THREE.MeshBasicMaterial;
  private readonly creamMat: THREE.MeshBasicMaterial;
  private readonly mintMat: THREE.MeshBasicMaterial;
  private readonly grayMat: THREE.MeshBasicMaterial;
  private readonly grayOutlineMat: THREE.MeshBasicMaterial;
  private readonly stripeMat: THREE.MeshBasicMaterial;

  private readonly notes: readonly ChartNote[];
  /** 레인 수 (2키 2 / 4키 4) */
  private readonly laneCount: number;

  constructor(
    canvas: HTMLCanvasElement,
    notes: readonly ChartNote[],
    renderScalePercent: number,
    maxVisibleNotes: number,
    burstLabelCount: number,
    effectLevel: EffectLevel,
    /** 화면에 실제로 보이는 크기에 맞춘 배율 (viewConfig.renderPixelScale). 폰의 고해상도 화면에서 흐려지지 않게 한다 */
    pixelScale: number = 1,
    /** [10단계] 2(기본) 또는 4 */
    keyMode: 2 | 4 = 2,
  ) {
    this.laneCount = keyMode;
    this.notes = notes;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    // 내부 렌더 해상도 배율: 그림 크기는 그대로(CSS), 내부 픽셀 수만 줄인다
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round((PLAY_VIEW.width * renderScalePercent * pixelScale) / 100), Math.round((PLAY_VIEW.height * renderScalePercent * pixelScale) / 100), false);
    this.camera.position.z = 5;

    const material = (color: number, side: THREE.Side = THREE.DoubleSide): THREE.MeshBasicMaterial => {
      // 판정원이 반투명이라 모든 그림을 같은 목록(투명)에서 renderOrder 순서대로 그린다
      const m = new THREE.MeshBasicMaterial({ color, side, depthTest: false, depthWrite: false, transparent: true });
      this.disposables.push(m);
      return m;
    };
    this.blackMat = material(colors.black);
    this.pinkMat = material(colors.pink);
    this.creamMat = material(colors.cream);
    this.mintMat = material(colors.mint);
    this.grayMat = material(colors.broken);
    this.grayOutlineMat = material(colors.brokenOutline);
    const stripeTexture = makeStripeTexture();
    this.disposables.push(stripeTexture);
    this.stripeMat = new THREE.MeshBasicMaterial({ map: stripeTexture, side: THREE.DoubleSide, depthTest: false, depthWrite: false, alphaTest: 0.5, transparent: true });
    this.disposables.push(this.stripeMat);

    this.buildRail();
    this.buildJudgeCircles();
    this.buildPool(maxVisibleNotes);
    this.poolSize = this.slots.length;
    this.effects = new EffectsRenderer(this.scene, this.shape, effectLevel, this.laneCount);
    this.burstAnchors = {
      count: 0,
      noteIndex: new Int32Array(burstLabelCount),
      x: new Float32Array(burstLabelCount),
      y: new Float32Array(burstLabelCount),
    };
  }

  /** 레일(위가 좁은 두 레인, 테두리, 중앙선, 판정선)을 한 번만 만든다. */
  private buildRail(): void {
    const shape = this.shape;
    const rail = shape.config;
    const top = shape.config.topY;
    const bottom = rail.bottomY;
    const pBottom = shape.bottomProgress;
    const leftTop = edgeX(shape, -1, 0);
    const rightTop = edgeX(shape, 1, 0);
    const leftBottom = edgeX(shape, -1, pBottom);
    const rightBottom = edgeX(shape, 1, pBottom);
    const cx = rail.centerX;

    if (this.laneCount === 4) {
      // 4키: 레일 폭(위·아래 모두 원근 그대로)을 4등분한다. 왼쪽 두 칸은 민트 계열, 오른쪽 두 칸은 핑크 계열
      const xAt = (q: number, p: number): number => rail.centerX + halfWidthAt(shape, p) * (q / 2 - 1);
      for (let lane = 0; lane < 4; lane += 1) {
        const a = lane;
        const b = lane + 1;
        this.addPolygon([xAt(a, 0), top, xAt(b, 0), top, xAt(b, pBottom), bottom, xAt(a, pBottom), bottom], lane < 2 ? colors.leftLane : colors.rightLane, ORDER.rail);
      }
    } else {
      this.addPolygon([leftTop, top, cx, top, cx, bottom, leftBottom, bottom], colors.leftLane, ORDER.rail);
      this.addPolygon([cx, top, rightTop, top, rightBottom, bottom, cx, bottom], colors.rightLane, ORDER.rail);
    }

    const lineColor = colors.cream;
    this.addLine(leftTop, top, leftBottom, bottom, rail.edgeWidth, lineColor);
    this.addLine(rightTop, top, rightBottom, bottom, rail.edgeWidth, lineColor);
    this.addLine(leftTop, top, rightTop, top, rail.edgeWidth * 0.7, lineColor);
    this.addLine(leftBottom, bottom, rightBottom, bottom, rail.edgeWidth * 0.7, lineColor);
    this.addLine(cx, top, cx, bottom, rail.centerLineWidth, lineColor);
    if (this.laneCount === 4) {
      // 4키: 안쪽 구분선 두 줄(가운데 선은 위에서 그렸다)을 가운데 선보다 얇게
      for (const q of [1, 3]) {
        const x0 = rail.centerX + halfWidthAt(shape, 0) * (q / 2 - 1);
        const x1 = rail.centerX + halfWidthAt(shape, pBottom) * (q / 2 - 1);
        this.addLine(x0, top, x1, bottom, rail.centerLineWidth * 0.6, lineColor);
      }
    }
  }

  /** 판정원 두 개를 만든다: 번지는 빛(눌렸을 때만) + 반투명 채움 + 얇은 외곽선. 판정선(order 5)이 위로 지나간다. */
  private buildJudgeCircles(): void {
    const radius = circleStyle.radius;
    const ringGeometry = new THREE.RingGeometry(radius - circleStyle.outlineWidth, radius, CIRCLE_SEGMENTS * 2);
    const discGeometry = new THREE.CircleGeometry(1, CIRCLE_SEGMENTS * 2);
    this.disposables.push(ringGeometry, discGeometry);
    const lanes: Array<{ lane: number; color: number }> =
      this.laneCount === 4
        ? [
            { lane: 0, color: colors.mint },
            { lane: 1, color: colors.mint },
            { lane: 2, color: colors.pink },
            { lane: 3, color: colors.pink },
          ]
        : [
            { lane: 0, color: colors.mint },
            { lane: 1, color: colors.pink },
          ];
    for (const { lane, color } of lanes) {
      const center = judgeCircleCenter(this.shape, lane, this.laneCount);
      const x = center.x;
      const y = PLAY_VIEW.height - center.y;
      const glow = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0 });
      const fill = new THREE.MeshBasicMaterial({ color: colors.black, depthTest: false, depthWrite: false, transparent: true, opacity: circleStyle.fillOpacity });
      const ring = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true });
      this.disposables.push(glow, fill, ring);
      const glowRadius = radius + circleStyle.glowExtra;
      const place = (mesh: THREE.Mesh, order: number, scale: number): void => {
        mesh.position.set(x, y, 0);
        mesh.scale.set(scale, scale, 1);
        mesh.renderOrder = order;
        this.scene.add(mesh);
      };
      place(new THREE.Mesh(discGeometry, glow), ORDER.judgeGlow, glowRadius);
      place(new THREE.Mesh(discGeometry, fill), ORDER.judgeFill, radius);
      place(new THREE.Mesh(ringGeometry, ring), ORDER.judgeRing, 1);
      // 안쪽 작은 원: 노트가 겹쳐야 하는 정확한 지점. 외곽선이 중심이고 채움은 거의 없다
      const innerRadius = radius * circleStyle.innerRadiusRatio;
      const innerRingGeometry = new THREE.RingGeometry(innerRadius - circleStyle.innerOutlineWidth, innerRadius, CIRCLE_SEGMENTS * 2);
      this.disposables.push(innerRingGeometry);
      const innerRing = new THREE.MeshBasicMaterial({ color: colors.cream, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: circleStyle.innerOutlineOpacity });
      const innerFill = new THREE.MeshBasicMaterial({ color: colors.cream, depthTest: false, depthWrite: false, transparent: true, opacity: circleStyle.innerFillOpacity });
      this.disposables.push(innerRing, innerFill);
      place(new THREE.Mesh(discGeometry, innerFill), ORDER.judgeInner, innerRadius);
      place(new THREE.Mesh(innerRingGeometry, innerRing), ORDER.judgeInner, 1);
      this.judgeCircles[lane] = { fill, glow, laneColor: color };
    }
  }

  /** 판정원을 눌린 모양으로 바꾸거나 되돌린다. 눌려도 채움은 pressedOpacity 까지만 올라가서 판정선·노트가 비친다. */
  setLaneDown(lane: number, down: boolean): void {
    const circle = this.judgeCircles[lane];
    if (circle === undefined) return;
    circle.fill.color.setHex(down ? circle.laneColor : colors.black);
    circle.fill.opacity = down ? circleStyle.pressedOpacity : circleStyle.fillOpacity;
    circle.glow.opacity = down ? circleStyle.glowOpacity : 0;
  }

  /** 꼭짓점 목록(x, y 쌍, 화면 좌표)으로 채운 도형을 장면에 붙인다. */
  private addPolygon(points: number[], color: number, order: number): THREE.MeshBasicMaterial {
    const shape = new THREE.Shape();
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i]!;
      const y = PLAY_VIEW.height - points[i + 1]!;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = order;
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
    return material;
  }

  /** 두 점 사이를 지정한 굵기로 잇는 선을 장면에 붙인다. */
  private addLine(x0: number, y0: number, x1: number, y1: number, width: number, color: number): void {
    // 레일 선은 모두 피버 때 색이 바뀌도록 재질을 기억해 둔다
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    const nx = (-dy / length) * (width / 2);
    const ny = (dx / length) * (width / 2);
    this.edgeMaterials.push(this.addPolygon([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny], color, ORDER.railLine));
  }

  /** 노트 그림 풀을 미리 만든다. */
  private buildPool(count: number): void {
    const circle = new THREE.CircleGeometry(1, CIRCLE_SEGMENTS);
    this.disposables.push(circle);
    for (let i = 0; i < count; i += 1) {
      const makeCircle = (material: THREE.Material, order: number): THREE.Mesh => {
        const mesh = new THREE.Mesh(circle, material);
        mesh.renderOrder = order;
        mesh.visible = false;
        this.scene.add(mesh);
        return mesh;
      };
      const barOutline = new DynamicBar(this.blackMat, ORDER.barOutline);
      const bar = new DynamicBar(this.mintMat, ORDER.bar);
      this.scene.add(barOutline.mesh, bar.mesh);
      this.disposables.push(barOutline.geometry, bar.geometry);
      this.slots.push({
        tapOutline: makeCircle(this.blackMat, ORDER.tapOutline),
        tapBody: makeCircle(this.pinkMat, ORDER.tapBody),
        tapCenter: makeCircle(this.creamMat, ORDER.tapCenter),
        barOutline,
        bar,
      });
    }
  }

  /** 그림 한 벌을 숨긴다. */
  private hideSlot(slot: NoteSlot): void {
    slot.tapOutline.visible = false;
    slot.tapBody.visible = false;
    slot.tapCenter.visible = false;
    slot.barOutline.mesh.visible = false;
    slot.bar.mesh.visible = false;
  }

  /** 단타 그림을 놓는다. */
  private placeTap(slot: NoteSlot, note: ChartNote, head: number): void {
    const shape = this.shape;
    const s = scaleAt(shape, head);
    const x = laneCenterX(shape, note.lane as number, head, this.laneCount);
    const y = PLAY_VIEW.height - yAt(shape, head);
    const radius = noteStyle.tapRadius * s;
    const outlineRadius = radius + noteStyle.tapOutline * s;
    slot.tapOutline.position.set(x, y, 0);
    slot.tapOutline.scale.set(outlineRadius, outlineRadius, 1);
    slot.tapBody.position.set(x, y, 0);
    slot.tapBody.scale.set(radius, radius, 1);
    const center = radius * noteStyle.tapCenterRatio;
    slot.tapCenter.position.set(x, y, 0);
    slot.tapCenter.scale.set(center, center, 1);
    slot.tapOutline.visible = true;
    slot.tapBody.visible = true;
    slot.tapCenter.visible = true;
  }

  /**
   * 롱노트를 둥근 긴 막대(캡슐)로 놓는다. 머리 쪽 지름은 단타 원과 같고(원근 반영), 외곽선도 같은 모양으로 두른다.
   * 꼬리가 레일 맨 위 밖이거나 머리가 레일 끝 아래로 지나갔으면 그쪽 끝은 반원 없이 평평하게 잘린다.
   */
  private placeCapsule(slot: NoteSlot, note: ChartNote, state: number, top: number, bottom: number): void {
    const shape = this.shape;
    const lane = note.lane as number;
    const attached = state === NOTE_STATE.holding;
    const broken = state === NOTE_STATE.broken;
    const capTop = this.span.tail >= 0;
    const capBottom = attached || this.span.head <= shape.bottomProgress;
    const topR = noteStyle.tapRadius * scaleAt(shape, top);
    const bottomR = noteStyle.tapRadius * scaleAt(shape, bottom);
    const topY = yAt(shape, top);
    const bottomY = yAt(shape, bottom);
    const topX = laneCenterX(shape, lane, top, this.laneCount);
    const bottomX = laneCenterX(shape, lane, bottom, this.laneCount);
    const outline = noteStyle.barOutline;
    const outlineTop = outline * scaleAt(shape, top);
    const outlineBottom = outline * scaleAt(shape, bottom);
    slot.barOutline.mesh.material = broken ? this.grayOutlineMat : this.blackMat;
    slot.barOutline.setCapsule({
      topX,
      topY: capTop ? topY : topY - outlineTop,
      topR: topR + outlineTop,
      capTop,
      bottomX,
      bottomY: capBottom ? bottomY : bottomY + outlineBottom,
      bottomR: bottomR + outlineBottom,
      capBottom,
    });
    slot.bar.mesh.material = broken ? this.grayMat : this.mintMat;
    const body: CapsuleInput = { topX, topY, topR, capTop, bottomX, bottomY, bottomR, capBottom };
    slot.bar.setCapsule(body);
  }

  /** 롱노트·연타 막대를 놓는다. 연타이면 막대 위 글자 위치를 기록한다. */
  private placeBar(slot: NoteSlot, note: ChartNote, state: number, noteIndex: number, fallTimeMs: number): void {
    const shape = this.shape;
    const range = this.range;
    const top = range.top;
    const bottom = range.bottom;
    const isBurst = note.type === 'burst';
    const widthRatio = isBurst ? noteStyle.burstWidthRatio : noteStyle.holdWidthRatio;
    const topHalf = halfWidthAt(shape, top);
    const bottomHalf = halfWidthAt(shape, bottom);
    // 롱노트는 레인 가운데, 연타는 레일 전체 폭
    const lane = isBurst ? 0 : (note.lane as number);
    const topCenter = isBurst ? shape.config.centerX : laneCenterX(shape, lane, top, this.laneCount);
    const bottomCenter = isBurst ? shape.config.centerX : laneCenterX(shape, lane, bottom, this.laneCount);
    const topWidth = isBurst ? topHalf * widthRatio : (topHalf * widthRatio) / 2;
    const bottomWidth = isBurst ? bottomHalf * widthRatio : (bottomHalf * widthRatio) / 2;
    const topY = yAt(shape, top);
    const bottomY = yAt(shape, bottom);

    if (!isBurst) {
      this.placeCapsule(slot, note, state, top, bottom);
      return;
    }
    const outline = noteStyle.barOutline;
    const outlineTop = outline * scaleAt(shape, top);
    const outlineBottom = outline * scaleAt(shape, bottom);
    const broken = state === NOTE_STATE.broken;
    slot.barOutline.mesh.material = broken ? this.grayOutlineMat : this.blackMat;
    slot.barOutline.setQuad(
      topCenter - topWidth - outlineTop,
      topCenter + topWidth + outlineTop,
      topY - outlineTop,
      bottomCenter - bottomWidth - outlineBottom,
      bottomCenter + bottomWidth + outlineBottom,
      bottomY + outlineBottom,
      0,
      0,
    );
    // 연타 줄무늬는 노트 자신의 시간에 붙어서 내려오게 한다 (머리 기준 시간 ÷ 한 타일 시간)
    let v0 = 0;
    let v1 = 0;
    if (isBurst) {
      const head = this.span.head;
      v0 = ((head - top) * fallTimeMs) / noteStyle.stripeTileMs;
      v1 = ((head - bottom) * fallTimeMs) / noteStyle.stripeTileMs;
      slot.bar.mesh.material = this.stripeMat;
    } else {
      slot.bar.mesh.material = broken ? this.grayMat : this.mintMat;
    }
    slot.bar.setQuad(topCenter - topWidth, topCenter + topWidth, topY, bottomCenter - bottomWidth, bottomCenter + bottomWidth, bottomY, v0, v1);

    if (isBurst && this.burstAnchors.count < this.burstAnchors.noteIndex.length) {
      const n = this.burstAnchors.count;
      this.burstAnchors.noteIndex[n] = noteIndex;
      this.burstAnchors.x[n] = shape.config.centerX;
      this.burstAnchors.y[n] = (topY + bottomY) / 2;
      this.burstAnchors.count = n + 1;
    }
  }

  /** 한 프레임을 그린다. states 는 노트마다의 화면 상태(NOTE_STATE). */
  render(songMs: number, visualOffsetMs: number, fallTimeMs: number, visible: VisibleNotes, states: Uint8Array, nowMs: number, dtMs: number): void {
    const bottomProgress = this.shape.bottomProgress;
    this.burstAnchors.count = 0;
    let used = 0;
    for (let k = 0; k < visible.count; k += 1) {
      const noteIndex = visible.indices[k]!;
      const state = states[noteIndex]!;
      if (state === NOTE_STATE.done) continue;
      const note = this.notes[noteIndex]!;
      fillNoteSpan(this.span, note, songMs, visualOffsetMs, fallTimeMs);
      const slot = this.slots[used];
      if (slot === undefined) break;
      if (note.type === 'tap') {
        if (!isTapVisible(this.span.head, bottomProgress)) continue;
        this.hideSlot(slot);
        this.placeTap(slot, note, this.span.head);
      } else {
        if (!fillBarRange(this.range, note.type, state as 0 | 1 | 2 | 3, this.span, bottomProgress)) continue;
        this.hideSlot(slot);
        this.placeBar(slot, note, state, noteIndex, fallTimeMs);
      }
      used += 1;
    }
    for (let i = used; i < this.usedLastFrame; i += 1) this.hideSlot(this.slots[i]!);
    this.usedLastFrame = used;
    if (used > this.peakUsed) this.peakUsed = used;
    this.effects.update(nowMs, dtMs);
    this.renderer.render(this.scene, this.camera);
  }

  /** 피버 중 레일 테두리가 은은하게 빛난다: strength 0~1 (0 이면 원래 색). 색은 한 가지(밝은 핑크)로 깜빡이지 않는다 */
  setFeverGlow(strength: number): void {
    this.feverColor.copy(this.creamColor).lerp(this.glowColor, strength * EFFECT_CONFIG.fever.railStrength);
    for (const material of this.edgeMaterials) material.color.copy(this.feverColor);
  }

  /** 그림을 모두 숨기고 한 번 그린다 (다시하기). */
  clear(): void {
    for (const slot of this.slots) this.hideSlot(slot);
    this.usedLastFrame = 0;
    this.burstAnchors.count = 0;
    this.effects.clear();
    this.setFeverGlow(0);
    for (let lane = 0; lane < this.laneCount; lane += 1) this.setLaneDown(lane, false);
    this.renderer.render(this.scene, this.camera);
  }

  /** 쓴 자원을 모두 풀어 준다. (화면을 나갈 때) */
  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.effects.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
