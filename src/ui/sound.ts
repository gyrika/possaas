/**
 * Counter sounds (not the kitchen chime, which must always play). One on/off
 * setting, remembered on this device only.
 */
const KEY = 'cb.sound';

export const soundOn = (): boolean => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
};

export const setSoundOn = (on: boolean): void => {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* blocked storage: stays on for this visit */ }
};

let ctx: AudioContext | null = null;

/**
 * The unlock "clunk": a short, low thump (pitch falling 110 -> 55 Hz, ~140 ms)
 * with a soft click on top. Quiet on purpose: felt more than heard.
 */
export const clunk = (): void => {
  if (!soundOn() || typeof AudioContext === 'undefined') return;
  ctx ??= new AudioContext();
  const a = ctx;
  if (a.state === 'suspended') void a.resume();
  const t = a.currentTime;

  const body = a.createOscillator();
  const bodyGain = a.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(110, t);
  body.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  bodyGain.gain.setValueAtTime(0.0001, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.28, t + 0.008);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  body.connect(bodyGain).connect(a.destination);
  body.start(t);
  body.stop(t + 0.15);

  const click = a.createOscillator();
  const clickGain = a.createGain();
  click.type = 'triangle';
  click.frequency.setValueAtTime(1400, t);
  clickGain.gain.setValueAtTime(0.0001, t);
  clickGain.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  click.connect(clickGain).connect(a.destination);
  click.start(t);
  click.stop(t + 0.04);
};

/**
 * The "whaaap" of an order flying off to one of two kitchens: a breathy swish (noise through a
 * band-pass sweeping 2.6 kHz -> 350 Hz, ~260 ms) ending in a soft slap, panned towards that
 * kitchen's side so the ear hears where it went.
 */
export const whap = (side: 'left' | 'right'): void => {
  if (!soundOn() || typeof AudioContext === 'undefined') return;
  ctx ??= new AudioContext();
  const a = ctx;
  if (a.state === 'suspended') void a.resume();
  const t = a.currentTime;
  const dir = side === 'left' ? -1 : 1;

  const noise = a.createBuffer(1, Math.ceil(a.sampleRate * 0.32), a.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const pan = typeof a.createStereoPanner === 'function' ? a.createStereoPanner() : null;
  pan?.pan.setValueAtTime(dir * 0.2, t);
  pan?.pan.linearRampToValueAtTime(dir * 0.9, t + 0.28);
  const out: AudioNode = pan ? (pan.connect(a.destination), pan) : a.destination;

  const swish = a.createBufferSource();
  swish.buffer = noise;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(2600, t);
  band.frequency.exponentialRampToValueAtTime(350, t + 0.26);
  const swishGain = a.createGain();
  swishGain.gain.setValueAtTime(0.0001, t);
  swishGain.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
  swishGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.27);
  swish.connect(band).connect(swishGain).connect(out);
  swish.start(t);
  swish.stop(t + 0.3);

  const slap = a.createOscillator();
  const slapGain = a.createGain();
  slap.type = 'sine';
  slap.frequency.setValueAtTime(180, t + 0.2);
  slap.frequency.exponentialRampToValueAtTime(70, t + 0.29);
  slapGain.gain.setValueAtTime(0.0001, t + 0.2);
  slapGain.gain.exponentialRampToValueAtTime(0.3, t + 0.21);
  slapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  slap.connect(slapGain).connect(out);
  slap.start(t + 0.2);
  slap.stop(t + 0.31);
};
