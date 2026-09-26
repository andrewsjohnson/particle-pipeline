// Static raw imports put every shader in Vite's production module graph.
// The guard lets CPU-only Node.js tests import node classes.
const sources: Record<string, string> = import.meta.env?.MODE !== undefined
  ? import.meta.glob("./*.wgsl", { query: "?raw", import: "default", eager: true })
  : {};

export function getShaderSource(path: string): string {
  const key = `./${path.split("/").pop()}`;
  const source = sources[key];
  if (source === undefined) throw new Error(`Unknown shader: ${path}`);
  return source.replace(/^\/\/ @include (\w+\.wgsl)$/gm, (_line, include: string) => {
    const shared = sources[`./${include}`];
    if (shared === undefined) throw new Error(`Unknown shader include: ${include}`);
    return shared;
  });
}

export class HotShader {
  module!: GPUShaderModule;
  listeners = new Set<(module: GPUShaderModule) => void | Promise<void>>();
  cachedSource = "";
  device: GPUDevice;
  path: string;

  constructor(device: GPUDevice, path: string) {
    this.device = device;
    this.path = path;
  }

  async load(code = getShaderSource(this.path)) {
    const module = this.device.createShaderModule({ label: this.path, code });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === "error");
    if (errors.length) {
      throw new Error(`${this.path}:\n${errors.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join("\n")}`);
    }
    this.module = module;
    this.cachedSource = code;
    for (const listener of this.listeners) await listener(module);
  }

  onReload(callback: (module: GPUShaderModule) => void | Promise<void>) {
    this.listeners.add(callback);
  }

  dispose() {
    this.listeners.clear();
    hotShaders.delete(this);
  }
}

const hotShaders: Set<HotShader> = import.meta.hot?.data.hotShaders ?? new Set();

export async function loadShaderModule(device: GPUDevice, path: string) {
  const shader = new HotShader(device, path);
  await shader.load();
  hotShaders.add(shader);
  return shader;
}

if (import.meta.hot) {
  import.meta.hot.dispose((data) => { data.hotShaders = hotShaders; });
  import.meta.hot.accept(async (updated) => {
    if (!updated) return;
    for (const shader of [...hotShaders]) {
      try {
        const source = updated.getShaderSource(shader.path);
        if (source !== shader.cachedSource) await shader.load(source);
      } catch (error) {
        console.error("Shader reload failed", error);
      }
    }
  });
}
