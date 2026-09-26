export const SIMULATION_STEP = 1 / 60;

/** Bounded scheduling; overloaded previews slow down without larger steps. */
export class FixedStepClock {
  private remainder = 0;

  readonly step: number;
  readonly maxSteps: number;

  constructor(step = SIMULATION_STEP, maxSteps = 4) {
    this.step = step;
    this.maxSteps = maxSteps;
    if (!Number.isFinite(step) || step <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new Error("Invalid fixed-step clock configuration");
    }
  }

  reset() {
    this.remainder = 0;
  }

  advance(elapsed: number, tick: (dt: number) => void): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    this.remainder += Math.min(elapsed, this.step * this.maxSteps);
    const count = Math.min(this.maxSteps, Math.floor((this.remainder + this.step * 1e-9) / this.step));
    for (let i = 0; i < count; i++) tick(this.step);
    this.remainder = Math.max(0, this.remainder - count * this.step);
    return count;
  }
}
