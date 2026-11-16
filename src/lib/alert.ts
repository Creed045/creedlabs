// Tiny new-order chime using the Web Audio API (no sound file needed).
// Browsers only allow audio after a user gesture, so call unlockAudio()
// from a click handler (e.g. the "Enable sound" button) first.

let ctx: AudioContext | null = null

export async function unlockAudio(): Promise<boolean> {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    return ctx.state === 'running'
  } catch {
    return false
  }
}

export function playChime(): void {
  if (!ctx || ctx.state !== 'running') return
  const now = ctx.currentTime
  const notes = [880, 1174.66, 1567.98] // A5, D6, G6
  notes.forEach((freq, i) => {
    const osc = ctx!.createOscillator()
    const gain = ctx!.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = now + i * 0.18
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
    osc.connect(gain).connect(ctx!.destination)
    osc.start(start)
    osc.stop(start + 0.55)
  })
}

export function vibrate(): void {
  if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200])
}
