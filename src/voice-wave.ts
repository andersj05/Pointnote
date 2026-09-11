// Decorative motion, not a measurement of microphone volume.
// Motion is gated by the recognizer's speech detection, not microphone access.
export function voiceWave() {
  const heights = [5, 9, 15, 11, 19, 13, 17, 9, 5];
  return `<span class="voice-wave" aria-hidden="true">${heights.map((height, index) => `<span style="--wave-height:${height}px;--wave-hue:${175 + index * 5};--wave-delay:${-(index % 7) * 0.17}s;--wave-duration:${0.85 + (index % 5) * 0.16}s"></span>`).join('')}</span>`;
}
