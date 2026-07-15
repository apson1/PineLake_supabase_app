// Web Audio Synthesizer for Pine Lake Kiosk System
let audioCtx = null

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume()
  }
  return audioCtx
}

/**
 * Play a high-quality snappy mechanical button click sound
 */
export function playClick() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime
    
    // Oscillator
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()
    
    osc.type = "sine"
    osc.frequency.setValueAtTime(650, now) // initial frequency
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.04) // pitch drop
    
    gainNode.gain.setValueAtTime(0.08, now)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.04) // quick decay
    
    osc.connect(gainNode)
    gainNode.connect(ctx.destination)
    
    osc.start(now)
    osc.stop(now + 0.05)
  } catch (err) {
    console.warn("AudioContext blocked or failed to play click tone:", err)
  }
}

/**
 * Play an ascending clean chord arpeggio chime on success
 */
export function playSuccess() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime
    
    // Play an ascending arpeggio: C5 -> E5 -> G5 -> C6
    const notes = [523.25, 659.25, 783.99, 1046.50]
    
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gainNode = ctx.createGain()
      
      osc.type = "triangle"
      osc.frequency.setValueAtTime(freq, now + idx * 0.07)
      
      gainNode.gain.setValueAtTime(0, now + idx * 0.07)
      gainNode.gain.linearRampToValueAtTime(0.12, now + idx * 0.07 + 0.02)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.4)
      
      osc.connect(gainNode)
      gainNode.connect(ctx.destination)
      
      osc.start(now + idx * 0.07)
      osc.stop(now + idx * 0.07 + 0.45)
    })
  } catch (err) {
    console.warn("AudioContext failed to play success chime:", err)
  }
}

/**
 * Play a low double-beep alert on error/rejection
 */
export function playError() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime
    
    const beeps = [0, 0.15]
    
    beeps.forEach((delay) => {
      const osc = ctx.createOscillator()
      const gainNode = ctx.createGain()
      
      osc.type = "sawtooth" // harsher wave for errors
      osc.frequency.setValueAtTime(180, now + delay) // low pitch
      
      // Pass through a lowpass filter to soften the sawtooth
      const filter = ctx.createBiquadFilter()
      filter.type = "lowpass"
      filter.frequency.setValueAtTime(450, now + delay)
      
      gainNode.gain.setValueAtTime(0, now + delay)
      gainNode.gain.linearRampToValueAtTime(0.14, now + delay + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.12)
      
      osc.connect(filter)
      filter.connect(gainNode)
      gainNode.connect(ctx.destination)
      
      osc.start(now + delay)
      osc.stop(now + delay + 0.13)
    })
  } catch (err) {
    console.warn("AudioContext failed to play error tone:", err)
  }
}
