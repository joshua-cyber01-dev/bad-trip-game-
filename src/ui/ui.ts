// DOM based menus + HUD. Everything is sized for thumbs on a landscape phone.
import { DEFAULT_LAYOUT, save, type Progress, type Settings } from '../core/storage';
import type { LevelMeta } from '../levels/base';

type Screen = 'title' | 'select' | 'loading' | 'intro' | 'hud' | 'pause' | 'end' | 'none';

export interface UIHandlers {
  onStart(meta: LevelMeta): void;
  onBegin(): void;
  onPause(): void;
  onResume(): void;
  onQuit(): void;
  onRetry(): void;
  onSettings(): void;
  onGesture(): void;
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export function fmtTime(s: number) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

const ICONS: Record<string, string> = {
  sprint: '<svg viewBox="0 0 24 24"><path d="M5 17l5-5-5-5M12 17l5-5-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  crouch: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6M5 19h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  interact: '<svg viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 013 0V10m0-1.5a1.5 1.5 0 013 0V11m0-1a1.5 1.5 0 013 0v5a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L5 15a1.6 1.6 0 012.6-1.8L9 14.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
};

export class UI {
  root: HTMLElement;
  layer!: HTMLElement;
  joy!: HTMLElement;
  knob!: HTMLElement;
  btn!: { sprint: HTMLElement; crouch: HTMLElement; interact: HTMLElement };
  private screen: Screen = 'none';
  private els: Record<string, HTMLElement> = {};
  private toastT = 0;
  private lastInteract: string | null = '';
  private lastStatus: string | null = '';
  private lastObj = '';
  private installEvt: (Event & { prompt?: () => void }) | null = null;
  private current?: LevelMeta;
  onLayoutEdit?: (editing: boolean) => void;

  constructor(root: HTMLElement, private settings: Settings, private progress: Progress, private levels: LevelMeta[], private h: UIHandlers) {
    this.root = root;
    root.innerHTML = this.html();
    for (const el of root.querySelectorAll<HTMLElement>('[id]')) this.els[el.id] = el;
    this.layer = this.els.touch;
    this.joy = this.els.joy;
    this.knob = this.els.knob;
    this.btn = { sprint: this.els['b-sprint'], crouch: this.els['b-crouch'], interact: this.els['b-interact'] };
    this.bind();
    this.applyLayout();
    this.renderCards();
    this.syncSettings();
    const check = () => document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth * 1.05);
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => setTimeout(check, 200));
    check();
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvt = e;
      this.els.install.hidden = false;
    });
    const nav = navigator as Navigator & { standalone?: boolean };
    const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    const standalone = nav.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (ios && !standalone && window.self === window.top) this.els.ioshint.hidden = false;
  }

  private html() {
    return /* html */ `
<div id="touch"></div>

<div id="hud" class="layer">
  <div id="vign"></div>
  <div id="cross"></div>
  <button id="b-pause" class="hbtn" aria-label="Pause">${ICONS.pause}</button>
  <div id="obj"><span id="obj-t"></span><b id="obj-c"></b></div>
  <div id="meters">
    <div id="timer" hidden></div>
    <div class="meter"><label>VERSTAND</label><i><em id="m-san"></em></i></div>
  </div>
  <div id="status" hidden></div>
  <div id="toast"></div>
  <div id="fps" hidden></div>
  <div id="joy"><div id="knob"></div></div>
  <div id="b-sprint" class="abtn" data-k="sprint"><svg class="ring" viewBox="0 0 100 100"><circle id="stam" cx="50" cy="50" r="46"/></svg>${ICONS.sprint}<span>SPRINT</span></div>
  <div id="b-crouch" class="abtn sm" data-k="crouch">${ICONS.crouch}<span>DUCKEN</span></div>
  <div id="b-interact" class="abtn lg off" data-k="interact">${ICONS.interact}<span id="int-l">AKTION</span></div>
  <div id="editbar" hidden>
    <span>Buttons ziehen</span>
    <label>Größe <input id="e-scale" type="range" min="0.7" max="1.5" step="0.05"></label>
    <button id="e-reset" class="chip">Zurücksetzen</button>
    <button id="e-done" class="chip solid">Fertig</button>
  </div>
</div>

<section id="s-title" class="screen">
  <div class="bg-noise"></div>
  <div class="title-wrap">
    <h1 class="logo" data-t="BAD TRIP">BAD TRIP</h1>
    <p class="sub">Fünf Substanzen. Fünf Albträume. Kein Weg zurück – außer durch.</p>
    <div class="row">
      <button id="t-play" class="big">SPIELEN</button>
      <button id="t-set" class="big ghost">EINSTELLUNGEN</button>
      <button id="install" class="big ghost" hidden>INSTALLIEREN</button>
    </div>
    <p id="ioshint" class="hint" hidden>Für Vollbild: <b>Teilen</b> → <b>Zum Home-Bildschirm</b></p>
  </div>
  <p class="legal">Fiktion. Dieses Spiel verherrlicht keinen Drogenkonsum – es zeigt, wie er enden kann. Enthält Flackern, Verzerrungen und Schreckmomente. Kopfhörer empfohlen.</p>
</section>

<section id="s-select" class="screen">
  <header class="bar"><button id="sel-back" class="chip">‹ Zurück</button><h2>WÄHLE DEINE SUBSTANZ</h2><button id="sel-set" class="chip">Einstellungen</button></header>
  <div id="cards"></div>
</section>

<section id="s-loading" class="screen"><div class="loader"><div class="pill"></div><p id="load-t">Wirkung setzt ein …</p></div></section>

<section id="s-intro" class="screen">
  <div class="intro">
    <small id="in-name"></small>
    <h2 id="in-title"></h2>
    <p id="in-desc"></p>
    <ul id="in-hints"></ul>
    <button id="in-go" class="big">TIPPEN ZUM STARTEN</button>
  </div>
</section>

<section id="s-pause" class="screen dim">
  <div class="panel">
    <h2>PAUSE</h2>
    <button id="p-resume" class="big">WEITER</button>
    <button id="p-set" class="big ghost">EINSTELLUNGEN</button>
    <button id="p-retry" class="big ghost">NEU STARTEN</button>
    <button id="p-quit" class="big ghost">AUFGEBEN</button>
  </div>
</section>

<section id="s-end" class="screen dim">
  <div class="panel">
    <small id="end-k"></small>
    <h2 id="end-h"></h2>
    <p id="end-t"></p>
    <p id="end-time" class="mono"></p>
    <div class="row">
      <button id="end-retry" class="big">NOCHMAL</button>
      <button id="end-menu" class="big ghost">ANDERE SUBSTANZ</button>
    </div>
  </div>
</section>

<section id="s-settings" class="screen over">
  <div class="panel wide">
    <header class="bar"><h2>EINSTELLUNGEN</h2><button id="set-close" class="chip solid">Fertig</button></header>
    <div class="grid">
      <div class="opt"><label>Grafik</label><div class="seg" data-k="quality"><button data-v="auto">Auto</button><button data-v="low">Niedrig</button><button data-v="mid">Mittel</button><button data-v="high">Hoch</button></div></div>
      <div class="opt"><label>Bildrate</label><div class="seg" data-k="fps"><button data-v="60">60 FPS</button><button data-v="30">30 FPS · Akku sparen</button></div></div>
      <div class="opt"><label>Kamera-Empfindlichkeit</label><input type="range" data-k="sens" min="0.3" max="2.2" step="0.05"></div>
      <div class="opt"><label>Lautstärke</label><input type="range" data-k="volume" min="0" max="1" step="0.05"></div>
      <div class="opt tog"><label>Y-Achse umkehren</label><button class="sw" data-k="invertY"></button></div>
      <div class="opt tog"><label>Linkshänder-Modus</label><button class="sw" data-k="lefty"></button></div>
      <div class="opt tog"><label>Vibration</label><button class="sw" data-k="haptics"></button></div>
      <div class="opt tog"><label>FPS anzeigen</label><button class="sw" data-k="showFps"></button></div>
      <div class="opt full"><button id="set-layout" class="big ghost">STEUERUNG ANPASSEN</button></div>
    </div>
  </div>
</section>

<div id="rotate"><div class="phone"></div><p>Bitte drehe dein Gerät ins Querformat</p></div>
<div id="wipe"></div>`;
  }

  private tap(el: HTMLElement, fn: () => void) {
    el.addEventListener('click', (e) => { e.preventDefault(); this.h.onGesture(); fn(); });
  }

  private bind() {
    const e = this.els;
    this.tap(e['t-play'], () => this.show('select'));
    this.tap(e['t-set'], () => this.openSettings());
    this.tap(e.install, () => { this.installEvt?.prompt?.(); e.install.hidden = true; });
    this.tap(e['sel-back'], () => this.show('title'));
    this.tap(e['sel-set'], () => this.openSettings());
    this.tap(e['in-go'], () => this.h.onBegin());
    this.tap(e['p-resume'], () => this.h.onResume());
    this.tap(e['p-set'], () => this.openSettings());
    this.tap(e['p-retry'], () => this.h.onRetry());
    this.tap(e['p-quit'], () => this.h.onQuit());
    this.tap(e['end-retry'], () => this.h.onRetry());
    this.tap(e['end-menu'], () => this.h.onQuit());
    this.tap(e['set-close'], () => e['s-settings'].classList.remove('active'));
    e['b-pause'].addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.h.onPause(); });

    for (const seg of this.root.querySelectorAll<HTMLElement>('.seg')) {
      for (const b of seg.querySelectorAll<HTMLElement>('button')) {
        this.tap(b, () => {
          const k = seg.dataset.k as 'quality' | 'fps';
          (this.settings as unknown as Record<string, unknown>)[k] = k === 'fps' ? Number(b.dataset.v) : b.dataset.v;
          this.commit();
        });
      }
    }
    for (const r of this.root.querySelectorAll<HTMLInputElement>('.opt input[type=range]')) {
      r.addEventListener('input', () => {
        (this.settings as unknown as Record<string, unknown>)[r.dataset.k!] = Number(r.value);
        this.commit(false);
      });
    }
    for (const s of this.root.querySelectorAll<HTMLElement>('.sw')) {
      this.tap(s, () => {
        const k = s.dataset.k as 'invertY';
        this.settings[k] = !this.settings[k];
        this.commit();
      });
    }
    this.tap(e['set-layout'], () => this.editLayout());
    this.tap(e['e-done'], () => this.endEdit());
    this.tap(e['e-reset'], () => {
      this.settings.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
      this.settings.btnScale = 1;
      this.commit();
    });
    (e['e-scale'] as HTMLInputElement).addEventListener('input', () => {
      this.settings.btnScale = Number((e['e-scale'] as HTMLInputElement).value);
      this.commit(false);
    });

    // drag buttons in layout edit mode
    for (const b of Object.values(this.btn)) {
      b.addEventListener('pointerdown', (ev) => {
        if (!document.body.classList.contains('editing')) return;
        ev.preventDefault();
        b.setPointerCapture(ev.pointerId);
        const move = (m: PointerEvent) => {
          let x = (m.clientX / window.innerWidth) * 100;
          const y = Math.max(8, Math.min(92, (m.clientY / window.innerHeight) * 100));
          if (this.settings.lefty) x = 100 - x;
          this.settings.layout[b.dataset.k!] = { x: Math.max(4, Math.min(96, x)), y };
          this.applyLayout();
        };
        const up = () => {
          b.removeEventListener('pointermove', move);
          b.removeEventListener('pointerup', up);
          b.removeEventListener('pointercancel', up);
          save('settings', this.settings);
        };
        b.addEventListener('pointermove', move);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
      });
    }
  }

  private commit(resync = true) {
    save('settings', this.settings);
    this.applyLayout();
    if (resync) this.syncSettings();
    this.h.onSettings();
  }

  private syncSettings() {
    const s = this.settings as unknown as Record<string, unknown>;
    for (const seg of this.root.querySelectorAll<HTMLElement>('.seg')) {
      for (const b of seg.querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', String(s[seg.dataset.k!]) === b.dataset.v);
    }
    for (const r of this.root.querySelectorAll<HTMLInputElement>('.opt input[type=range]')) r.value = String(s[r.dataset.k!]);
    for (const w of this.root.querySelectorAll<HTMLElement>('.sw')) w.classList.toggle('on', !!s[w.dataset.k!]);
    (this.els['e-scale'] as HTMLInputElement).value = String(this.settings.btnScale);
    this.els.fps.hidden = !this.settings.showFps;
  }

  applyLayout() {
    const s = this.settings;
    document.documentElement.style.setProperty('--bs', String(s.btnScale));
    document.body.classList.toggle('lefty', s.lefty);
    for (const b of Object.values(this.btn)) {
      const p = s.layout[b.dataset.k!] ?? DEFAULT_LAYOUT[b.dataset.k!];
      b.style.left = (s.lefty ? 100 - p.x : p.x) + '%';
      b.style.top = p.y + '%';
    }
  }

  private openSettings() {
    this.syncSettings();
    this.els['s-settings'].classList.add('active');
  }

  private editReturn: Screen = 'title';
  private editLayout() {
    this.editReturn = this.screen;
    this.els['s-settings'].classList.remove('active');
    for (const s of this.root.querySelectorAll('.screen')) s.classList.remove('active');
    document.body.classList.add('editing');
    this.els.hud.classList.add('active');
    this.els.editbar.hidden = false;
    this.onLayoutEdit?.(true);
  }
  private endEdit() {
    document.body.classList.remove('editing');
    this.els.editbar.hidden = true;
    this.onLayoutEdit?.(false);
    const back = this.editReturn;
    this.screen = 'none';
    this.show(back);
    this.openSettings();
  }

  renderCards() {
    const wrap = this.els.cards;
    wrap.innerHTML = this.levels.map((l, i) => {
      const best = this.progress.done[l.id];
      return /* html */ `
<article class="card" style="--c:${l.color};--c2:${l.color2};--i:${i}" data-id="${l.id}">
  <div class="art"><span>${String(i + 1).padStart(2, '0')}</span></div>
  <div class="body">
    <div class="top"><div class="dots">${'<i class="on"></i>'.repeat(l.intensity)}${'<i></i>'.repeat(5 - l.intensity)}</div>${best ? `<em class="done">✓ ${fmtTime(best)}</em>` : ''}</div>
    <h3>${l.name}</h3>
    <h4>${l.title}</h4>
    <p>${l.tagline}</p>
    <div class="tags">${l.tags.map((t) => `<span>${t}</span>`).join('')}</div>
    <button class="take">EINNEHMEN</button>
  </div>
</article>`;
    }).join('');
    for (const c of wrap.querySelectorAll<HTMLElement>('.card')) {
      const meta = this.levels.find((l) => l.id === c.dataset.id)!;
      this.tap($(c, '.take'), () => this.h.onStart(meta));
    }
  }

  show(s: Screen) {
    if (s === this.screen) return;
    this.screen = s;
    for (const el of this.root.querySelectorAll('.screen:not(.over)')) el.classList.remove('active');
    const inGame = s === 'hud' || s === 'pause' || s === 'end';
    this.els.hud.classList.toggle('active', s === 'hud');
    document.body.classList.toggle('ingame', inGame || s === 'intro');
    if (s !== 'hud' && s !== 'none') this.els['s-' + s]?.classList.add('active');
  }

  wipe() {
    const w = this.els.wipe;
    w.classList.remove('go');
    void w.offsetWidth;
    w.classList.add('go');
  }

  showIntro(m: LevelMeta) {
    this.current = m;
    this.root.style.setProperty('--c', m.color);
    this.root.style.setProperty('--c2', m.color2);
    this.els['in-name'].textContent = m.name;
    this.els['in-title'].textContent = m.title;
    this.els['in-desc'].textContent = m.desc;
    this.els['in-hints'].innerHTML = m.hints.map((h) => `<li>${h}</li>`).join('');
    this.show('intro');
  }

  showEnd(win: boolean, text: string, time: number, best: number | undefined) {
    const m = this.current;
    this.els['s-end'].classList.toggle('win', win);
    this.els['end-k'].textContent = m ? `${m.name} · ${m.title}` : '';
    this.els['end-h'].textContent = win ? 'DU BIST WIEDER DA' : 'BAD TRIP';
    this.els['end-t'].textContent = text;
    this.els['end-time'].textContent = win ? `Zeit ${fmtTime(time)}${best !== undefined ? ` · Bestzeit ${fmtTime(best)}` : ''}` : `Überlebt: ${fmtTime(time)}`;
    this.show('end');
  }

  setLoading(t: string) { this.els['load-t'].textContent = t; }

  // ------------------------------------------------------------ HUD
  objective(text: string, count = '') {
    const key = text + '|' + count;
    if (key === this.lastObj) return;
    this.lastObj = key;
    this.els['obj-t'].textContent = text;
    this.els['obj-c'].textContent = count;
    this.els.obj.classList.remove('pop');
    void this.els.obj.offsetWidth;
    this.els.obj.classList.add('pop');
  }

  toast(text: string, ms = 2500) {
    const t = this.els.toast;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('on'), ms);
  }

  timer(sec: number | null) {
    const t = this.els.timer;
    if (sec === null) { t.hidden = true; return; }
    t.hidden = false;
    const txt = fmtTime(Math.ceil(sec));
    if (t.textContent !== txt) { t.textContent = txt; t.classList.toggle('low', sec < 45); }
  }

  status(text: string | null) {
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.els.status.hidden = !text;
    this.els.status.textContent = text ?? '';
  }

  interact(label: string | null) {
    if (label === this.lastInteract) return;
    this.lastInteract = label;
    this.btn.interact.classList.toggle('off', !label);
    if (label) this.els['int-l'].textContent = label;
  }

  meters(sanity: number, stamina: number) {
    this.els['m-san'].style.transform = `scaleX(${Math.max(0, sanity).toFixed(3)})`;
    this.els['m-san'].classList.toggle('low', sanity < 0.35);
    (this.els.stam as unknown as SVGCircleElement).style.strokeDashoffset = String(289 * (1 - stamina));
    this.els.vign.style.opacity = String(Math.max(0, 0.9 - sanity * 2));
  }

  fps(text: string) { this.els.fps.textContent = text; }

  resetHud() {
    this.lastObj = ''; this.lastInteract = ''; this.lastStatus = '';
    this.status(null); this.interact(null); this.timer(null);
    this.els.toast.classList.remove('on');
  }
}
