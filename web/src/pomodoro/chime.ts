/**
 * Klingelton für den Pomodoro-Timer, direkt im Browser erzeugt (Web Audio) –
 * keine Tondatei nötig. Browser erlauben Ton erst nach einer Nutzeraktion,
 * deshalb wird der AudioContext beim Start-Klick „entsperrt“.
 */
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  ctx = Ctor ? new Ctor() : null;
  return ctx;
}

/** Beim Klick auf Start/Fortsetzen aufrufen, damit der Ton später spielen darf. */
export function unlockAudio() {
  void context()?.resume().catch(() => {});
}

/** Glockenartiger Dreiklang, zweimal hintereinander. */
export function playChime() {
  const audio = context();
  if (!audio) return;
  void audio.resume().catch(() => {});
  const notes = [880, 1108.73, 1318.51]; // A5, C#6, E6
  const start = audio.currentTime + 0.05;
  for (let round = 0; round < 2; round++) {
    notes.forEach((freq, i) => {
      const t = start + round * 1.1 + i * 0.22;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 1.25);
    });
  }
}
