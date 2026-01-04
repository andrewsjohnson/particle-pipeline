import { Pipeline } from "./pipeline.ts";
import { SpawnSphereNode } from "./nodes/spawnSphere.ts";
import { IntegratorNode } from "./nodes/integrator.ts";
import { RenderParticlesNode } from "./nodes/renderParticles.ts";
import { CompositeNode } from "./nodes/composite.ts";
// import { parseParticles, readGPUBuffer } from "./utils/debug.ts";
import { CurlNoiseNode } from "./nodes/curlNoise.ts";
import { DragNode } from "./nodes/drag.ts";
import { SetSpawnColorNode } from "./nodes/setSpawnColor.ts";
import { SetSpawnMassNode } from "./nodes/setSpawnMass.ts";
import { InitializeParticlesNode } from "./nodes/initializeParticles.ts";
import { MinVelKillNode } from "./nodes/minVelKill.ts";
import { OpacityScaleNode } from "./nodes/opacityScale.ts";
import { buildControlPanel } from "./ui/controlPanel.ts";
import { FlockingNode } from "./nodes/flocking.ts";

async function main() {
  const canvas = document.getElementById("gfx") as HTMLCanvasElement;

  if (!navigator.gpu) {
    alert("WebGPU not supported");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    alert("No WebGPU adapter found");
    return;
  }

  const device = await adapter.requestDevice({
    requiredFeatures: ["texture-formats-tier1", "texture-formats-tier2", "float32-filterable", "float32-blendable"],
    requiredLimits: {
      maxBufferSize: 4 * 1024 * 1024 * 1024,
      maxStorageBufferBindingSize: 1024 * 1024 * 1024,
    }
  });

  if (!device) {
    alert("No WebGPU device found");
    return;
  }

  const ctx = canvas.getContext("webgpu");
  if (!ctx) {
    alert("No WebGPU context found");
    return;
  }

  // Simulation Parameters
  const particleCount = 3_000_000;
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;

  const pipeline = new Pipeline(device, ctx, {
    particleCount,
    renderWidth: canvas.width,
    renderHeight: canvas.height,
    particleTextureFormat: "rgba32float"
  })

  const renderParticlesNode = new RenderParticlesNode();
  const compositeNode = new CompositeNode();

  const hdrState = { enabled: false };
  const configureCanvas = (enableHdr: boolean) => {
    hdrState.enabled = enableHdr;
    const format: GPUTextureFormat = enableHdr
      ? "rgba16float"
      : navigator.gpu.getPreferredCanvasFormat();

    // If node isn't initialized yet, it will pick up targetFormat during init.
    compositeNode.setTargetFormat(format, device);
    // Tone map only in SDR mode
    compositeNode.setToneMapping(!enableHdr, device);

    ctx.configure({
      device,
      format,
      alphaMode: "premultiplied",
    });
  };

  configureCanvas(hdrState.enabled);

  pipeline.addNode(new InitializeParticlesNode());
  pipeline.addNode(new SpawnSphereNode());
  pipeline.addNode(new SetSpawnColorNode());  
  pipeline.addNode(new SetSpawnMassNode());
  pipeline.addNode(new DragNode());
  pipeline.addNode(new CurlNoiseNode());
  // pipeline.addNode(new FlockingNode());
  pipeline.addNode(new IntegratorNode());
  pipeline.addNode(new MinVelKillNode());
  pipeline.addNode(new OpacityScaleNode());
  pipeline.addNode(renderParticlesNode);
  pipeline.addNode(compositeNode);

  await pipeline.init();

  const simState = { paused: false };
  const updateCanvasSize = () => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    pipeline.resizeRenderTarget(canvas.width, canvas.height);
  };
  updateCanvasSize();

  buildControlPanel({
    pipeline,
    simState,
    hdrEnabled: hdrState.enabled,
    onPauseChange: (paused) => {
      simState.paused = paused;
      last = performance.now();
    },
    onReset: () => {
      updateCanvasSize();
      pipeline.resetSimulation();
    },
    onToggleHdr: (enabled) => {
      configureCanvas(enabled);
    },
    onSaveExr: async () => {
      const { width, height, data } = await pipeline.readHDRTexture();
      const flipped = flipRows(data, width, height);
      const exrBytes = encodeEXR(flipped, width, height);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const exrBuf = new ArrayBuffer(exrBytes.byteLength);
      new Uint8Array(exrBuf).set(exrBytes);
      const url = URL.createObjectURL(
        new Blob([exrBuf], { type: "application/octet-stream" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `particles-${timestamp}.exr`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      console.log("Saved EXR frame:", a.download, "bytes:", exrBytes.byteLength);
    },
    onSaveHdr: async () => {
      const { width, height, data } = await pipeline.readHDRTexture();
      const hdrBytes = encodeRGBE(flipRows(data, width, height), width, height);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const hdrBuf = new ArrayBuffer(hdrBytes.byteLength);
      new Uint8Array(hdrBuf).set(hdrBytes);
      const url = URL.createObjectURL(
        new Blob([hdrBuf], { type: "application/octet-stream" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `particles-hdr-${timestamp}.hdr`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      console.log(
        "Saved Radiance HDR frame:",
        a.download,
        "bytes:",
        hdrBytes.byteLength
      );
    },
  });

  function encodeRGBE(
    data: Float32Array,
    width: number,
    height: number
  ): Uint8Array {
    const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
    const headerBytes = new TextEncoder().encode(header);
    const pixels = new Uint8Array(width * height * 4);

    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4 + 0];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const maxc = Math.max(r, g, b);
      if (maxc < 1e-9 || !Number.isFinite(maxc)) {
        pixels.set([0, 0, 0, 0], i * 4);
        continue;
      }
      const e = Math.ceil(Math.log2(maxc));
      const scale = Math.pow(2, e - 8);
      pixels[i * 4 + 0] = Math.min(255, Math.max(0, Math.round(r / scale)));
      pixels[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(g / scale)));
      pixels[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(b / scale)));
      pixels[i * 4 + 3] = e + 128;
    }

    const out = new Uint8Array(headerBytes.length + pixels.length);
    out.set(headerBytes, 0);
    out.set(pixels, headerBytes.length);
    return out;
  }

  function flipRows(
    src: Float32Array,
    width: number,
    height: number
  ): Float32Array {
    const dst = new Float32Array(src.length);
    const rowSize = width * 4;
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * rowSize;
      const dstRow = y * rowSize;
      dst.set(src.subarray(srcRow, srcRow + rowSize), dstRow);
    }
    return dst;
  }

  function encodeEXR(
    data: Float32Array,
    width: number,
    height: number
  ): Uint8Array {
    // Build the EXR header into a small byte array first.
    const header: number[] = [];

    const pushUint32 = (arr: number[], v: number) => {
      arr.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    };
    const pushStringNull = (arr: number[], s: string) => {
      for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i));
      arr.push(0);
    };
    const pushAttr = (name: string, type: string, payload: number[]) => {
      pushStringNull(header, name);
      pushStringNull(header, type);
      pushUint32(header, payload.length);
      header.push(...payload);
    };

    // Magic number and version (no flags)
    pushUint32(header, 20000630);
    pushUint32(header, 2); // version field with no extra flags

    // channels attribute (B, G, R), float32 (type=2)
    (() => {
      const payload: number[] = [];
      const pushChan = (name: string) => {
        for (let i = 0; i < name.length; i++) payload.push(name.charCodeAt(i));
        payload.push(0);
        payload.push(2, 0, 0, 0); // pixel type FLOAT
        payload.push(0, 0, 0, 0); // pLinear + reserved
        payload.push(1, 0, 0, 0); // xSampling
        payload.push(1, 0, 0, 0); // ySampling
      };
      pushChan("B");
      pushChan("G");
      pushChan("R");
      payload.push(0); // end of list
      pushAttr("channels", "chlist", payload);
    })();

    // compression: NO_COMPRESSION (0)
    pushAttr("compression", "compression", [0]);

    const makeBoxPayload = () => {
      const p: number[] = [];
      const pushInt = (v: number) => {
        p.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
      };
      pushInt(0); // xmin
      pushInt(0); // ymin
      pushInt(width - 1); // xmax
      pushInt(height - 1); // ymax
      return p;
    };
    pushAttr("dataWindow", "box2i", makeBoxPayload());
    pushAttr("displayWindow", "box2i", makeBoxPayload());

    // lineOrder: 0 (INCREASING_Y)
    pushAttr("lineOrder", "lineOrder", [0]);

    // pixelAspectRatio: float 1.0
    (() => {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, 1.0, true);
      pushAttr("pixelAspectRatio", "float", Array.from(new Uint8Array(buf)));
    })();

    // screenWindowCenter: v2f (0,0)
    (() => {
      const buf = new ArrayBuffer(8);
      const dv = new DataView(buf);
      dv.setFloat32(0, 0, true);
      dv.setFloat32(4, 0, true);
      pushAttr("screenWindowCenter", "v2f", Array.from(new Uint8Array(buf)));
    })();

    // screenWindowWidth: float 1.0
    (() => {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, 1.0, true);
      pushAttr("screenWindowWidth", "float", Array.from(new Uint8Array(buf)));
    })();

    // End of header
    header.push(0);

    const headerLen = header.length;
    const lineDataSize = width * 3 * 4; // B,G,R float per pixel
    const perScanlineBlock = 8 + lineDataSize; // y (4) + data size (4) + data
    const offsetsSize = height * 8;
    const dataStart = headerLen + offsetsSize;
    const totalBytes = dataStart + perScanlineBlock * height;

    const out = new Uint8Array(totalBytes);
    out.set(header, 0);
    const dvOut = new DataView(out.buffer);

    // Offsets table (64-bit, little-endian)
    let offsetPos = headerLen;
    for (let y = 0; y < height; y++) {
      const off = dataStart + y * perScanlineBlock;
      dvOut.setUint32(offsetPos, off >>> 0, true);
      dvOut.setUint32(offsetPos + 4, Math.floor(off / 0x100000000), true);
      offsetPos += 8;
    }

    // Scanline blocks
    let pos = dataStart;
    for (let y = 0; y < height; y++) {
      dvOut.setInt32(pos, y, true);
      dvOut.setInt32(pos + 4, lineDataSize, true);
      pos += 8;

      const rowStart = y * width * 4;
      // Channel order B, G, R
      for (const c of [2, 1, 0]) {
        for (let x = 0; x < width; x++) {
          dvOut.setFloat32(pos, data[rowStart + x * 4 + c], true);
          pos += 4;
        }
      }
    }

    return out;
  }

  let last = performance.now();

  function frame() {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    if (!simState.paused) {
      pipeline.frame(dt);
    }

    // Debug once after spawn runs
  //   if (pipeline.frameIndex === 2) {
  //     const size = pipeline.particleCount * PARTICLE_SIZE;
  //     readGPUBuffer(device, pipeline.currentParticleBuffer, size).then(buf => {
  //         const arr = parseParticles(buf, pipeline.particleCount);
  //         console.table(arr);
  //     });
  // }

    requestAnimationFrame(frame);
  }

  frame();
  console.log("canvas size", canvas.width, canvas.height);
  console.log("ctx format", navigator.gpu.getPreferredCanvasFormat());
  console.log("render target view", pipeline.renderTextureView);
  console.log("pipeline", pipeline);
}

main();