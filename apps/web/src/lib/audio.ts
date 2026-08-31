/**
 * apps/web/src/lib/audio.ts
 *
 * Web Audio API manager for DTMF tones and call state alerts.
 */

// DTMF Frequencies mapping
const DTMF_FREQS: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

let audioCtx: AudioContext | null = null;
let isAudioMuted = false;
let currentLoopingOscillators: { osc1: OscillatorNode, osc2?: OscillatorNode, gain: GainNode } | null = null;
let loopTimeout: number | null = null;
let isAlertPlaying = false; // Add flag to safely stop loops

export function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(console.error);
  }
}

export function setAudioMuted(muted: boolean) {
  isAudioMuted = muted;
  if (muted) {
    stopAlert();
  }
}

export function getAudioMuted() {
  return isAudioMuted;
}

export function playDTMF(digit: string) {
  console.log('[audio] playDTMF invoked for digit:', digit, 'isAudioMuted:', isAudioMuted);
  if (isAudioMuted) return;
  initAudioContext();
  if (!audioCtx) return;
  
  console.log('[audio] audioCtx state:', audioCtx.state);
  const freqs = DTMF_FREQS[digit];
  if (!freqs) return;

  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc1.type = 'sine';
  osc2.type = 'sine';
  osc1.frequency.value = freqs[0];
  osc2.frequency.value = freqs[1];

  // Soft attack/release to avoid clicks
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.01);
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + 0.1);
  gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);

  osc1.connect(gainNode);
  osc2.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc1.start(audioCtx.currentTime);
  osc2.start(audioCtx.currentTime);
  osc1.stop(audioCtx.currentTime + 0.15);
  osc2.stop(audioCtx.currentTime + 0.15);

  console.log('[audio] DTMF tone scheduled for digit:', digit);
}

export function playAlert(type: 'ringback' | 'connected' | 'failed' | 'inbound') {
  if (isAudioMuted) return;
  initAudioContext();
  if (!audioCtx) return;
  
  stopAlert(); // ensure no overlapping sounds
  isAlertPlaying = true;

  const t0 = audioCtx.currentTime;

  if (type === 'connected') {
    // Short ascending chime (600Hz to 800Hz)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t0);
    osc.frequency.exponentialRampToValueAtTime(800, t0 + 0.15);
    
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.15, t0 + 0.05);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.3);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(t0);
    osc.stop(t0 + 0.3);
  } else if (type === 'failed') {
    // Fast busy tone: 480Hz + 620Hz, 0.25s on, 0.25s off
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.value = 480;
    osc2.frequency.value = 620;
    
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.1, t0 + 0.02);
    gain.gain.setValueAtTime(0.1, t0 + 0.23);
    gain.gain.linearRampToValueAtTime(0, t0 + 0.25);
    
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc1.start(t0);
    osc2.start(t0);
    osc1.stop(t0 + 0.25);
    osc2.stop(t0 + 0.25);
  } else if (type === 'ringback') {
    // US ringback: 440Hz + 480Hz, 2s on, 4s off
    const playRingbackCycle = () => {
      if (!isAlertPlaying || !audioCtx) return;
      const t = audioCtx.currentTime;
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.05, t + 0.1);
      gain.gain.setValueAtTime(0.05, t + 1.9);
      gain.gain.linearRampToValueAtTime(0, t + 2.0);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 2.0);
      osc2.stop(t + 2.0);
      
      currentLoopingOscillators = { osc1, osc2, gain };
      loopTimeout = window.setTimeout(playRingbackCycle, 6000); // 2s on + 4s off
    };
    playRingbackCycle();
  } else if (type === 'inbound') {
    // Inbound ringtone loop: alternating 440Hz and 550Hz in a pattern
    const playInboundCycle = () => {
      if (!isAlertPlaying || !audioCtx) return;
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.setValueAtTime(550, t + 0.2);
      osc.frequency.setValueAtTime(440, t + 0.4);
      osc.frequency.setValueAtTime(550, t + 0.6);
      
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.05, t + 0.05);
      gain.gain.setValueAtTime(0.05, t + 0.8);
      gain.gain.linearRampToValueAtTime(0, t + 1.0);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(t);
      osc.stop(t + 1.0);
      
      currentLoopingOscillators = { osc1: osc, gain };
      loopTimeout = window.setTimeout(playInboundCycle, 2000); // 1s ring + 1s pause
    };
    playInboundCycle();
  }
}

export function stopAlert() {
  isAlertPlaying = false;
  if (loopTimeout !== null) {
    clearTimeout(loopTimeout);
    loopTimeout = null;
  }
  if (currentLoopingOscillators && audioCtx) {
    const { osc1, osc2, gain } = currentLoopingOscillators;
    try {
      // Fade out to avoid clicks
      gain.gain.cancelScheduledValues(audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.05);
      setTimeout(() => {
        try { osc1.stop(); } catch (e) {}
        try { if (osc2) osc2.stop(); } catch (e) {}
        try { gain.disconnect(); } catch (e) {}
      }, 100);
    } catch (e) {}
    currentLoopingOscillators = null;
  }
}
