let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioContext) audioContext = new Ctor();
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  durationMs: number,
  type: OscillatorType = "sine",
  volume = 0.22,
): void {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = ctx.currentTime + startAt;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.05);
  } catch {
    // ignore audio glitches
  }
}

/** Rich, welcoming multi-tone chime for successful check-ins. */
export function playSuccessChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  // Upbeat major chord arpeggio (C5 -> E5 -> G5 -> C6)
  tone(ctx, 523.25, 0, 90, "sine", 0.25);
  tone(ctx, 659.25, 0.08, 90, "sine", 0.25);
  tone(ctx, 783.99, 0.16, 120, "triangle", 0.3);
  tone(ctx, 1046.5, 0.24, 280, "sine", 0.28);
}

/** Distinct low-frequency double buzz for denied/failed check-ins. */
export function playErrorBuzz(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  // First warning pulse (sawtooth low buzz)
  tone(ctx, 150, 0, 160, "sawtooth", 0.26);
  tone(ctx, 180, 0, 160, "sine", 0.2);
  // Second warning pulse
  tone(ctx, 130, 0.22, 220, "sawtooth", 0.28);
  tone(ctx, 160, 0.22, 220, "sine", 0.22);
}

/** High-pitch crisp beep for barcode scan feedback (mimics optical scanner). */
export function playScanBeep(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  tone(ctx, 1760, 0, 70, "sine", 0.22);
}
