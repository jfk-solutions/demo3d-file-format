import type * as Three from "three";
import type * as ThreeWebGPU from "three/webgpu";

export type Demo3DThreeModule = typeof Three;
export type Demo3DThreeWebGPUModule = typeof ThreeWebGPU;
export type Demo3DThreeRendererInstance = Three.WebGLRenderer | ThreeWebGPU.WebGPURenderer;
export type Demo3DThreeRenderBackend = "webgpu" | "webgl";

export interface Demo3DThreeRendererFallback {
  readonly code:
    | "DEMO3D_WEBGPU_UNAVAILABLE"
    | "DEMO3D_WEBGPU_INIT_FAILED"
    | "DEMO3D_WEBGPU_BACKEND_FALLBACK";
  readonly message: string;
  readonly cause?: unknown;
}

export interface Demo3DThreeCanvasRendererOptions {
  readonly canvas?: HTMLCanvasElement | OffscreenCanvas;
  readonly preferWebGPU?: boolean;
  readonly antialias?: boolean;
  readonly alpha?: boolean;
  readonly preserveDrawingBuffer?: boolean;
  readonly powerPreference?: "high-performance" | "low-power";
  readonly loadThree?: () => Promise<Demo3DThreeModule>;
  readonly loadThreeWebGPU?: () => Promise<Demo3DThreeWebGPUModule>;
  readonly isWebGPUAvailable?: () => boolean | Promise<boolean>;
  readonly onFallback?: (fallback: Demo3DThreeRendererFallback) => void;
}

export interface Demo3DThreeRendererResult {
  readonly three: Demo3DThreeModule;
  readonly renderer: Demo3DThreeRendererInstance;
  readonly backend: Demo3DThreeRenderBackend;
  readonly fallback?: Demo3DThreeRendererFallback;
}

export async function createDemo3DThreeRenderer(
  options: Demo3DThreeCanvasRendererOptions = {}
): Promise<Demo3DThreeRendererResult> {
  let fallback: Demo3DThreeRendererFallback | undefined;

  if (options.preferWebGPU !== false) {
    let available = false;
    try {
      available = await (options.isWebGPUAvailable?.() ?? detectWebGPU(options.powerPreference));
    } catch (cause) {
      fallback = createFallback(
        "DEMO3D_WEBGPU_UNAVAILABLE",
        "WebGPU capability detection failed; using WebGL.",
        cause
      );
    }

    if (available) {
      try {
        const three = await (options.loadThreeWebGPU?.() ?? import("three/webgpu"));
        const renderer = new three.WebGPURenderer({
          canvas: options.canvas,
          antialias: options.antialias,
          alpha: options.alpha ?? false,
          powerPreference: options.powerPreference
        });
        await renderer.init();

        if (isWebGPUBackend(renderer.backend)) {
          return {
            three: three as unknown as Demo3DThreeModule,
            renderer,
            backend: "webgpu"
          };
        }

        fallback = createFallback(
          "DEMO3D_WEBGPU_BACKEND_FALLBACK",
          "Three.js could not initialize WebGPU and selected its WebGL 2 backend."
        );
        options.onFallback?.(fallback);
        return {
          three: three as unknown as Demo3DThreeModule,
          renderer,
          backend: "webgl",
          fallback
        };
      } catch (cause) {
        fallback = createFallback(
          "DEMO3D_WEBGPU_INIT_FAILED",
          "WebGPU initialization failed; using WebGL.",
          cause
        );
      }
    } else if (!fallback) {
      fallback = createFallback(
        "DEMO3D_WEBGPU_UNAVAILABLE",
        "WebGPU is not available; using WebGL."
      );
    }

    options.onFallback?.(fallback);
  }

  const three = await (options.loadThree?.() ?? import("three"));
  const renderer = new three.WebGLRenderer({
    canvas: options.canvas,
    antialias: options.antialias,
    alpha: options.alpha ?? false,
    preserveDrawingBuffer: options.preserveDrawingBuffer,
    powerPreference: options.powerPreference
  });

  return {
    three,
    renderer,
    backend: "webgl",
    fallback
  };
}

async function detectWebGPU(
  powerPreference: "high-performance" | "low-power" | undefined
): Promise<boolean> {
  const gpu = (globalThis.navigator as Navigator & {
    gpu?: {
      requestAdapter(options?: {
        powerPreference?: "high-performance" | "low-power";
        featureLevel?: "compatibility";
      }): Promise<unknown>;
    };
  } | undefined)?.gpu;

  if (!gpu) {
    return false;
  }

  return Boolean(await gpu.requestAdapter({ powerPreference, featureLevel: "compatibility" }));
}

function isWebGPUBackend(backend: unknown): boolean {
  return Boolean((backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend);
}

function createFallback(
  code: Demo3DThreeRendererFallback["code"],
  message: string,
  cause?: unknown
): Demo3DThreeRendererFallback {
  return { code, message, cause };
}
