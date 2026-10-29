/** Renderer-independent rigid transforms in native RAW3D coordinates. */
export type Raw3DVector3 = readonly [number, number, number];
export type Raw3DQuaternion = readonly [number, number, number, number];
export interface Raw3DRigidTransform {
  readonly position: Raw3DVector3;
  readonly quaternion: Raw3DQuaternion;
}

export function raw3DQuaternionFromRotation(rotation: readonly number[]): Raw3DQuaternion {
  const [x, y, z] = [0, 1, 2].map(i => (rotation[i] ?? 0) / 2);
  const a = Math.cos(x!), b = Math.sin(x!), c = Math.cos(y!), d = Math.sin(y!);
  const e = Math.cos(z!), f = Math.sin(z!);
  // Native yaw-pitch-roll corresponds to intrinsic YXZ.
  return [b * c * e + a * d * f, a * d * e - b * c * f,
    a * c * f - b * d * e, a * c * e + b * d * f];
}

export function raw3DRotationFromQuaternion([x,y,z,w]: Raw3DQuaternion): Raw3DVector3 {
  const sine = Math.max(-1, Math.min(1, 2*(x*w-y*z)));
  return Math.abs(sine) < .9999999
    ? [Math.asin(sine), Math.atan2(2*(x*z+y*w), 1-2*(x*x+y*y)), Math.atan2(2*(x*y+z*w), 1-2*(x*x+z*z))]
    : [Math.asin(sine), Math.atan2(2*(y*w-x*z), 1-2*(y*y+z*z)), 0];
}

function multiply(a: Raw3DQuaternion, b: Raw3DQuaternion): Raw3DQuaternion {
  return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
    a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
    a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
    a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
}

/**
 * Normalized dual-quaternion linear blending (DLB), independently implemented
 * from Kavan et al., Dual Quaternions for Rigid Transformation Blending (2006).
 * This follows a rigid screw path; unlike ScLERP its speed need not be constant.
 */
export function interpolateRaw3DDualQuaternion(
  start: Raw3DRigidTransform, end: Raw3DRigidTransform, fraction: number
): Raw3DRigidTransform {
  if (!Number.isFinite(fraction)) throw new RangeError("Interpolation fraction must be finite.");
  const t = Math.max(0, Math.min(1, fraction));
  const normalize = (q: Raw3DQuaternion): Raw3DQuaternion => {
    const length = Math.hypot(...q);
    if (!Number.isFinite(length) || length < 1e-12) throw new RangeError("A rigid transform needs a finite nonzero quaternion.");
    return q.map(v => v / length) as unknown as Raw3DQuaternion;
  };
  const a = normalize(start.quaternion), b = normalize(end.quaternion);
  if (![...start.position, ...end.position].every(Number.isFinite)) throw new RangeError("Rigid transform positions must be finite.");
  const ad = multiply([...start.position, 0], a), bd = multiply([...end.position, 0], b);
  // q and -q describe the same pose. Align both real and dual parts together.
  const sign = a.reduce((sum, value, i) => sum + value * b[i]!, 0) < 0 ? -1 : 1;
  const real = a.map((value, i) => (1-t)*value + t*sign*b[i]!) as unknown as Raw3DQuaternion;
  const dual = ad.map((value, i) => ((1-t)*value + t*sign*bd[i]!) / 2);
  const length = Math.hypot(...real);
  const q = real.map(v => v / length) as unknown as Raw3DQuaternion;
  const d = dual.map(v => v / length);
  const projection = q.reduce((sum, value, i) => sum + value*d[i]!, 0);
  const orthogonal = d.map((value, i) => value - projection*q[i]!) as unknown as Raw3DQuaternion;
  const translation = multiply(orthogonal, [-q[0], -q[1], -q[2], q[3]]);
  return { position: [2*translation[0], 2*translation[1], 2*translation[2]], quaternion: q };
}
