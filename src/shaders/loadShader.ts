import { PARTICLE_STRUCT_WGSL } from "../particles/particleLayout.ts";

type LoadShaderOptions = {
  /**
   * Some shaders (fullscreen blits, etc.) might not need the particle struct.
   * Defaults to true to minimize boilerplate for compute nodes.
   */
  includeParticleStruct?: boolean;
};

const shaderSourceCache = new Map<string, Promise<string>>();

async function fetchShaderSource(path: string) {
  if (!shaderSourceCache.has(path)) {
    shaderSourceCache.set(
      path,
      fetch(path).then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load shader "${path}": ${response.status}`);
        }
        return response.text();
      }),
    );
  }

  return shaderSourceCache.get(path)!;
}

export async function loadShaderModule(device: GPUDevice, path: string, options: LoadShaderOptions = {}) {
  const source = await fetchShaderSource(path);
  const includeParticleStruct = options.includeParticleStruct ?? true;
  const code = includeParticleStruct ? `${PARTICLE_STRUCT_WGSL}\n${source}` : source;
  return device.createShaderModule({ code });
}

