import * as THREE from 'three';

export interface CameraTarget {
  target: THREE.Vector3;
  distance: number;
  yaw: number;   // around Y axis
  pitch: number; // 0 = side view, PI/2 = top down
}

interface Transition {
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromDistance: number;
  toDistance: number;
  fromYaw: number;
  toYaw: number;
  fromPitch: number;
  toPitch: number;
  t: number;
  duration: number;
  onDone: (() => void) | null;
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// shortest angular interpolation
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CameraController {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3 = new THREE.Vector3();
  distance = 800;
  yaw = 0;
  pitch = 0.9;

  minDistance = 1;
  maxDistance = 2000;

  trackedNode: THREE.Object3D | null = null;

  private transition: Transition | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private dragSensitivity = 0.005;
  private wheelSensitivity = 0.0015;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.attach(dom);
  }

  private attach(dom: HTMLElement): void {
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e: PointerEvent) => {
      // Right-click drag, or middle, or left+shift — left alone reserved for picking
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * this.dragSensitivity;
      this.pitch = Math.max(0.1, Math.min(1.4, this.pitch + dy * this.dragSensitivity));
    });
    const stop = (e: PointerEvent) => {
      if (this.dragging) {
        this.dragging = false;
        try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }
    };
    dom.addEventListener('pointerup', stop);
    dom.addEventListener('pointercancel', stop);
    dom.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * this.wheelSensitivity);
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * factor));
    }, { passive: false });
  }

  isTransitioning(): boolean {
    return this.transition !== null;
  }

  goTo(t: CameraTarget, duration = 1.5, onDone: (() => void) | null = null): void {
    this.transition = {
      fromTarget: this.target.clone(),
      toTarget: t.target.clone(),
      fromDistance: this.distance,
      toDistance: t.distance,
      fromYaw: this.yaw,
      toYaw: t.yaw,
      fromPitch: this.pitch,
      toPitch: t.pitch,
      t: 0,
      duration,
      onDone,
    };
  }

  setLimits(minDistance: number, maxDistance: number): void {
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.distance = Math.max(minDistance, Math.min(maxDistance, this.distance));
  }

  snap(t: CameraTarget): void {
    this.target.copy(t.target);
    this.distance = t.distance;
    this.yaw = t.yaw;
    this.pitch = t.pitch;
  }

  update(dt: number): void {
    if (this.transition) {
      this.transition.t += dt;
      const k = Math.min(1, this.transition.t / this.transition.duration);
      const e = easeInOutCubic(k);
      // While transitioning toward a tracked node, refresh the destination from
      // the node's live world position. This makes the camera smoothly chase a
      // moving target instead of snapping when the transition ends.
      if (this.trackedNode) {
        this.trackedNode.getWorldPosition(this.transition.toTarget);
      }
      this.target.copy(this.transition.fromTarget).lerp(this.transition.toTarget, e);
      this.distance = this.transition.fromDistance + (this.transition.toDistance - this.transition.fromDistance) * e;
      this.yaw = lerpAngle(this.transition.fromYaw, this.transition.toYaw, e);
      this.pitch = this.transition.fromPitch + (this.transition.toPitch - this.transition.fromPitch) * e;
      if (k >= 1) {
        const cb = this.transition.onDone;
        this.transition = null;
        if (cb) cb();
      }
    } else if (this.trackedNode) {
      this.trackedNode.getWorldPosition(this.target);
    }

    // Apply spherical position
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const dx = sy * cp;
    const dy = sp;
    const dz = cy * cp;
    this.camera.position.set(
      this.target.x + dx * this.distance,
      this.target.y + dy * this.distance,
      this.target.z + dz * this.distance,
    );
    this.camera.lookAt(this.target);
  }
}
