<script>
  export let size = 56;
  export let mode = 'idle';
  export let trackText = '';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  $: textLength = (trackText || '').length;
  $: signal = textLength === 0 ? 0 : trackText.charCodeAt(textLength - 1) || 0;

  $: gazeX = mode === 'tracking'
    ? clamp(((textLength % 9) - 4) * 0.6 + (signal % 3) * 0.2, -2.2, 2.2)
    : mode === 'thinking'
      ? -0.9
      : 0;

  $: gazeY = mode === 'tracking'
    ? clamp(((textLength % 5) - 2) * 0.45, -1.2, 1.2)
    : mode === 'thinking'
      ? -0.4
      : 0;

  $: mouthPath = mode === 'smile'
    ? 'M30 57 Q40 67 50 57'
    : mode === 'thinking'
      ? 'M31 58 Q40 62 49 58'
      : 'M31 57 Q40 62 49 57';
</script>

<div class={`avatar-shell ${mode}`} style={`width:${size}px;height:${size}px;`} aria-hidden="true">
  <svg viewBox="0 0 80 80" role="img">
    <defs>
      <linearGradient id="bgGlow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f0d8a0" />
        <stop offset="100%" stop-color="#b48c3c" />
      </linearGradient>
    </defs>

    <circle class="halo" cx="40" cy="40" r="38" />
    <circle class="face" cx="40" cy="41" r="25" />
    <path class="hair" d="M16 39 C15 23, 27 13, 40 13 C54 13, 65 23, 64 39 C58 28, 50 23, 40 23 C30 23, 22 28, 16 39 Z" />
    <path class="bangs" d="M25 27 C30 22, 36 20, 41 22 C45 23, 49 26, 52 31 C48 29, 43 28, 39 29 C34 30, 29 31, 25 27 Z" />

    {#if mode === 'thinking'}
      <g class="thoughts">
        <circle class="thought-dot dot-a" cx="55" cy="12" r="2.2" />
        <circle class="thought-dot dot-b" cx="61" cy="8" r="2.8" />
        <circle class="thought-dot dot-c" cx="68" cy="5" r="3.5" />
      </g>
    {/if}

    <g class="glasses">
      <circle cx="31" cy="41" r="5.8" />
      <circle cx="49" cy="41" r="5.8" />
      <line x1="38" y1="41" x2="42" y2="41" />
    </g>

    <g style={`transform: translate(${gazeX}px, ${gazeY}px);`}>
      <circle class="eye-white" cx="31" cy="41" r="3.2" />
      <circle class="eye-white" cx="49" cy="41" r="3.2" />
      <circle class="pupil" cx="31" cy="41" r="1.35" />
      <circle class="pupil" cx="49" cy="41" r="1.35" />
      <circle class="sparkle" cx="30.2" cy="40.2" r="0.55" />
      <circle class="sparkle" cx="48.2" cy="40.2" r="0.55" />
    </g>

    <g class="blink-layer">
      <line class="blink-line" x1="27.5" y1="41" x2="34.5" y2="41" />
      <line class="blink-line" x1="45.5" y1="41" x2="52.5" y2="41" />
    </g>

    <path class="brow" d="M27 35 Q31 33.5 35 35" />
    <path class="brow" d="M45 35 Q49 33.5 53 35" />

    <path class="nose" d="M40 43 L39 49 L41 49" />
    <path class="mouth" d={mouthPath} />
    <circle class="cheek left" cx="28.8" cy="53.2" r="3.5" />
    <circle class="cheek right" cx="51.2" cy="53.2" r="3.5" />
  </svg>
</div>

<style>
  .avatar-shell {
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35);
    background: transparent;
  }

  .avatar-shell svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .halo {
    fill: transparent;
    stroke: url(#bgGlow);
    stroke-width: 1.5;
    opacity: 0.9;
  }

  .face {
    fill: #f2cda6;
  }

  .hair {
    fill: #2f1f18;
  }

  .bangs {
    fill: #3a2820;
    opacity: 0.95;
  }

  .thought-dot {
    fill: #f0d8a0;
    opacity: 0.92;
    filter: drop-shadow(0 0 2px rgba(240, 216, 160, 0.45));
  }

  .dot-a { animation: thoughtPop 1.3s ease-in-out infinite; }
  .dot-b { animation: thoughtPop 1.3s ease-in-out infinite 0.15s; }
  .dot-c { animation: thoughtPop 1.3s ease-in-out infinite 0.3s; }

  .glasses circle,
  .glasses line {
    fill: none;
    stroke: #3a2d28;
    stroke-width: 1.6;
  }

  .eye-white {
    fill: #fffef9;
  }

  .pupil {
    fill: #241d1b;
  }

  .sparkle {
    fill: #fff;
    opacity: 0.95;
  }

  .brow {
    fill: none;
    stroke: #4a342a;
    stroke-width: 1.2;
    stroke-linecap: round;
  }

  .blink-layer {
    opacity: 0;
    animation: blink 5s infinite;
  }

  .blink-line {
    stroke: #4a342a;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .blink-layer + .brow,
  .blink-layer + .brow + .brow {
    animation: eyeFade 5s infinite;
  }

  .avatar-shell .eye-white,
  .avatar-shell .pupil,
  .avatar-shell .sparkle {
    animation: eyeFade 5s infinite;
  }

  .nose {
    fill: none;
    stroke: #c79169;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mouth {
    fill: none;
    stroke: #8b3d4e;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .cheek {
    fill: #ef93a0;
    opacity: 0.22;
    transition: opacity 0.25s ease, transform 0.2s ease;
  }

  .avatar-shell.smile .cheek {
    opacity: 0.4;
    transform: scale(1.05);
  }

  .avatar-shell.idle .cheek,
  .avatar-shell.tracking .cheek {
    opacity: 0.3;
  }

  .avatar-shell.thinking {
    animation: floaty 1.5s ease-in-out infinite;
  }

  .avatar-shell.smile {
    animation: happyPulse 1.6s ease-in-out infinite;
  }

  .avatar-shell.tracking .pupil {
    transition: all 0.12s ease;
  }

  @keyframes floaty {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-1.5px); }
  }

  @keyframes happyPulse {
    0%, 100% { transform: translateY(0px) scale(1); }
    50% { transform: translateY(-1px) scale(1.02); }
  }

  @keyframes blink {
    0%, 92%, 100% { opacity: 0; }
    93%, 97% { opacity: 1; }
  }

  @keyframes eyeFade {
    0%, 92%, 100% { opacity: 1; }
    93%, 97% { opacity: 0; }
  }

  @keyframes thoughtPop {
    0%, 100% { transform: translateY(0px) scale(1); opacity: 0.85; }
    50% { transform: translateY(-1.8px) scale(1.08); opacity: 1; }
  }
</style>
