import './style.css';
import { Engine } from './core/engine';
import { Input } from './core/input';
import { Player } from './core/player';
import { AudioSys } from './core/audio';
import { DEFAULT_SETTINGS, load, save, type Progress, type Settings } from './core/storage';
import { UI } from './ui/ui';
import { LEVELS } from './levels';
import type { Ctx, Level, LevelMeta } from './levels/base';

type State = 'menu' | 'intro' | 'play' | 'pause' | 'dying' | 'end';

class Game implements Ctx {
  settings: Settings = load('settings', DEFAULT_SETTINGS);
  progress: Progress = load('progress', { done: {} });
  engine = new Engine(document.getElementById('gl') as HTMLCanvasElement);
  player = new Player();
  audio = new AudioSys();
  fx = this.engine.fx;
  sanity = 1;
  ui: UI;
  input: Input;
  state: State = 'menu';
  level: Level | null = null;
  meta: LevelMeta | null = null;
  elapsed = 0;

  private last = 0;
  private acc = 0;
  private flashV = 0;
  private dieT = 0;
  private dieReason = '';
  private fadeIn = 0;
  private hudT = 0;
  private running = false;
  private broken = false;

  constructor() {
    this.settings.layout = { ...DEFAULT_SETTINGS.layout, ...this.settings.layout };
    this.ui = new UI(document.getElementById('ui')!, this.settings, this.progress, LEVELS, {
      onStart: (m) => this.start(m),
      onBegin: () => this.begin(),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onQuit: () => this.quit(),
      onRetry: () => { if (this.meta) this.start(this.meta); },
      onSettings: () => this.applySettings(),
      onGesture: () => { this.audio.unlock(); this.audio.ui(); },
    });
    this.input = new Input(this.ui.layer, this.ui.joy, this.ui.knob, this.ui.btn, this.settings);
    this.input.onPause = () => this.pause();
    this.ui.onLayoutEdit = (e) => { this.input.editing = e; };
    this.engine.setQuality(this.settings.quality);
    this.applySettings();
    this.ui.show('title');

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.state === 'play') this.pause(); this.audio.suspend(); }
      else if (this.state !== 'pause') this.audio.resume();
    });
    window.addEventListener('pagehide', () => this.audio.suspend());
  }

  // ------------------------------------------------------------ Ctx
  objective(t: string, c?: string) { this.ui.objective(t, c); }
  toast(t: string, ms?: number) { this.ui.toast(t, ms); }
  timer(s: number | null) { this.ui.timer(s); }
  status(t: string | null) { this.ui.status(t); }
  hurt(a: number) { this.sanity = Math.max(0, this.sanity - a); if (this.sanity <= 0) this.broken = true; }
  heal(a: number) { this.sanity = Math.min(1, this.sanity + a); }
  buzz(ms: number | number[]) { this.input.buzz(ms); }
  flash(a: number) { this.flashV = Math.max(this.flashV, a); }

  win() {
    if (this.state !== 'play' || !this.meta) return;
    const prev = this.progress.done[this.meta.id];
    if (prev === undefined || this.elapsed < prev) this.progress.done[this.meta.id] = Math.round(this.elapsed);
    save('progress', this.progress);
    this.audio.chime();
    this.finish(true, 'Die Wirkung lässt nach. Dein Herz schlägt. Du bist zurück – dieses Mal.');
  }

  lose(reason: string) {
    if (this.state !== 'play' && this.state !== 'dying') return;
    this.audio.chime(false);
    this.finish(false, reason);
  }

  caught(x: number, z: number, reason: string) {
    if (this.state !== 'play') return;
    this.state = 'dying';
    this.dieT = 1.25;
    this.dieReason = reason;
    const p = this.player;
    p.frozen = true;
    p.yaw = Math.atan2(-(x - p.x), -(z - p.z));
    p.pitch = Math.atan2(0.32, Math.max(0.7, Math.hypot(x - p.x, z - p.z))); // look it in the face
    this.flashV = 0.9;
    this.audio.stinger(true);
    this.input.buzz([200, 60, 300]);
    this.input.enabled = false;
  }

  // ------------------------------------------------------------ flow
  private applySettings() {
    const s = this.settings;
    const wanted = s.quality;
    if ((wanted === 'auto') !== this.engine.auto || (wanted !== 'auto' && ['low', 'mid', 'high'][this.engine.tierIndex] !== wanted)) {
      this.engine.setQuality(wanted);
    }
    this.engine.targetFps = s.fps;
    this.audio.setVolume(s.volume);
  }

  private start(meta: LevelMeta) {
    this.audio.unlock();
    this.unload();
    this.meta = meta;
    this.state = 'intro';
    this.ui.wipe();
    this.ui.setLoading('Wirkung setzt ein …');
    this.ui.show('loading');
    this.tryFullscreen();
    // let the loading screen paint before the (short) synchronous build
    setTimeout(() => {
      const t0 = performance.now();
      this.sanity = 1;
      this.broken = false;
      this.elapsed = 0;
      this.fx.reset();
      this.fx.flash = 0;
      this.ui.resetHud();
      const lv = this.level = meta.create(this);
      lv.build();
      this.player.place(lv.spawn.x, lv.spawn.z, lv.spawn.yaw);
      this.player.apply(this.engine.camera);
      this.engine.compile();
      this.fx.fade = 1;
      this.engine.render(0);
      console.info(`[bad trip] ${meta.id} built in ${(performance.now() - t0).toFixed(0)} ms`);
      this.ui.showIntro(meta);
    }, 60);
  }

  private begin() {
    if (this.state !== 'intro' || !this.level) return;
    this.audio.unlock();
    this.audio.startLevel(this.level.audio);
    this.input.reset();
    this.input.enabled = true;
    this.state = 'play';
    this.fadeIn = 1;
    this.ui.show('hud');
    this.loopStart();
  }

  private pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.suspend();
    this.ui.show('pause');
  }

  private resume() {
    if (this.state !== 'pause') return;
    this.state = 'play';
    this.input.enabled = true;
    this.audio.resume();
    this.ui.show('hud');
    this.loopStart();
  }

  private finish(win: boolean, text: string) {
    this.state = 'end';
    this.input.enabled = false;
    this.input.releaseAll();
    this.audio.stopLevel();
    this.ui.renderCards();
    this.ui.showEnd(win, text, this.elapsed, this.meta ? this.progress.done[this.meta.id] : undefined);
  }

  private quit() {
    this.audio.resume();
    this.unload();
    this.state = 'menu';
    this.ui.show('select');
  }

  private unload() {
    this.audio.stopLevel();
    this.input.enabled = false;
    this.level?.dispose();
    this.level = null;
    this.engine.renderer.renderLists.dispose();
  }

  private tryFullscreen() {
    // Android/desktop only – iOS gets full screen through the installed PWA.
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (!document.fullscreenElement && el.requestFullscreen && matchMedia('(pointer: coarse)').matches) {
        void el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          void o.lock?.('landscape').catch(() => undefined);
        }).catch(() => undefined);
      }
    } catch { /* not allowed */ }
  }

  // ------------------------------------------------------------ loop
  private loopStart() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    // The render loop only runs while actually playing: menus and pause cost no GPU time.
    if (this.state !== 'play' && this.state !== 'dying') {
      this.running = false;
      if (this.state === 'end') this.step(16); // one dimmed still frame behind the result screen
      return;
    }
    requestAnimationFrame(this.frame);
    const raw = now - this.last;
    if (this.settings.fps === 30) {
      this.acc += raw;
      this.last = now;
      if (this.acc < 31) return;
      this.step(this.acc);
      this.acc = 0;
    } else {
      this.last = now;
      this.step(raw);
    }
  };

  private step(ms: number) {
    const dt = Math.min(0.05, ms / 1000);
    const lv = this.level;
    if (!lv) return;
    const fx = this.fx;
    fx.reset();

    if (this.state === 'play') {
      this.engine.adapt(ms);
      this.elapsed += dt;
      const look = this.input.poll();
      this.player.update(dt, this.input, look, lv.grid, this.settings.sens, this.settings.invertY, (run) => this.audio.step(run));
      lv.update(dt);
      if (look.interact) lv.interact();
      this.ui.interact(lv.current?.label ?? null);
      if (this.state === 'play' && this.broken) this.lose('Dein Verstand ist zerbrochen.');
    } else if (this.state === 'dying') {
      lv.update(0);
      this.dieT -= dt;
      fx.chroma = 3;
      fx.wobble = 2;
      fx.fade = Math.max(0, 1 - this.dieT / 0.5);
      this.engine.camera.fov = Math.max(38, this.engine.camera.fov - dt * 60);
      this.engine.camera.updateProjectionMatrix();
      if (this.dieT <= 0) this.lose(this.dieReason);
    } else {
      fx.fade = 0.75;
      fx.sat = 0.2;
    }

    // global overlays: low sanity, flashes, fade-in
    const fear = 1 - this.sanity;
    fx.vig += fear * 0.7;
    fx.grain += fear * 0.08;
    fx.chroma += fear * fear * 1.2;
    fx.wobble += Math.max(0, fear - 0.5) * 1.5;
    this.flashV = Math.max(0, this.flashV - dt * 1.8);
    fx.flash = this.flashV;
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dt * 0.7); fx.fade = Math.max(fx.fade, this.fadeIn); }

    this.audio.update(dt, this.state === 'play' ? fear : 0);
    this.player.apply(this.engine.camera);
    this.engine.render(dt);

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.ui.meters(this.sanity, this.player.stamina);
      if (this.settings.showFps) this.ui.fps(`${this.engine.fps.toFixed(0)} FPS · ${this.engine.drawCalls} DC · ${(this.engine.scale).toFixed(2)}x · ${this.engine.tier.name}`);
    }
  }
}

const game = new Game();
(window as unknown as { __game: Game }).__game = game;

// PWA: offline support. Skipped inside iframes / unsupported contexts.
if ('serviceWorker' in navigator && window.self === window.top && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
      // hand the already-loaded hashed assets to the worker so the very first visit is offline-capable
      const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin));
      reg.active?.postMessage({ type: 'precache', urls });
    }).catch(() => undefined);
  });
}
