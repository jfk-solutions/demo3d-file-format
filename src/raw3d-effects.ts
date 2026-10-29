import type { Raw3DProject } from "./raw3d.js";
import type { Demo3DXmlElement } from "./xml.js";
import type { Raw3DAnimationWarning } from "./raw3d-animation.js";

export interface Raw3DLightState {
  enabled: boolean; type: number; attenuationRange: number;
  attenuationConstant: number; attenuationLinear: number; attenuationQuadratic: number;
  spotlightFalloff: number; spotlightInnerAngle: number; spotlightOuterAngle: number;
  castsShadows: boolean; materialProperties: Record<string, number>;
}
export interface Raw3DUIState { name: string; id?: string; visible: boolean; checked: boolean }
export interface Raw3DSceneState {
  showDefaultFloor: boolean; allowTeleportOnDefaultFloor: boolean;
  useDefaultLighting: boolean; ambientLightColor: [number, number, number];
}
export interface Raw3DEffectState {
  readonly lights: ReadonlyMap<number, Raw3DLightState>;
  readonly buttons: ReadonlyMap<number, Raw3DUIState>;
  readonly scene: Raw3DSceneState;
}
export interface Raw3DEffectTrack {
  readonly kind: string; readonly target: "node" | "light" | "scene" | "ui";
  readonly index: number; readonly property: string;
  readonly times: readonly number[]; readonly values: readonly (number | boolean | string)[];
  readonly xml: Demo3DXmlElement;
}
export interface Raw3DStringKeyRequest {
  readonly xml: Demo3DXmlElement; readonly nodeIndex: number; readonly property: string;
  readonly times: readonly number[]; readonly encoded: string;
}
export interface Raw3DAnimationOptions {
  /** Supply authoritative keys, for example from a sidecar, without guessing native string boundaries. */
  readonly resolveStringKeys?: (request: Raw3DStringKeyRequest) => readonly string[] | undefined;
}
const mappings: Record<string, [Raw3DEffectTrack["target"], string, "number" | "integer" | "boolean" | "string" | "hex"]> = {
  UserData: ["node", "userData", "string"], ClientOwner: ["node", "clientOwner", "string"],
  IsBillboard: ["node", "isBillboard", "boolean"], IsDecal: ["node", "isDecal", "boolean"],
  H: ["node", "highlight", "integer"], Optimized: ["node", "hasBeenOptimized", "boolean"],
  LightType: ["light", "type", "integer"], LightEnabled: ["light", "enabled", "boolean"],
  LightAR: ["light", "attenuationRange", "number"], LightAC: ["light", "attenuationConstant", "number"],
  LightAL: ["light", "attenuationLinear", "number"], LightAQ: ["light", "attenuationQuadratic", "number"],
  LightSF: ["light", "spotlightFalloff", "number"], LightSIA: ["light", "spotlightInnerAngle", "number"],
  LightSOA: ["light", "spotlightOuterAngle", "number"], LightCS: ["light", "castsShadows", "boolean"],
  LightMaterial: ["light", "material:Diffuse", "hex"],
  SceneShowDefaultFloor: ["scene", "showDefaultFloor", "boolean"],
  SceneAllowTeleportOnDefaultFloor: ["scene", "allowTeleportOnDefaultFloor", "boolean"],
  SceneUseDefaultLighting: ["scene", "useDefaultLighting", "boolean"],
  ALR: ["scene", "ambient:0", "number"], ALG: ["scene", "ambient:1", "number"], ALB: ["scene", "ambient:2", "number"],
  UIVisible: ["ui", "visible", "boolean"], UIChecked: ["ui", "checked", "boolean"],
  UpdateUIVisible: ["ui", "visible", "boolean"], UpdateUIChecked: ["ui", "checked", "boolean"]
};
export const isRaw3DEffectChannel = (kind: string): boolean => kind in mappings;
const attribute = (xml: Demo3DXmlElement, name: string) => xml.attributes.find(a => a.localName === name)?.value;
const tokens = (value: string) => value.trim().split(/\s+/).filter(Boolean);

/** Native non-transform updates, independent of presentation and interaction. */
export class Raw3DEffects {
  readonly tracks: readonly Raw3DEffectTrack[];
  readonly warnings: readonly Raw3DAnimationWarning[];
  constructor(private readonly project: Raw3DProject, options: Raw3DAnimationOptions = {}) {
    const tracks: Raw3DEffectTrack[] = [], warnings: Raw3DAnimationWarning[] = [];
    const targets = {
      node: new Set(project.nodes.map(node => node.index)),
      light: new Set(project.lights.map((light, index) => light.index ?? index)),
      ui: new Set(project.buttons.map(button => button.index)), scene: new Set([0])
    };
    for (const xml of project.root.child("Updates")?.children ?? []) {
      const mapping = mappings[xml.localName];
      if (!mapping) continue;
      const [target, initialProperty, format] = mapping;
      const index = target === "scene" ? 0 : Number(attribute(xml, { node: "Node", light: "Light", ui: "UIButton" }[target]) ?? NaN);
      if (!Number.isInteger(index) || !targets[target].has(index)) throw new Error(`Invalid RAW3D ${xml.localName} target ${index}.`);
      const times = tokens(attribute(xml, "Time") ?? "").map(Number);
      if (!times.length || times.some((time, i) => !Number.isFinite(time) || time < 0 || (i > 0 && time < times[i-1]!))) throw new Error(`Invalid RAW3D ${xml.localName} times.`);
      const encoded = attribute(xml, "Value") ?? "";
      let raw: readonly string[] = format === "string" && times.length === 1 ? [encoded] : tokens(encoded);
      if (format === "string") {
        const explicit = xml.child("Values")?.childrenNamed("Value").map(value => value.text);
        let resolved = explicit ?? options.resolveStringKeys?.({ xml, nodeIndex: index, property: initialProperty, times, encoded });
        if (attribute(xml, "ValueEncoding") === "json" && !explicit && !resolved) resolved = JSON.parse(encoded) as unknown as readonly string[];
        if (resolved !== undefined) {
          if (!Array.isArray(resolved) || resolved.length !== times.length || !resolved.every(value => typeof value === "string")) throw new Error(`Invalid resolved RAW3D ${xml.localName} string keys.`);
          raw = resolved;
        }
      }
      if (format === "string" && raw.length !== times.length) {
        warnings.push({ code: "RAW3D_STRING_KEYS_AMBIGUOUS", message: `RAW3D ${xml.localName} string boundaries cannot be recovered from the native space-separated Value attribute.`, xml });
        continue;
      }
      const values = raw.map(value => {
        if (format === "string") return value;
        if (format === "boolean") {
          if (!/^(true|false|0|1)$/i.test(value)) throw new Error(`Invalid RAW3D ${xml.localName} boolean.`);
          return /^(true|1)$/i.test(value);
        }
        if (format === "hex" && !/^(?:0x)?[a-f\d]{1,8}$/i.test(value)) throw new Error(`Invalid RAW3D ${xml.localName} ARGB value.`);
        const number = format === "hex" ? Number.parseInt(value.replace(/^0x/i, ""), 16) : Number(value);
        if (!Number.isFinite(number) || (format === "integer" && !Number.isInteger(number))) throw new Error(`Invalid RAW3D ${xml.localName} value.`);
        return number;
      });
      if (values.length !== times.length) throw new Error(`Invalid RAW3D ${xml.localName} value count.`);
      tracks.push({ kind: xml.localName, target, index, property: initialProperty, times, values, xml });
    }
    this.tracks = tracks;this.warnings = warnings;
  }

  sampleNode(index: number, time: number): Record<string, number | boolean | string> {
    const state: Record<string, number | boolean | string> = {};
    for (const track of this.tracks) if (track.target === "node" && track.index === index) {
      const value = sample(track, time);if (value !== undefined) state[track.property] = value;
    }
    return state;
  }

  sample(time: number): Raw3DEffectState {
    if (!Number.isFinite(time)) throw new RangeError("Animation time must be finite.");
    time = Math.max(0, time);
    const lights = new Map<number, Raw3DLightState>(this.project.lights.map((light, index) => [light.index ?? index, {
      enabled: light.enabled, type: ({ ambient: 0, point: 1, spot: 2, directional: 3 } as Record<string, number>)[light.type.toLowerCase()] ?? Number(light.type),
      attenuationRange: light.attenuationRange, attenuationConstant: light.attenuationConstant,
      attenuationLinear: light.attenuationLinear, attenuationQuadratic: light.attenuationQuadratic,
      spotlightFalloff: light.spotlightFalloff, spotlightInnerAngle: light.spotlightInnerAngle, spotlightOuterAngle: light.spotlightOuterAngle,
      castsShadows: light.castsShadows, materialProperties: {}
    }]));
    const buttons = new Map(this.project.buttons.map(button => [button.index, { name: button.name, id: button.id, visible: button.visible, checked: button.checked }]));
    const properties = this.project.sceneProperties;
    const scene: Raw3DSceneState = {
      showDefaultFloor: properties?.showDefaultFloor ?? true,
      allowTeleportOnDefaultFloor: properties?.allowTeleportOnDefaultFloor ?? true,
      useDefaultLighting: properties?.useDefaultLighting ?? true,
      ambientLightColor: [0,1,2].map(i => properties?.ambientLightColor[i] ?? 0) as [number,number,number]
    };
    for (const track of this.tracks) {
      if (track.target === "node") continue;
      const value = sample(track, time);if (value === undefined) continue;
      if (track.target === "light") {
        const state = lights.get(track.index)!;
        if (track.property.startsWith("material:")) state.materialProperties[track.property.slice(9)] = Number(value);
        else Object.assign(state, { [track.property]: value });
      } else if (track.target === "ui") Object.assign(buttons.get(track.index)!, { [track.property]: value });
      else if (track.property.startsWith("ambient:")) scene.ambientLightColor[Number(track.property.slice(8))] = Number(value);
      else Object.assign(scene, { [track.property]: value });
    }
    return { lights, buttons, scene };
  }
}

/** Native distance/cone attenuation, usable by renderers other than Three.js. */
export function evaluateRaw3DLightAttenuation(light: Raw3DLightState, distance: number, cosine = 1): number {
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(cosine)) throw new RangeError("Light distance and cone cosine must be finite.");
  if (light.type === 3 || light.type === 0) return 1;
  if (light.attenuationRange > 0 && distance > light.attenuationRange) return 0;
  let attenuation = 1/Math.max(.000001, light.attenuationConstant + distance*light.attenuationLinear + distance*distance*light.attenuationQuadratic);
  if (light.type === 2) {
    const inner = Math.cos(light.spotlightInnerAngle/2), outer = Math.cos(light.spotlightOuterAngle/2);
    if (cosine < outer) return 0;
    const factor = inner-outer > .000001 ? Math.max(0, Math.min(1, (cosine-outer)/(inner-outer))) : cosine >= outer ? 1 : 0;
    attenuation *= Math.pow(factor, Math.max(.000001, light.spotlightFalloff));
  }
  return attenuation;
}

function sample(track: Raw3DEffectTrack, time: number): number | boolean | string | undefined {
  if (time < track.times[0]!) return undefined;
  let low = 0, high = track.times.length;
  while (low < high) { const middle = (low+high) >>> 1;if (track.times[middle]! <= time) low = middle+1;else high = middle; }
  const i = low-1, current = track.values[i]!;
  const next = track.values[i+1];
  if (typeof current === "number" && typeof next === "number" && (track.property.startsWith("attenuation") || track.property.startsWith("spotlight") || track.property.startsWith("ambient:"))) {
    return current + (next-current)*(time-track.times[i]!)/(track.times[i+1]!-track.times[i]!);
  }
  return current;
}
