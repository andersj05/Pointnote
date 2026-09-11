// Decorative motion, not a measurement of microphone volume.
// Motion is gated by the recognizer's speech detection, not microphone access.
export function voiceWave() {
  const id = 'wave-' + crypto.randomUUID();
  return `<span class="voice-wave" aria-hidden="true"><svg viewBox="0 0 160 32" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="1"><stop stop-color="#26bba9"/><stop offset=".5" stop-color="#578bf4"/><stop offset="1" stop-color="#ab68dc"/></linearGradient></defs><path class="wave-glow" stroke="url(#${id})"/><path class="wave-back" stroke="#ab68dc"/><path class="wave-middle" stroke="#26bba9"/><path class="wave-front" stroke="url(#${id})"/></svg></span>`;
}

export function mountVoiceWave(container: HTMLElement) {
  const wave = container.querySelector<HTMLElement>('.voice-wave')!;
  const paths = [...wave.querySelectorAll('path')];
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let speaking = false;
  let frame = 0;
  const paint = (time: number) => {
    const phase = time / 580;
    for (const [index, path] of paths.entries()) {
      const layer = index === 0 ? 3 : index;
      const points = [];
      for (let x = 0; x <= 160; x += 2) {
        const progress = x / 160;
        const envelope = Math.sin(Math.PI * progress) ** 1.4;
        const swell = 0.75 + 0.25 * Math.sin(phase * 0.7 + layer);
        const curve = Math.sin(
          progress * Math.PI * (4 + layer * 0.5) -
            phase * (1 + layer * 0.14) +
            layer,
        );
        const ripple =
          Math.sin(progress * Math.PI * 10 + phase * 1.3 + layer) * 0.2;
        const y =
          16 + envelope * (speaking ? 13 * swell : 1.5) * (curve + ripple);
        points.push(`${x === 0 ? 'M' : 'L'}${x},${y.toFixed(2)}`);
      }
      path.setAttribute('d', points.join(' '));
    }
  };
  const tick = (time: number) => {
    if (!wave.isConnected) {
      frame = 0;
      wave.dataset.motion = 'still';
      return;
    }
    paint(time);
    frame = requestAnimationFrame(tick);
  };
  const refresh = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    const animate =
      speaking &&
      !reducedMotion?.matches &&
      !document.hidden &&
      wave.isConnected;
    wave.dataset.motion = animate ? 'running' : 'still';
    paint(0);
    if (animate) frame = requestAnimationFrame(tick);
  };
  reducedMotion?.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
  return {
    setSpeaking(value: boolean) {
      speaking = value;
      refresh();
    },
  };
}
