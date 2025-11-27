export abstract class GPUNode {
    abstract init(device: GPUDevice, ctx: any): Promise<void> | void;
    /**
     * Return `false` to signal that no writes occurred and ping-pong buffers
     * should not be swapped after this node.
     */
    abstract record(encoder: GPUCommandEncoder, ctx: any): boolean | void;
    abstract stage: GPUNodeStage;
}

export type GPUNodeStage = "compute" | "render";