// 판정 이펙트 그리기 (Three.js): 빛기둥, 충격파 링, 별 반짝임, 롱노트 지속 이펙트, 연타 이펙트.
// 모두 풀(미리 만든 그림 묶음)에서 꺼내 쓰고 프레임마다 새 객체를 만들지 않는다. 계산은 effectLogic.ts 의 순수 함수를 쓴다.
import * as THREE from 'three';
import type { Grade } from './core/config/gameConfig';
import { EFFECT_CONFIG, type EffectLevel } from './effectConfig';
import { EffectPool, easeOutExpand, easeOutFade, hasHitFx, planHitFx, progressOf, radialStarSpawn, ringRadiusAt, type PooledEffect } from './effectLogic';
import { PLAY_CONFIG, PLAY_VIEW } from './playConfig';
import { laneCenterX, type RailShape } from './railGeometry';

const STAR_COLORS = [0xfbf3e8, 0xfb4ea1, 0x76f0b8] as const;
/** 연타 효과의 링은 납작한 타원(레일 전체용), 판정 링은 정원 */
const RING_SQUASH = 0.42;
const CIRCLE = PLAY_CONFIG.judgeCircle;
/** 링이 퍼지기 시작하는 반지름 = 안쪽 작은 원 */
const RING_START_RADIUS = CIRCLE.radius * CIRCLE.innerRadiusRatio;
const ORDER = { holdLoop: 19, beam: 20, ring: 21, star: 22 } as const;

interface BeamFx extends PooledEffect {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  x: number;
  width: number;
  height: number;
  durationMs: number;
}

interface RingFx extends PooledEffect {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  x: number;
  radius: number;
  durationMs: number;
  /** 세로 눌림 비율 (1 = 정원) */
  squash: number;
  /** 밝기 (0~1) */
  brightness: number;
  /** 시작 반지름 */
  startRadius: number;
}

interface StarFx extends PooledEffect {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  gravity: number;
  size: number;
  lifeMs: number;
}

/** 이펙트 풀 사용 기록 (점검·측정용) */
export interface EffectStats {
  beams: { size: number; peak: number; stolen: number };
  rings: { size: number; peak: number; stolen: number };
  stars: { size: number; peak: number; stolen: number };
}

/** 위쪽이 투명하게 사라지는 빛기둥 무늬 */
function makeBeamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createLinearGradient(0, 64, 0, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 8, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 네 갈래 별 모양 */
function makeStarGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const outer = 1;
  const inner = 0.28;
  for (let i = 0; i < 8; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export class EffectsRenderer {
  private readonly beams: EffectPool<BeamFx>;
  private readonly rings: EffectPool<RingFx>;
  private readonly stars: EffectPool<StarFx>;
  private readonly holdBeams: THREE.Mesh[] = [];
  private readonly holdRings: THREE.Mesh[] = [];
  /** 롱노트 틱 링이 사라지는 시각 (고정 크기 배열, 새로 만들지 않고 돌려 씀) */
  private readonly tickRingExpiry: number[] = new Array<number>(EFFECT_CONFIG.holdTick.maxActive).fill(-Infinity);
  private tickRingCursor = 0;
  private tickCounter = 0;
  private readonly holdActive: boolean[] = [false, false, false, false];
  /** 레인 수 (2키 2 / 4키 4) */
  private readonly laneCount: number;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly peak = { beams: 0, rings: 0, stars: 0 };
  private level: EffectLevel;
  private starCursor = 0;

  private readonly scene: THREE.Scene;
  private readonly shape: RailShape;

  constructor(
    scene: THREE.Scene,
    shape: RailShape,
    level: EffectLevel,
    laneCount: number = 2,
  ) {
    this.laneCount = laneCount;
    this.scene = scene;
    this.shape = shape;
    this.level = level;
    const beamTexture = makeBeamTexture();
    const beamGeometry = new THREE.PlaneGeometry(1, 1);
    const ringGeometry = new THREE.RingGeometry(0.86, 1, 56);
    const starGeometry = makeStarGeometry();
    this.disposables.push(beamTexture, beamGeometry, ringGeometry, starGeometry);

    const makeMaterial = (map: THREE.Texture | null): THREE.MeshBasicMaterial => {
      const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      this.disposables.push(material);
      return material;
    };
    const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, order: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = order;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    };

    const { pools } = EFFECT_CONFIG;
    this.beams = new EffectPool<BeamFx>(pools.beams, () => {
      const material = makeMaterial(beamTexture);
      return { active: false, startMs: 0, mesh: addMesh(beamGeometry, material, ORDER.beam), material, x: 0, width: 0, height: 0, durationMs: 1 };
    });
    this.rings = new EffectPool<RingFx>(pools.rings, () => {
      const material = makeMaterial(null);
      return { active: false, startMs: 0, mesh: addMesh(ringGeometry, material, ORDER.ring), material, x: 0, radius: 0, durationMs: 1, squash: 1, brightness: 1, startRadius: 0 };
    });
    this.stars = new EffectPool<StarFx>(pools.stars, () => {
      const material = makeMaterial(null);
      return { active: false, startMs: 0, mesh: addMesh(starGeometry, material, ORDER.star), material, x: 0, y: 0, vx: 0, vy: 0, spin: 0, gravity: 0, size: 0, lifeMs: 1 };
    });
    for (let lane = 0; lane < laneCount; lane += 1) {
      const beamMaterial = makeMaterial(beamTexture);
      beamMaterial.color.setHex(EFFECT_CONFIG.grades.great.color);
      this.holdBeams.push(addMesh(beamGeometry, beamMaterial, ORDER.holdLoop));
      const ringMaterial = makeMaterial(null);
      ringMaterial.color.setHex(EFFECT_CONFIG.grades.great.color);
      this.holdRings.push(addMesh(ringGeometry, ringMaterial, ORDER.holdLoop));
    }
  }

  /** 이펙트 양을 바꾼다. */
  setLevel(level: EffectLevel): void {
    this.level = level;
  }

  /** 레인 가운데의 판정선 x (lane 이 'both' 이면 레일 가운데) */
  private laneX(lane: number | 'both'): number {
    return lane === 'both' ? this.shape.config.centerX : laneCenterX(this.shape, lane, 1, this.laneCount);
  }

  private spawnBeam(x: number, width: number, height: number, durationMs: number, color: number, nowMs: number): void {
    const fx = this.beams.acquire(nowMs);
    fx.x = x;
    fx.width = width;
    fx.height = height;
    fx.durationMs = durationMs;
    fx.material.color.setHex(color);
    fx.mesh.visible = true;
  }

  private spawnRing(x: number, radius: number, durationMs: number, color: number, nowMs: number, delayMs = 0, round = false, brightness = 1): void {
    const fx = this.rings.acquire(nowMs + delayMs);
    fx.x = x;
    fx.radius = radius;
    fx.durationMs = durationMs;
    fx.squash = round ? 1 : RING_SQUASH;
    fx.brightness = brightness;
    fx.startRadius = round ? RING_START_RADIUS : radius * 0.15;
    fx.material.color.setHex(color);
    fx.mesh.visible = delayMs === 0;
  }

  private spawnStars(x: number, count: number, speedScale: number, nowMs: number): void {
    const cfg = EFFECT_CONFIG.star;
    for (let i = 0; i < count; i += 1) {
      const fx = this.stars.acquire(nowMs);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const speed = (cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin)) * speedScale;
      fx.x = x + (Math.random() - 0.5) * 30;
      fx.y = this.shape.config.judgeY;
      fx.vx = Math.cos(angle) * speed;
      fx.vy = Math.sin(angle) * speed;
      fx.gravity = cfg.gravity;
      fx.size = cfg.size;
      fx.lifeMs = cfg.lifeMs;
      fx.spin = (Math.random() - 0.5) * 8;
      this.starCursor = (this.starCursor + 1) % STAR_COLORS.length;
      fx.material.color.setHex(STAR_COLORS[this.starCursor]!);
      fx.mesh.visible = true;
    }
  }

  /** 판정 별: 판정원 둘레에서 바깥으로 방사형으로 터진다. */
  private spawnRadialStars(x: number, count: number, nowMs: number): void {
    const cfg = EFFECT_CONFIG.radialStar;
    for (let i = 0; i < count; i += 1) {
      const fx = this.stars.acquire(nowMs);
      const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
      const spawn = radialStarSpawn(i, count, Math.random(), CIRCLE.radius, speed);
      fx.x = x + spawn.dx;
      fx.y = this.shape.config.judgeY + spawn.dy;
      fx.vx = spawn.vx;
      fx.vy = spawn.vy;
      fx.gravity = 0;
      fx.size = cfg.size;
      fx.lifeMs = cfg.lifeMs;
      fx.spin = (Math.random() - 0.5) * 8;
      this.starCursor = (this.starCursor + 1) % STAR_COLORS.length;
      fx.material.color.setHex(STAR_COLORS[this.starCursor]!);
      fx.mesh.visible = true;
    }
  }

  /** 판정이 났다: 해당 판정원에 원형 링·짧은 빛기둥·방사형 별. MISS 는 이펙트 없음. */
  hit(lane: number, grade: Grade, nowMs: number): void {
    if (!hasHitFx(grade)) return;
    const fx = EFFECT_CONFIG.grades[grade];
    const plan = planHitFx(fx, this.level);
    const x = this.laneX(lane);
    this.spawnBeam(x, CIRCLE.radius * 1.1 * fx.beamWidth, fx.beamHeight, fx.beamMs, fx.color, nowMs);
    // 링은 조금씩 늦게 겹쳐 퍼진다 (바깥 링일수록 먼저)
    for (let i = 0; i < plan.rings; i += 1) {
      this.spawnRing(x, fx.ringRadius * (1 - i * 0.14), fx.ringMs, fx.color, nowMs, i * 55, true, fx.ringBrightness);
    }
    this.spawnRadialStars(x, plan.stars, nowMs);
  }

  /** 연타를 한 번 눌렀다: 작은 링. */
  burstPress(nowMs: number): void {
    const cfg = EFFECT_CONFIG.burst;
    this.spawnRing(this.laneX('both'), cfg.pressRingRadius, cfg.pressRingMs, EFFECT_CONFIG.grades.great.color, nowMs);
  }

  /** 연타 성공: 레일 전체에 큰 빛기둥·링·별이 터진다. */
  burstSuccess(nowMs: number): void {
    const cfg = EFFECT_CONFIG.burst;
    const mul = EFFECT_CONFIG.levels[this.level];
    const x = this.laneX('both');
    this.spawnBeam(x, this.shape.config.judgeWidth * 0.5, cfg.successBeamHeight, 520, EFFECT_CONFIG.grades.perfect.color, nowMs);
    const rings = Math.max(1, Math.round(cfg.successRings * mul.rings));
    for (let i = 0; i < rings; i += 1) {
      this.spawnRing(x, cfg.successRingRadius * (1 - i * 0.3), 560, i % 2 === 0 ? 0xfb4ea1 : 0x76f0b8, nowMs);
    }
    this.spawnStars(x, Math.round(cfg.successStars * mul.stars), 1.4, nowMs);
  }

  /**
   * 롱노트 틱 하나 (04-H): 판정원에 작은 링 하나. 빛기둥·별·글자는 없다.
   * 동시에 보이는 틱 링은 maxActive 개까지만 (넘으면 이번 틱은 그리지 않음). 이펙트 양 "적게"에서는 두 번에 한 번만 그린다.
   */
  holdTick(lane: number, nowMs: number): void {
    const cfg = EFFECT_CONFIG.holdTick;
    this.tickCounter += 1;
    if (this.level === 'low' && this.tickCounter % cfg.lowEvery !== 0) return;
    let active = 0;
    for (let i = 0; i < this.tickRingExpiry.length; i += 1) {
      if (this.tickRingExpiry[i]! > nowMs) active += 1;
    }
    if (active >= cfg.maxActive) return;
    this.tickRingExpiry[this.tickRingCursor] = nowMs + cfg.ringMs;
    this.tickRingCursor = (this.tickRingCursor + 1) % this.tickRingExpiry.length;
    this.spawnRing(this.laneX(lane), cfg.ringRadius, cfg.ringMs, cfg.color, nowMs, 0, true, cfg.ringBrightness);
  }

  /** 롱노트를 잡기 시작했다: 판정선에 지속 이펙트를 켠다. */
  holdStart(lane: number): void {
    this.holdActive[lane] = true;
  }

  /** 롱노트를 놓았다 (끝났거나 중간에 뗌): 지속 이펙트를 끈다. */
  holdEnd(lane: number): void {
    this.holdActive[lane] = false;
    const beam = this.holdBeams[lane];
    const ring = this.holdRings[lane];
    if (beam !== undefined) beam.visible = false;
    if (ring !== undefined) ring.visible = false;
  }

  /** 한 프레임 진행: 쓰이는 이펙트만 갱신하고, 끝난 것은 숨긴다. */
  update(nowMs: number, dtMs: number): void {
    const judgeY = this.shape.config.judgeY;
    const viewH = PLAY_VIEW.height;
    for (const fx of this.beams.items) {
      if (!fx.active) continue;
      const p = progressOf(nowMs, fx.startMs, fx.durationMs);
      if (p >= 1) {
        fx.active = false;
        fx.mesh.visible = false;
        continue;
      }
      const height = fx.height * (0.6 + 0.4 * easeOutExpand(p));
      const width = fx.width * (1 - 0.45 * p);
      fx.material.opacity = easeOutFade(p) * EFFECT_CONFIG.beamFade;
      fx.mesh.scale.set(width, height, 1);
      fx.mesh.position.set(fx.x, viewH - judgeY + height / 2, 0);
    }
    for (const fx of this.rings.items) {
      if (!fx.active) continue;
      const p = progressOf(nowMs, fx.startMs, fx.durationMs);
      if (nowMs < fx.startMs) continue;
      if (p >= 1) {
        fx.active = false;
        fx.mesh.visible = false;
        continue;
      }
      const radius = ringRadiusAt(fx.startRadius, fx.radius, p);
      fx.material.opacity = easeOutFade(p) * fx.brightness;
      fx.mesh.scale.set(radius, radius * fx.squash, 1);
      fx.mesh.position.set(fx.x, viewH - judgeY, 0);
      fx.mesh.visible = true;
    }
    const dt = Math.min(dtMs, 50) / 1000;
    for (const fx of this.stars.items) {
      if (!fx.active) continue;
      const p = progressOf(nowMs, fx.startMs, fx.lifeMs);
      if (p >= 1) {
        fx.active = false;
        fx.mesh.visible = false;
        continue;
      }
      fx.vy += fx.gravity * dt;
      fx.x += fx.vx * dt;
      fx.y += fx.vy * dt;
      const size = fx.size * (1 - 0.7 * p);
      fx.material.opacity = easeOutFade(p * 0.9);
      fx.mesh.scale.set(size, size, 1);
      fx.mesh.rotation.z += fx.spin * dt;
      fx.mesh.position.set(fx.x, viewH - fx.y, 0);
    }
    for (let lane = 0; lane < this.laneCount; lane += 1) {
      if (!this.holdActive[lane]) continue;
      const loop = EFFECT_CONFIG.holdLoop;
      const pulse = 0.5 + 0.5 * Math.sin((nowMs / loop.pulseMs) * Math.PI * 2);
      const x = this.laneX(lane);
      const beam = this.holdBeams[lane]!;
      const beamMaterial = beam.material as THREE.MeshBasicMaterial;
      beamMaterial.opacity = 0.55 + 0.35 * pulse;
      const height = loop.beamHeight * (0.85 + 0.15 * pulse);
      beam.scale.set(CIRCLE.radius * 0.9, height, 1);
      beam.position.set(x, viewH - judgeY + height / 2, 0);
      beam.visible = true;
      const ring = this.holdRings[lane]!;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * pulse;
      const radius = loop.ringRadius * (0.9 + 0.2 * pulse);
      ring.scale.set(radius, radius, 1);
      ring.position.set(x, viewH - judgeY, 0);
      ring.visible = true;
    }
    this.peak.beams = Math.max(this.peak.beams, this.beams.activeCount);
    this.peak.rings = Math.max(this.peak.rings, this.rings.activeCount);
    this.peak.stars = Math.max(this.peak.stars, this.stars.activeCount);
  }

  /** 모든 이펙트를 즉시 끈다. (다시하기·일시정지) */
  clear(): void {
    for (const pool of [this.beams, this.rings, this.stars] as Array<EffectPool<PooledEffect & { mesh: THREE.Mesh }>>) {
      pool.releaseAll();
      for (const fx of pool.items) fx.mesh.visible = false;
    }
    for (let lane = 0; lane < this.laneCount; lane += 1) this.holdEnd(lane);
  }

  /** 풀 크기와 동시 사용 최대치 (점검·측정용) */
  stats(): EffectStats {
    return {
      beams: { size: this.beams.size, peak: this.peak.beams, stolen: this.beams.stolen },
      rings: { size: this.rings.size, peak: this.peak.rings, stolen: this.rings.stolen },
      stars: { size: this.stars.size, peak: this.peak.stars, stolen: this.stars.stolen },
    };
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
  }
}
