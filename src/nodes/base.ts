export abstract class GPUNode {
    abstract init(device: GPUDevice, ctx: any): Promise<void> | void;
    abstract record(encoder: GPUCommandEncoder, ctx: any): void;
}