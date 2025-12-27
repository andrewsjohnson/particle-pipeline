export class HotShader {
  device: GPUDevice;
  path: string;
  module: GPUShaderModule | null = null;
  listeners = new Set<(m: GPUShaderModule) => void>();
  cachedSource: string = "";

  constructor(device: GPUDevice, path: string) {
    this.device = device;
    this.path = path;
  }

  async load() {
    const code = await fetch(this.path).then(r => r.text());
    this.cachedSource = code
    
    this.module = this.device.createShaderModule({ code });
    this.listeners.forEach(cb => cb(this.module!));
  }

  onReload(cb: (m: GPUShaderModule) => void) {
    this.listeners.add(cb);
  }
}

const hotShaders = new Set<HotShader>();

export async function loadShaderModule(
  device: GPUDevice,
  path: string,
) {
  const hs = new HotShader(device, path);

  hotShaders.add(hs);
  await hs.load();
  return hs;
}

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeUpdate", async (payload: any) => {
    for (const shader of hotShaders) {
      if (payload.updates.some((u: any) => u.path.endsWith(shader.path))) {
        console.log("%c🔥 Reload WGSL:", "color:orange", shader.path);
        await shader.load();
      }
    }
  });
}