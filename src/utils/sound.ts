let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioContext) audioContext = new Ctor();
    return audioContext;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, freq: number, startAt: number, durationMs: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
  gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + durationMs / 1000 + 0.05);
}

/** Short two-tone success chime for check-ins. */
export function playSuccessChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  tone(ctx, 880, 0, 90);
  tone(ctx, 1320, 0.1, 140);
}

/** Low buzz used when a scan is denied. */
export function playErrorBuzz(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  tone(ctx, 220, 0, 220);
}
