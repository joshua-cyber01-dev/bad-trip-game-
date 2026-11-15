// First-person controller: grid collision, sprint/stamina, crouch, head bob.
import * as THREE from 'three';
import type { Grid } from '../world/grid';
import type { Input } from './input';

export class Player {
  x = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  vx = 0;
  vz = 0;
  speed = 0;
  stamina = 1;
  crouched = false;
  sprinting = false;
  frozen = false;
  /** responsiveness of velocity changes (low = drifting, used for dissociation) */
  accel = 14;
  speedMul = 1;
  roll = 0;
  yOffset = 0;
  radius = 0.34;

  private eye = 1.62;
  private bob = 0;
  private stepAcc = 0;
  private exhausted = false;

  place(x: number, z: number, yaw: number) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0;
    this.vx = this.vz = 0; this.stamina = 1; this.frozen = false; this.crouched = false;
    this.accel = 14; this.speedMul = 1; this.roll = 0; this.yOffset = 0; this.eye = 1.62; this.exhausted = false;
  }

  update(dt: number, input: Input, look: { dx: number; dy: number }, grid: Grid, sens: number, invertY: boolean, onStep: (run: boolean) => void) {
    const ls = 0.0034 * sens;
    this.yaw -= look.dx * ls;
    this.pitch -= look.dy * ls * (invertY ? -1 : 1);
    this.pitch = Math.max(-1.25, Math.min(1.25, this.pitch));

    this.crouched = input.crouch;
    let mx = input.moveX, my = input.moveY;
    if (this.frozen) { mx = 0; my = 0; }
    const mag = Math.min(1, Math.hypot(mx, my));
    const wantSprint = input.sprint && !this.crouched && my > 0.2 && !this.exhausted;
    this.sprinting = wantSprint && mag > 0.3;
    const top = (this.crouched ? 1.3 : this.sprinting ? 4.7 : 2.7) * this.speedMul;

    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const tx = (c * mx - s * my) * top;
    const tz = (-s * mx - c * my) * top;
    const k = Math.min(1, this.accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    const nx = this.x + this.vx * dt;
    if (!grid.collides(nx, this.z, this.radius)) this.x = nx; else this.vx = 0;
    const nz = this.z + this.vz * dt;
    if (!grid.collides(this.x, nz, this.radius)) this.z = nz; else this.vz = 0;

    this.speed = Math.hypot(this.vx, this.vz);
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 0.2);
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (this.speed < 0.3 ? 0.2 : 0.12));
      if (this.stamina > 0.3) this.exhausted = false;
    }

    const targetEye = this.crouched ? 0.95 : 1.62;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 9);
    if (this.speed > 0.4 && !this.frozen) {
      this.bob += this.speed * dt * 1.85;
      this.stepAcc += this.speed * dt;
      const stride = this.sprinting ? 2.3 : this.crouched ? 1.3 : 1.8;
      if (this.stepAcc > stride) { this.stepAcc = 0; onStep(this.sprinting); }
    }
  }

  apply(cam: THREE.PerspectiveCamera) {
    const amp = Math.min(1, this.speed / 2.7) * 0.035;
    cam.position.set(this.x, this.eye + Math.sin(this.bob * 2) * amp + this.yOffset, this.z);
    cam.rotation.set(this.pitch, this.yaw, this.roll + Math.cos(this.bob) * amp * 0.25);
  }

  /** forward unit vector (xz) */
  get fx() { return -Math.sin(this.yaw); }
  get fz() { return -Math.cos(this.yaw); }
}
