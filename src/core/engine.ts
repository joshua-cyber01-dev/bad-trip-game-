// Renderer, quality tiers, dynamic resolution and the single-pass "trip" post effect.
import * as THREE from 'three';

/** Post-processing parameters. Levels write these every frame. */
export class Fx {
  wobble = 0;
  kal = 0;
  seg = 6;
  chroma = 0.15;
  hue = 0;
  sat = 1;
  vig = 0.9;
  grain = 0.06;
  dbl = 0;
  flash = 0;
  fade = 0;
  swirl = 0;
  tint = new THREE.Color(1, 1, 1);
  tintAmt = 0;
  reset() {
    this.wobble = 0; this.kal = 0; this.seg = 6; this.chroma = 0.15; this.hue = 0; this.sat = 1;
    this.vig = 0.9; this.grain = 0.06; this.dbl = 0; this.fade = 0; this.swirl = 0; this.tintAmt = 0;
  }
}

export interface Tier { name: string; dpr: number; pixels: number; shadows: boolean; particles: number; lights: number }

export const TIERS: Tier[] = [
  { name: 'Niedrig', dpr: 1, pixels: 0.7e6, shadows: false, particles: 0.35, lights: 1 },
  { name: 'Mittel', dpr: 1.5, pixels: 1.4e6, shadows: false, particles: 0.7, lights: 2 },
  { name: 'Hoch', dpr: 2, pixels: 2.4e6, shadows: true, particles: 1, lights: 3 },
];

/** Rough first guess; the dynamic scaler corrects it while playing. */
export function guessTier(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory || 4;
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (ios) return window.devicePixelRatio >= 3 ? 2 : 1;
  if (cores <= 4 || mem <= 2) return 0;
  if (cores >= 8 && mem >= 6) return 2;
  return 1;
}

const POST_FRAG = /* glsl */ `
uniform sampler2D tD;
uniform float uTime, uWobble, uKal, uSeg, uChroma, uHue, uSat, uVig, uGrain, uDbl, uFlash, uFade, uSwirl, uAspect, uTintAmt;
uniform vec3 uTint;
varying vec2 vUv;
vec3 hueRot(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  uv += uWobble * 0.011 * vec2(sin(uv.y * 9.0 + uTime * 1.3), cos(uv.x * 7.0 + uTime * 1.1));
  vec2 p = uv - 0.5;
  float r = length(p * vec2(uAspect, 1.0));
  if (uSwirl > 0.001) {
    float a = uSwirl * 0.35 * r * sin(uTime * 0.31);
    float s = sin(a), c = cos(a);
    p = mat2(c, -s, s, c) * p;
    uv = p + 0.5;
  }
  vec2 dir = p * uChroma * 0.022;
  vec3 col;
  col.g = texture2D(tD, uv).g;
  col.r = texture2D(tD, uv + dir).r;
  col.b = texture2D(tD, uv - dir).b;
  if (uKal > 0.004) {
    vec2 q = p * vec2(uAspect, 1.0);
    float seg = 6.2831853 / uSeg;
    float a = mod(atan(q.y, q.x) + uTime * 0.12, seg);
    a = abs(a - seg * 0.5);
    vec2 k = vec2(cos(a), sin(a)) * length(q);
    k.x /= uAspect;
    col = mix(col, texture2D(tD, clamp(k + 0.5, 0.002, 0.998)).rgb, uKal);
  }
  if (uDbl > 0.004) {
    vec2 o = vec2(0.028 * sin(uTime * 0.7), 0.012 * cos(uTime * 0.53)) * uDbl;
    col = mix(col, texture2D(tD, uv + o).rgb, 0.45);
  }
  col = hueRot(col, uHue);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  col = mix(col, col * uTint, uTintAmt);
  col *= 1.0 - smoothstep(0.25, 0.95, r) * uVig * 0.85;
  // soft filmic shoulder: bright lamps roll off instead of clipping
  col = 1.0 - exp(-max(col, 0.0) * 1.5);
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  // grain is added in display space so it stays subtle in the dark (and hides banding)
  gl_FragColor.rgb += (hash(vUv * 811.0 + fract(uTime) * 37.0) - 0.5) * uGrain;
  gl_FragColor.rgb *= 1.0 - uFade;
}`;

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 2, 0.08, 80);
  fx = new Fx();
  tierIndex = 1;
  auto = true;
  dyn = 1; // dynamic resolution factor 0.5..1
  targetFps = 60;
  fps = 60;
  scale = 1;
  onTierChange?: (t: number) => void;

  private rt: THREE.WebGLRenderTarget;
  private post: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private ema = 16.7;
  private evalT = 0;
  private good = 0;
  private bad = 0;
  private upCooldown = 4;
  private time = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false, depth: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false;
    // HDR-ish buffer where supported (no banding in the dark); 8-bit fallback for old GPUs
    const ext = this.renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true });
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    const u = (v: unknown) => ({ value: v });
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tD: u(this.rt.texture), uTime: u(0), uWobble: u(0), uKal: u(0), uSeg: u(6), uChroma: u(0), uHue: u(0), uSat: u(1),
        uVig: u(1), uGrain: u(0), uDbl: u(0), uFlash: u(0), uFade: u(0), uSwirl: u(0), uAspect: u(2), uTintAmt: u(0),
        uTint: u(this.fx.tint),
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const m = new THREE.Mesh(tri, this.post);
    m.frustumCulled = false;
    this.postScene.add(m);
    this.scene.add(this.camera);
    this.camera.rotation.order = 'YXZ';
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();
  }

  get tier(): Tier { return TIERS[this.tierIndex]; }

  setQuality(q: 'auto' | 'low' | 'mid' | 'high') {
    this.auto = q === 'auto';
    this.tierIndex = q === 'auto' ? guessTier() : q === 'low' ? 0 : q === 'mid' ? 1 : 2;
    this.dyn = 1;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    let s = Math.min(window.devicePixelRatio || 1, this.tier.dpr) * this.dyn;
    const px = w * h * s * s;
    if (px > this.tier.pixels) s *= Math.sqrt(this.tier.pixels / px);
    this.scale = s;
    const rw = Math.max(2, Math.round(w * s)), rh = Math.max(2, Math.round(h * s));
    this.renderer.setSize(rw, rh, false);
    this.rt.setSize(rw, rh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.uniforms.uAspect.value = w / h;
  }

  /** Feed real frame time; adapts resolution (and tier in auto mode) to hold the target FPS. */
  adapt(dtMs: number) {
    this.ema += (Math.min(dtMs, 100) - this.ema) * 0.08;
    this.fps = 1000 / this.ema;
    this.evalT += dtMs;
    if (this.evalT < 1000) return;
    this.evalT = 0;
    const budget = 1000 / this.targetFps;
    if (this.ema > budget * 1.22) {
      this.good = 0;
      this.bad++;
      if (this.dyn > 0.5) {
        this.dyn = Math.max(0.5, this.dyn - 0.1);
        this.upCooldown = Math.min(30, this.upCooldown * 1.5);
        this.resize();
      } else if (this.auto && this.bad > 3 && this.tierIndex > 0) {
        this.tierIndex--;
        this.dyn = 0.8;
        this.bad = 0;
        this.resize();
        this.onTierChange?.(this.tierIndex);
      }
    } else if (this.ema < budget * 1.06) {
      this.bad = 0;
      if (++this.good >= this.upCooldown && this.dyn < 1) {
        this.good = 0;
        this.dyn = Math.min(1, this.dyn + 0.1);
        this.resize();
      }
    } else {
      this.good = 0;
      this.bad = 0;
    }
  }

  compile() {
    this.renderer.shadowMap.enabled = this.tier.shadows;
    this.renderer.compile(this.scene, this.camera);
  }

  render(dt: number) {
    this.time += dt;
    const f = this.fx, u = this.post.uniforms;
    u.uTime.value = this.time % 1000;
    u.uWobble.value = f.wobble; u.uKal.value = f.kal; u.uSeg.value = f.seg; u.uChroma.value = f.chroma;
    u.uHue.value = f.hue % 6.2831853; u.uSat.value = f.sat; u.uVig.value = f.vig; u.uGrain.value = f.grain;
    u.uDbl.value = f.dbl; u.uFlash.value = f.flash; u.uFade.value = Math.min(1, f.fade); u.uSwirl.value = f.swirl;
    u.uTintAmt.value = f.tintAmt;
    this.renderer.info.reset();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }

  get drawCalls() { return this.renderer.info.render.calls; }
}
