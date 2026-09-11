// Decorative motion, not a measurement of microphone volume.
// Motion is gated by the recognizer's speech detection, not microphone access.
export function voiceWave() {
  const heights = [
    7, 12, 18, 10, 24, 32, 20, 13, 28, 38, 26, 16, 30, 40, 25, 15, 34, 22, 12,
    28, 19, 10, 16, 11, 6,
  ];
  return `<span class="voice-wave" aria-hidden="true">${heights.map((height, index) => `<span style="--wave-height:${height}px;--wave-hue:${175 + index * 5};--wave-delay:${-(index % 7) * 0.17}s;--wave-duration:${0.85 + (index % 5) * 0.16}s"></span>`).join('')}</span>`;
}
