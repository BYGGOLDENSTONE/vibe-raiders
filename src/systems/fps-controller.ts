import { Vector3, Euler, type PerspectiveCamera } from 'three';
import type { Entity } from '../core/types';
import { C, type TransformComponent } from '../core/components';
import { getComponent } from '../core/entity';
import { pushOutXZ, type Collider } from '../world/colliders';

export interface FpsControllerOptions {
  camera: PerspectiveCamera;
  domElement: HTMLElement;
  player: Entity;
  groundY?: number;
  worldHalfSize?: number;
  colliders?: Collider[];
  playerRadius?: number;
  /** Optional per-frame ground sampler. If provided, overrides groundY. */
  getGroundHeight?: (x: number, z: number) => number;
}

export interface FpsController {
  update: (dt: number) => void;
  isLocked: () => boolean;
  requestLock: () => void;
  setColliders: (c: Collider[]) => void;
  dispose: () => void;
}

const WALK_SPEED = 5.5;
const SPRINT_MULT = 1.7;
const CROUCH_MULT = 0.55;
const JUMP_VELOCITY = 6.2;
const GRAVITY = 18.0;
const STAND_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.05;
const MOUSE_SENSITIVITY = 0.0022;

export function createFpsController(opts: FpsControllerOptions): FpsController {
  const { camera, domElement, player } = opts;
  const fallbackGroundY = opts.groundY ?? 0;
  const halfSize = opts.worldHalfSize ?? 240;
  const playerRadius = opts.playerRadius ?? 0.45;
  const getGroundHeight = opts.getGroundHeight;
  let colliders: Collider[] = opts.colliders ?? [];

  const euler = new Euler(0, 0, 0, 'YXZ');
  euler.setFromQuaternion(camera.quaternion);

  const keys = new Set<string>();
  let locked = false;
  let crouching = false;
  let currentHeight = STAND_HEIGHT;

  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    euler.y -= e.movementX * MOUSE_SENSITIVITY;
    euler.x -= e.movementY * MOUSE_SENSITIVITY;
    euler.x = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, euler.x));
    camera.quaternion.setFromEuler(euler);
  };

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.repeat) return;
    const k = e.code;
    if (down) keys.add(k); else keys.delete(k);
    if (down && k === 'KeyC') crouching = !crouching;
  };

  const onLockChange = () => {
    locked = document.pointerLockElement === domElement;
    if (!locked) keys.clear();
  };

  const onClick = () => {
    if (!locked) domElement.requestPointerLock();
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('keydown', onKey(true));
  document.addEventListener('keyup', onKey(false));
  document.addEventListener('pointerlockchange', onLockChange);
  domElement.addEventListener('click', onClick);

  const tmpForward = new Vector3();
  const tmpRight = new Vector3();
  const wishDir = new Vector3();

  const transform = getComponent<TransformComponent>(player, C.Transform);
  if (!transform) throw new Error('FPS controller: player missing transform component');

  const update = (dt: number) => {
    if (!locked) return;

    // input direction
    wishDir.set(0, 0, 0);
    if (keys.has('KeyW')) wishDir.z -= 1;
    if (keys.has('KeyS')) wishDir.z += 1;
    if (keys.has('KeyA')) wishDir.x -= 1;
    if (keys.has('KeyD')) wishDir.x += 1;
    const inputLen = wishDir.length();
    if (inputLen > 0) wishDir.divideScalar(inputLen);

    // camera-aligned basis (planar)
    tmpForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    tmpForward.y = 0; tmpForward.normalize();
    tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tmpRight.y = 0; tmpRight.normalize();

    let speed = WALK_SPEED;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed *= SPRINT_MULT;
    if (crouching) speed *= CROUCH_MULT;

    const moveX = (tmpForward.x * -wishDir.z + tmpRight.x * wishDir.x) * speed;
    const moveZ = (tmpForward.z * -wishDir.z + tmpRight.z * wishDir.x) * speed;
    transform.velocity.x = moveX;
    transform.velocity.z = moveZ;

    // jump
    if (keys.has('Space') && transform.grounded) {
      transform.velocity.y = JUMP_VELOCITY;
      transform.grounded = false;
    }

    // gravity
    transform.velocity.y -= GRAVITY * dt;

    // integrate position
    player.object3d.position.x += transform.velocity.x * dt;
    player.object3d.position.y += transform.velocity.y * dt;
    player.object3d.position.z += transform.velocity.z * dt;

    // ground collision — sample heightmap if available.
    const groundY = getGroundHeight
      ? getGroundHeight(player.object3d.position.x, player.object3d.position.z)
      : fallbackGroundY;
    if (player.object3d.position.y <= groundY) {
      player.object3d.position.y = groundY;
      transform.velocity.y = 0;
      transform.grounded = true;
    }

    // world bounds
    const half = halfSize;
    if (player.object3d.position.x < -half) player.object3d.position.x = -half;
    if (player.object3d.position.x > half) player.object3d.position.x = half;
    if (player.object3d.position.z < -half) player.object3d.position.z = -half;
    if (player.object3d.position.z > half) player.object3d.position.z = half;

    // resolve AABB collisions on XZ
    if (colliders.length > 0) {
      pushOutXZ(player.object3d.position, playerRadius, currentHeight, colliders);
    }

    // smooth crouch height
    const targetH = crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    currentHeight += (targetH - currentHeight) * Math.min(1, dt * 12);

    // camera follows player at eye height
    camera.position.x = player.object3d.position.x;
    camera.position.y = player.object3d.position.y + currentHeight;
    camera.position.z = player.object3d.position.z;
  };

  const dispose = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('keydown', onKey(true));
    document.removeEventListener('keyup', onKey(false));
    document.removeEventListener('pointerlockchange', onLockChange);
    domElement.removeEventListener('click', onClick);
  };

  return {
    update,
    isLocked: () => locked,
    requestLock: () => domElement.requestPointerLock(),
    setColliders: (c: Collider[]) => { colliders = c; },
    dispose,
  };
}

