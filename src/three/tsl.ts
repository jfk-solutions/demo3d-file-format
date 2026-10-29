import * as TSL from "three/tsl";
import type * as Three from "three";

/** A narrow shader-graph boundary avoids expanding TSL's recursive overload types. */
export interface Expression {
  readonly x: Expression; readonly y: Expression; readonly z: Expression;
  readonly w: Expression;
  readonly xy: Expression; readonly rgb: Expression; readonly a: Expression;
  readonly r: Expression; readonly g: Expression; readonly b: Expression;
  add(value: Expression | number): Expression; sub(value: Expression | number): Expression;
  mul(value: Expression | number): Expression; div(value: Expression | number): Expression;
  max(value: Expression | number): Expression; pow(value: Expression | number): Expression;
  dot(value: Expression): Expression; length(): Expression; normalize(): Expression;
  cross(value: Expression): Expression; dFdx(): Expression; dFdy(): Expression;
  abs(): Expression; reciprocal(): Expression; clamp(low: number, high: number): Expression;
  greaterThan(value: Expression | number): Expression; lessThan(value: Expression | number): Expression;
  greaterThanEqual(value: Expression | number): Expression; and(value: Expression): Expression;
  select(yes: Expression, no: Expression): Expression;
  toVar(): Expression; level(value: number): Expression;
  assign(value: Expression): void; subAssign(value: Expression): void; addAssign(value: number): void;
  onRenderUpdate(callback: () => unknown): Expression;
}
interface ShaderDSL {
  uniform(value: unknown): Expression; vec3(value: unknown, second?: Expression | number, third?: Expression | number): Expression;
  float(value: number): Expression; uv(): Expression;
  texture(value: Three.Texture, uv: Expression): Expression;
  normalMap(value: Expression, scale: Expression): Expression;
  readonly positionView: Expression; readonly positionViewDirection: Expression;
  lightTargetDirection(light: Three.Light): Expression;
  Fn(callback: () => Expression): () => Expression;
  Loop(count: number, callback: () => void): void;
  If(condition: Expression, callback: () => void): { Else(callback: () => void): void };
  Break(): void;
}
export const nodes = TSL as unknown as ShaderDSL;
