// Minimal SVG line chart with a hover crosshair. No dependencies.
const W = 320;
const H = 110;
const PAD_Y = 8;

/**
 * Draws `points` ([[timeMs, value]], sorted by time) into `svg`.
 * `baseline` (optional) draws a dashed reference line, e.g. the previous close, and the trend
 * color and returned change are measured from it.
 * Returns the % change from the baseline (or first point) to the last point.
 */
export function drawChart(svg, tip, points, { formatValue, formatTime, baseline }) {
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of points) { min = Math.min(min, v); max = Math.max(max, v); }
  if (baseline > 0) { min = Math.min(min, baseline); max = Math.max(max, baseline); }
  if (max === min) { max += max * 0.01 || 1; min -= min * 0.01 || 1; }

  const x = t => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = v => PAD_Y + (1 - (v - min) / (max - min)) * (H - PAD_Y * 2);
  const coords = points.map(([t, v]) => [x(t), y(v)]);
  const line = coords.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const area = `${line}L${W},${H}L0,${H}Z`;

  const first = baseline > 0 ? baseline : points[0][1];
  const last = points[points.length - 1][1];
  svg.dataset.trend = last >= first ? 'up' : 'down';
  const fillId = `${svg.id}-fill`;
  svg.innerHTML = `
    <defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="chart-stop-a"/><stop offset="1" class="chart-stop-b"/>
    </linearGradient></defs>
    <path class="chart-area" d="${area}" fill="url(#${fillId})"/>
    ${baseline > 0 ? `<line class="chart-baseline" x1="0" x2="${W}" y1="${y(baseline).toFixed(1)}" y2="${y(baseline).toFixed(1)}"/>` : ''}
    <path class="chart-line" d="${line}"/>
    <line class="chart-cross" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/>
    <circle class="chart-dot" r="3.5" cx="0" cy="0" visibility="hidden"/>`;

  const cross = svg.querySelector('.chart-cross');
  const dot = svg.querySelector('.chart-dot');

  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };

  svg.onpointermove = e => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    // Binary search for the nearest point by x.
    let lo = 0;
    let hi = coords.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (coords[mid][0] < px) lo = mid; else hi = mid;
    }
    const i = Math.abs(coords[lo][0] - px) < Math.abs(coords[hi][0] - px) ? lo : hi;
    const [cx, cy] = coords[i];
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('visibility', 'visible');

    tip.replaceChildren();
    const value = document.createElement('strong');
    value.textContent = formatValue(points[i][1]);
    const time = document.createElement('span');
    time.textContent = formatTime(points[i][0]);
    tip.append(value, time);
    tip.hidden = false;
    const left = (cx / W) * rect.width;
    const tipWidth = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(rect.width - tipWidth, left - tipWidth / 2))}px`;
  };
  svg.onpointerleave = hide;
  hide();

  return ((last - first) / first) * 100;
}

export function clearChart(svg, tip) {
  svg.innerHTML = '';
  svg.onpointermove = svg.onpointerleave = null;
  delete svg.dataset.trend;
  tip.hidden = true;
}
