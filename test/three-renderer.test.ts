import { describe, expect, it, vi } from "vitest";
import {
  createDemo3DThreeRenderer,
  type Demo3DThreeModule,
  type Demo3DThreeWebGPUModule
} from "../src/three/index.js";

describe("Three canvas renderer selection", () => {
  it("lazy-loads and selects WebGPU when it is available", async () => {
    const init = vi.fn(async () => undefined);
    const webGPU = moduleWithWebGPURenderer(class {
      readonly backend = { isWebGPUBackend: true };
      readonly init = init;
    });
    const loadThree = vi.fn(async () => moduleWithWebGLRenderer(class {}));

    const selected = await createDemo3DThreeRenderer({
      isWebGPUAvailable: () => true,
      loadThreeWebGPU: async () => webGPU,
      loadThree
    });

    expect(selected.backend).toBe("webgpu");
    expect(selected.three).toBe(webGPU);
    expect(selected.fallback).toBeUndefined();
    expect(init).toHaveBeenCalledOnce();
    expect(loadThree).not.toHaveBeenCalled();
  });

  it("does not load the WebGPU module when capability detection fails", async () => {
    const webGL = moduleWithWebGLRenderer(class {});
    const loadThreeWebGPU = vi.fn(async () => moduleWithWebGPURenderer(class {}));
    const onFallback = vi.fn();

    const selected = await createDemo3DThreeRenderer({
      isWebGPUAvailable: () => false,
      loadThreeWebGPU,
      loadThree: async () => webGL,
      onFallback
    });

    expect(selected.backend).toBe("webgl");
    expect(selected.three).toBe(webGL);
    expect(selected.fallback?.code).toBe("DEMO3D_WEBGPU_UNAVAILABLE");
    expect(loadThreeWebGPU).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("falls back to WebGL when WebGPU initialization throws", async () => {
    const failure = new Error("GPU device was lost");
    const webGPU = moduleWithWebGPURenderer(class {
      readonly backend = { isWebGPUBackend: true };
      async init(): Promise<void> {
        throw failure;
      }
    });
    const webGL = moduleWithWebGLRenderer(class {});

    const selected = await createDemo3DThreeRenderer({
      isWebGPUAvailable: () => true,
      loadThreeWebGPU: async () => webGPU,
      loadThree: async () => webGL
    });

    expect(selected.backend).toBe("webgl");
    expect(selected.three).toBe(webGL);
    expect(selected.fallback).toMatchObject({
      code: "DEMO3D_WEBGPU_INIT_FAILED",
      cause: failure
    });
  });

  it("reports Three's internal WebGL 2 backend fallback", async () => {
    const webGPU = moduleWithWebGPURenderer(class {
      readonly backend = { isWebGLBackend: true };
      async init(): Promise<void> {}
    });

    const selected = await createDemo3DThreeRenderer({
      isWebGPUAvailable: () => true,
      loadThreeWebGPU: async () => webGPU
    });

    expect(selected.backend).toBe("webgl");
    expect(selected.three).toBe(webGPU);
    expect(selected.fallback?.code).toBe("DEMO3D_WEBGPU_BACKEND_FALLBACK");
  });
});

function moduleWithWebGLRenderer(constructor: new (options?: unknown) => unknown): Demo3DThreeModule {
  return { WebGLRenderer: constructor } as unknown as Demo3DThreeModule;
}

function moduleWithWebGPURenderer(constructor: new (options?: unknown) => unknown): Demo3DThreeWebGPUModule {
  return { WebGPURenderer: constructor } as unknown as Demo3DThreeWebGPUModule;
}
