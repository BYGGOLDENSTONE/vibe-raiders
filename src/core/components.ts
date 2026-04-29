import type { Vector3 } from 'three';

// Universal — anything that moves in 3D wants this.
export interface TransformComponent {
  velocity: Vector3;
  grounded: boolean;
}

// Component-name registry. Extend in your game's own component module.
export const C = {
  Transform: 'transform',
} as const;
