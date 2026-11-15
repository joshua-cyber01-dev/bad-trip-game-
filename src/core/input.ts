// Touch-first input: floating joystick (move), drag zone (look), action buttons.
// Keyboard + mouse are supported as an optional fallback for desktop testing.
import type { Settings } from './storage';

export class Input {
  moveX = 0; // strafe  (-1..1)
  moveY = 0; // forward (-1..1)
  sprint = false;
  crouch = false;
  enabled = false;
  editing = false;
  onPause?: () => void;

  private lookDX = 0;
  private lookDY = 0;
  private interactEdge = false;
  private joyId = -1;
  private joyOX = 0;
  private joyOY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private keys = new Set<string>();
  private btnSprintHeld = false;

  constructor(
    private layer: HTMLElement,
    private joy: HTMLElement,
    private knob: HTMLElement,
    private btns: { sprint: HTMLElement; crouch: HTMLElement; interact: HTMLElement },
    private settings: Settings,
  ) {
    const opt = { passive: false } as AddEventListenerOptions;
    layer.addEventListener('pointerdown', (e) => this.down(e), opt);
    window.addEventListener('pointermove', (e) => this.moveEv(e), opt);
    window.addEventListener('pointerup', (e) => this.up(e), opt);
    window.addEventListener('pointercancel', (e) => this.up(e), opt);

    // Buttons: react on pointerdown (no click delay). A thumb resting on a button can still drag to look.
    const bind = (el: HTMLElement, onDown: () => void, onUp?: () => void) => {
      el.addEventListener('pointerdown', (e) => {
        if (!this.enabled || this.editing) return;
        e.preventDefault();
        e.stopPropagation();
        onDown();
        el.classList.add('on');
        if (this.lookId < 0 && e.pointerType !== 'mouse') {
          this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY;
        }
        const release = (ev: PointerEvent) => {
          if (ev.pointerId !== e.pointerId) return;
          window.removeEventListener('pointerup', release);
          window.removeEventListener('pointercancel', release);
          el.classList.remove('on');
          onUp?.();
        };
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
      }, opt);
    };
    bind(btns.sprint, () => { this.btnSprintHeld = true; }, () => { this.btnSprintHeld = false; });
    bind(btns.crouch, () => { this.crouch = !this.crouch; btns.crouch.classList.toggle('active', this.crouch); });
    bind(btns.interact, () => { this.interactEdge = true; });

    // iOS: block pinch zoom, double-tap zoom, long-press menus.
    for (const ev of ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick']) {
      document.addEventListener(ev, (e) => e.preventDefault(), opt);
    }
    document.addEventListener('touchmove', (e) => { if (this.enabled) e.preventDefault(); }, opt);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (e.code === 'KeyE' || e.code === 'Space') this.interactEdge = true;
      if (e.code === 'KeyC') { this.crouch = !this.crouch; btns.crouch.classList.toggle('active', this.crouch); }
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.releaseAll(); });
  }

  private joyRadius() { return 54 * this.settings.btnScale; }

  private down(e: PointerEvent) {
    if (!this.enabled || this.editing) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY;
      return;
    }
    const leftSide = e.clientX < window.innerWidth * 0.45;
    const joySide = this.settings.lefty ? e.clientX > window.innerWidth * 0.55 : leftSide;
    if (joySide && this.joyId < 0) {
      this.joyId = e.pointerId; this.joyOX = e.clientX; this.joyOY = e.clientY;
      this.joy.style.left = e.clientX + 'px';
      this.joy.style.top = e.clientY + 'px';
      this.joy.classList.add('live');
      this.knob.style.transform = 'translate(-50%,-50%)';
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY;
    }
  }

  private moveEv(e: PointerEvent) {
    if (!this.enabled) return;
    if (e.pointerId === this.joyId) {
      e.preventDefault();
      const R = this.joyRadius();
      let dx = e.clientX - this.joyOX, dy = e.clientY - this.joyOY;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // base follows the thumb, like modern mobile shooters
        this.joyOX += dx - (dx / d) * R; this.joyOY += dy - (dy / d) * R;
        dx = (dx / d) * R; dy = (dy / d) * R;
        this.joy.style.left = this.joyOX + 'px';
        this.joy.style.top = this.joyOY + 'px';
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const nx = dx / R, ny = -dy / R, m = Math.hypot(nx, ny);
      const dead = 0.12;
      const k = m < dead ? 0 : (m - dead) / (1 - dead) / m;
      this.moveX = nx * k; this.moveY = ny * k;
    } else if (e.pointerId === this.lookId) {
      e.preventDefault();
      this.lookDX += e.clientX - this.lookX;
      this.lookDY += e.clientY - this.lookY;
      this.lookX = e.clientX; this.lookY = e.clientY;
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.joyId) {
      this.joyId = -1; this.moveX = 0; this.moveY = 0;
      this.joy.classList.remove('live');
      this.joy.style.left = ''; this.joy.style.top = '';
      this.knob.style.transform = 'translate(-50%,-50%)';
    }
    if (e.pointerId === this.lookId) this.lookId = -1;
  }

  releaseAll() {
    this.joyId = -1; this.lookId = -1; this.moveX = 0; this.moveY = 0; this.btnSprintHeld = false;
    this.joy.classList.remove('live');
    this.joy.style.left = ''; this.joy.style.top = '';
    this.knob.style.transform = 'translate(-50%,-50%)';
    for (const b of Object.values(this.btns)) b.classList.remove('on');
  }

  reset() {
    this.releaseAll();
    this.crouch = false;
    this.btns.crouch.classList.remove('active');
    this.lookDX = this.lookDY = 0;
    this.interactEdge = false;
  }

  /** Call once per frame. Returns look delta in px and merges keyboard state. */
  poll(): { dx: number; dy: number; interact: boolean } {
    const k = this.keys;
    if (this.joyId < 0) {
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const m = Math.hypot(x, y) || 1;
      this.moveX = x / m; this.moveY = y / m;
    }
    this.sprint = this.btnSprintHeld || k.has('ShiftLeft') || k.has('ShiftRight');
    const r = { dx: this.lookDX, dy: this.lookDY, interact: this.interactEdge };
    this.lookDX = 0; this.lookDY = 0; this.interactEdge = false;
    return r;
  }

  buzz(ms: number | number[]) {
    if (!this.settings.haptics) return;
    try { navigator.vibrate?.(ms); } catch { /* unsupported (iOS Safari) */ }
  }
}
