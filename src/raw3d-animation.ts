import type { Raw3DProject } from "./raw3d.js";
import type { Demo3DXmlElement } from "./xml.js";
import { Raw3DEffects, isRaw3DEffectChannel, type Raw3DEffectState } from "./raw3d-effects.js";
import { interpolateRaw3DDualQuaternion, raw3DQuaternionFromRotation, raw3DRotationFromQuaternion, type Raw3DQuaternion } from "./rigid-interpolation.js";

/** Values verified against the Emulate3D 2026 Raw SDK enum. */
export enum Raw3DInterpolationMode { Default = 0, None = 1, Linear = 2, DualQuaternion = 3 }
export type Raw3DAnimationValue = number | boolean;
export interface Raw3DAnimationTrack {
  readonly kind: string;
  readonly nodeIndex: number;
  readonly name?: string;
  readonly materialIndex: number;
  readonly times: readonly number[];
  readonly values: readonly Raw3DAnimationValue[];
  readonly xml: Demo3DXmlElement;
}
export interface Raw3DAnimationWarning { readonly code: string; readonly message: string; readonly xml: Demo3DXmlElement }
export interface Raw3DNodeState {
  location: [number, number, number];
  rotation: [number, number, number];
  quaternion: Raw3DQuaternion;
  scale: [number, number, number];
  visible: boolean;
  deleted: boolean;
  parentIndex?: number;
  meshIndex?: number;
  layerIndex?: number;
  interpolationMode: Raw3DInterpolationMode;
  interactionMode?: number;
  highlight: number;
  hasBeenOptimized: boolean;
  userData?: string;
  clientOwner?: string;
  isBillboard: boolean;
  isDecal: boolean;
  readonly materialProperties: Record<number, Record<string, number>>;
}
const continuous = new Set(["X", "Y", "Z", "RX", "RY", "RZ", "SX", "SY", "SZ"]);
const discrete = new Set(["Visible", "Delete", "Parent", "Mesh", "Layer", "InterpolationMode", "InteractionMode", "Highlight", "HasBeenOptimized"]);
const materialProperties = new Set(["Diffuse", "U", "V", "ScaleU", "ScaleV", "Reflectivity", "Transparency", "Luminosity", "NormalScale", "PointSize", "Texture", "NormalMap", "NormalTexture", "NormalDepth", "StreamableTexture"]);
const discreteMaterialProperties = new Set(["Diffuse", "Texture", "NormalMap", "NormalTexture", "StreamableTexture"]);
const attribute = (xml: Demo3DXmlElement, name: string) => xml.attributes.find(a => a.localName === name)?.value;
const tokens = (text: string | undefined) => text?.trim().split(/\s+/).filter(Boolean) ?? [];
const triple = (values: readonly number[], fallback: number): [number, number, number] => [values[0] ?? fallback, values[1] ?? fallback, values[2] ?? fallback];

/** Pure, seekable animation data. No renderer, clock, DOM or Three.js dependency. */
export class Raw3DAnimation {
  readonly tracks: readonly Raw3DAnimationTrack[];
  readonly warnings: readonly Raw3DAnimationWarning[];
  readonly duration: number;
  readonly effects: Raw3DEffects;
  private readonly byNode = new Map<number, Raw3DAnimationTrack[]>();
  private readonly rigidTimes = new Map<number, readonly number[]>();
  private readonly nodes: ReadonlyMap<number, Raw3DProject["nodes"][number]>;

  constructor(project: Raw3DProject) {
    this.effects = new Raw3DEffects(project);
    this.nodes = new Map(project.nodes.map(node => [node.index, node]));
    const tracks: Raw3DAnimationTrack[] = [], warnings: Raw3DAnimationWarning[] = [];
    let duration = 0;
    for (const xml of project.root.child("Updates")?.children ?? []) {
      const times = tokens(attribute(xml, "Time")).map(Number);
      if (times.some((time, i) => !Number.isFinite(time) || time < 0 || (i > 0 && time < times[i-1]!))) throw new Error(`Invalid RAW3D ${xml.localName} key times.`);
      duration = Math.max(duration, times.at(-1) ?? 0);
      const kind = xml.localName, name = attribute(xml, "Name");
      if (isRaw3DEffectChannel(kind)) continue;
      if (!continuous.has(kind) && !discrete.has(kind) && !(kind === "Material" && materialProperties.has(name ?? ""))) {
        warnings.push({ code: "RAW3D_ANIMATION_CHANNEL_UNSUPPORTED", message: `Unsupported RAW3D animation channel ${kind}${name ? `:${name}` : ""}.`, xml });
        continue;
      }
      const nodeIndex = Number(attribute(xml, "Node") ?? NaN);
      const materialIndex = Number(attribute(xml, "Index") ?? 0);
      if (!Number.isInteger(nodeIndex) || !this.nodes.has(nodeIndex)) throw new Error(`Invalid RAW3D ${kind} node index ${nodeIndex}.`);
      if (!Number.isInteger(materialIndex) || materialIndex < 0) throw new Error("Invalid RAW3D material slot.");
      const boolean = kind === "Visible" || kind === "Delete" || kind === "HasBeenOptimized";
      const values = tokens(attribute(xml, "Value")).map(value => {
        if (boolean) {
          if (!/^(true|false|0|1)$/i.test(value)) throw new Error(`Invalid RAW3D ${kind} boolean.`);
          return /^(true|1)$/i.test(value);
        }
        if (name === "Diffuse") {
          if (!/^(?:0x)?[a-f\d]{1,8}$/i.test(value)) throw new Error("Invalid RAW3D diffuse ARGB value.");
          return Number.parseInt(value.replace(/^0x/i, ""), 16);
        }
        return Number(value);
      });
      if (!times.length || times.length !== values.length || values.some(value => typeof value === "number" && !Number.isFinite(value))) throw new Error(`Invalid RAW3D ${kind} key values.`);
      if (kind === "InterpolationMode" && values.some(value => !Number.isInteger(value) || Number(value) < 0 || Number(value) > 3)) throw new Error("Unsupported RAW3D interpolation mode.");
      if (kind === "Material" && ["Texture", "NormalMap", "NormalTexture", "StreamableTexture"].includes(name ?? "") && values.some(value => !Number.isInteger(value))) throw new Error("Invalid RAW3D texture reference.");
      if (["Parent", "Mesh", "Layer", "InteractionMode", "Highlight"].includes(kind) && values.some(value => !Number.isInteger(value))) throw new Error(`Invalid RAW3D ${kind} integer value.`);
      const track = { kind, name, nodeIndex, materialIndex, times, values, xml };
      tracks.push(track);
      const group = this.byNode.get(nodeIndex) ?? [];
      group.push(track);this.byNode.set(nodeIndex, group);
    }
    for (const [node, group] of this.byNode) {
      this.rigidTimes.set(node, [...new Set(group.filter(track => ["X", "Y", "Z", "RX", "RY", "RZ"].includes(track.kind)).flatMap(track => [...track.times]))].sort((a,b) => a-b));
    }
    this.tracks = tracks;this.warnings = [...warnings, ...this.effects.warnings];this.duration = duration;
  }

  sample(time: number): ReadonlyMap<number, Raw3DNodeState> {
    if (!Number.isFinite(time)) throw new RangeError("Animation time must be finite.");
    return new Map([...this.nodes.keys()].map(index => [index, this.sampleNode(index, Math.max(0, time))]));
  }

  sampleFrame(time: number): Raw3DEffectState & { readonly nodes: ReadonlyMap<number, Raw3DNodeState> } {
    return { nodes: this.sample(time), ...this.effects.sample(time) };
  }

  sampleNode(nodeIndex: number, time: number): Raw3DNodeState {
    if (!Number.isFinite(time)) throw new RangeError("Animation time must be finite.");
    const node = this.nodes.get(nodeIndex);
    if (!node) throw new RangeError(`RAW3D node ${nodeIndex} is missing.`);
    time = Math.max(0, time);
    const tracks = this.byNode.get(nodeIndex) ?? [];
    const state: Raw3DNodeState = {
      location: triple(node.location, 0), rotation: triple(node.rotation, 0), scale: triple(node.scale, 1),
      quaternion: raw3DQuaternionFromRotation(node.rotation), visible: node.visible, deleted: false,
      parentIndex: node.parentIndex, meshIndex: node.meshIndex, layerIndex: node.layerIndex,
      interpolationMode: node.interpolationMode, interactionMode: node.interactionMode,
      highlight: node.highlight, hasBeenOptimized: node.hasBeenOptimized, materialProperties: {},
      userData: node.userData, clientOwner: node.clientOwner, isBillboard: node.isBillboard, isDecal: node.isDecal
    };
    Object.assign(state, this.effects.sampleNode(nodeIndex, time));
    for (const track of tracks.filter(track => track.kind === "InterpolationMode")) {
      state.interpolationMode = (sampleTrack(track, time, false) ?? state.interpolationMode) as Raw3DInterpolationMode;
    }
    for (const track of tracks) {
      const value = sampleTrack(track, time, state.interpolationMode !== Raw3DInterpolationMode.None);
      if (value === undefined) continue;
      const numeric = Number(value), axis = "XYZ".indexOf(track.kind.at(-1)!);
      if (track.kind.length === 1 && axis >= 0) state.location[axis] = numeric;
      else if (track.kind.startsWith("R") && axis >= 0) state.rotation[axis] = numeric;
      else if (track.kind.startsWith("S") && axis >= 0) state.scale[axis] = numeric;
      else switch (track.kind) {
        case "Visible": state.visible = Boolean(value);break;
        case "Delete": state.deleted = Boolean(value);break;
        case "Parent": state.parentIndex = numeric < 0 ? undefined : numeric;break;
        case "Mesh": state.meshIndex = numeric < 0 ? undefined : numeric;break;
        case "Layer": state.layerIndex = numeric < 0 ? undefined : numeric;break;
        case "InteractionMode": state.interactionMode = numeric;break;
        case "Highlight": state.highlight = numeric;break;
        case "HasBeenOptimized": state.hasBeenOptimized = Boolean(value);break;
        case "Material": (state.materialProperties[track.materialIndex] ??= {})[track.name!] = numeric;break;
      }
    }
    state.quaternion = raw3DQuaternionFromRotation(state.rotation);
    if (state.interpolationMode === Raw3DInterpolationMode.DualQuaternion) {
      const rigidTracks = tracks.filter(track => ["X", "Y", "Z", "RX", "RY", "RZ"].includes(track.kind));
      const times = this.rigidTimes.get(nodeIndex) ?? [];
      const rightIndex = times.findIndex(value => value > time);
      const left = times[rightIndex < 0 ? times.length-1 : rightIndex-1], right = times[rightIndex];
      if (left !== undefined && right !== undefined) {
        const pose = (at: number) => {
          const position = triple(node.location, 0), rotation = triple(node.rotation, 0);
          for (const track of rigidTracks) {
            const value = sampleTrack(track, at, true);
            if (value !== undefined) (track.kind.startsWith("R") ? rotation : position)["XYZ".indexOf(track.kind.at(-1)!)] = Number(value);
          }
          return { position, quaternion: raw3DQuaternionFromRotation(rotation) };
        };
        const result = interpolateRaw3DDualQuaternion(pose(left), pose(right), (time-left)/(right-left));
        state.location = [...result.position];state.quaternion = result.quaternion;
        state.rotation = [...raw3DRotationFromQuaternion(result.quaternion)];
      }
    }
    return state;
  }
}

function sampleTrack(track: Raw3DAnimationTrack, time: number, interpolate: boolean): Raw3DAnimationValue | undefined {
  if (time < track.times[0]!) return undefined;
  let low = 0, high = track.times.length;
  while (low < high) { const middle = (low+high) >>> 1;if (track.times[middle]! <= time) low = middle+1;else high = middle; }
  const index = low-1, value = track.values[index]!;
  const linear = continuous.has(track.kind) || (track.kind === "Material" && !discreteMaterialProperties.has(track.name!));
  if (!interpolate || !linear || index === track.times.length-1) return value;
  let delta = Number(track.values[index+1])-Number(value);
  if (track.kind.startsWith("R")) delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  return Number(value) + delta*(time-track.times[index]!)/(track.times[index+1]!-track.times[index]!);
}
