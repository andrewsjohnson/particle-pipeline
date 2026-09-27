export type ToneMap = 'aces' | 'reinhard' | 'linear';
export type ColorSettings = {exposureEV: number; whiteBalance: number[]; toneMap: ToneMap};
export const defaultColor = (): ColorSettings => ({exposureEV:0, whiteBalance:[1,1,1], toneMap:'aces'});
export function linearToSRGB(value: number) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1/2.4) - 0.055;
}
export function toneMapValue(value: number, toneMap: ToneMap) {
  if (toneMap === 'reinhard') return value / (1+value);
  if (toneMap === 'linear') return value;
  return value * (2.51*value+0.03) / (value*(2.43*value+0.59)+0.14);
}
/** Linear-sRGB input, display-sRGB output. EXR intentionally bypasses grading. */
export function gradeChannel(value: number, channel: number, settings: ColorSettings) {
  const linear = Math.max(0, Number.isFinite(value) ? value : 0) *
    2 ** Math.max(-20, Math.min(20, settings.exposureEV)) * Math.max(0, settings.whiteBalance[channel]);
  return linearToSRGB(Math.max(0, Math.min(1, toneMapValue(linear, settings.toneMap))));
}
