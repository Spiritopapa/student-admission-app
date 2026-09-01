/**
 * Shared animated "Fees vs Paid by Class" bar chart.
 *
 * Renders a modern grouped horizontal bar chart where each class shows:
 *   - Total expected fees   (indigo gradient bar)
 *   - Fees collected / paid (emerald gradient bar)
 *
 * Bars scale relative to the largest value across all classes and animate
 * from 0 → target width with a small stagger when `animateFeeClassChart()`
 * is called (expected right after the HTML is inserted into the DOM).
 */

function fmtMoney(amount) {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Empty / no-data placeholder for the chart container.
 */
export function feeClassChartEmptyHtml(message = 'No fee data available yet.') {
  return `<div class="fee-chart-empty">${message}</div>`;
}

/**
 * Builds the animated bar chart HTML.
 *
 * @param {Object<string, {totalFees: number, collected: number}>} classMap
 *   Keys are class names; values hold the aggregated total fees and collected amount.
 * @returns {string} HTML markup (legend + one row per class).
 */
export function buildFeeClassChartHtml(classMap) {
  if (!classMap || typeof classMap !== 'object') return feeClassChartEmptyHtml();

  const classNames = Object.keys(classMap).sort();
  if (classNames.length === 0) return feeClassChartEmptyHtml();

  // Normalise values once so later math is safe
  const rows = classNames.map((cls) => {
    const raw = classMap[cls] || {};
    return {
      cls,
      totalFees: Number(raw.totalFees) || 0,
      collected: Number(raw.collected) || 0,
    };
  });

  const maxValue = Math.max(
    ...rows.map((r) => Math.max(r.totalFees, r.collected)),
    0
  );

  const legend = `
    <div class="fee-chart-legend">
      <span class="fee-chart-legend-item"><span class="fee-chart-legend-dot total"></span>Total Fees</span>
      <span class="fee-chart-legend-item"><span class="fee-chart-legend-dot paid"></span>Fees Paid</span>
    </div>
  `;

  const barRows = rows.map((r, idx) => {
    const totalW = maxValue > 0 ? (r.totalFees / maxValue) * 100 : 0;
    const paidW = maxValue > 0 ? (r.collected / maxValue) * 100 : 0;
    const pct = r.totalFees > 0 ? Math.round((r.collected / r.totalFees) * 100) : 0;

    return `
      <div class="fee-chart-bar-item" style="animation-delay:${idx * 0.08}s">
        <div class="fee-chart-bar-label" title="${r.cls}">${r.cls}</div>
        <div class="fee-chart-bars">
          <div class="fee-chart-bar">
            <div class="fee-chart-bar-track">
              <div class="fee-chart-bar-fill total" data-width="${totalW}%" style="width:0;"></div>
            </div>
            <div class="fee-chart-bar-value total">GH₵ ${fmtMoney(r.totalFees)}</div>
          </div>
          <div class="fee-chart-bar">
            <div class="fee-chart-bar-track">
              <div class="fee-chart-bar-fill paid" data-width="${paidW}%" style="width:0;"></div>
            </div>
            <div class="fee-chart-bar-value paid">GH₵ ${fmtMoney(r.collected)} <em>· ${pct}%</em></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return legend + barRows;
}

/**
 * Animates every bar inside the given container from 0 → its `data-width`.
 * Called right after the chart HTML has been placed into the DOM.
 *
 * @param {HTMLElement} container Element that holds the `.fee-chart-bar-fill`s.
 */
export function animateFeeClassChart(container) {
  if (!container) return;
  const bars = container.querySelectorAll('.fee-chart-bar-fill');
  bars.forEach((bar, idx) => {
    const w = bar.getAttribute('data-width') || '0%';
    setTimeout(() => {
      bar.style.width = w;
      bar.style.transition = 'width 0.9s cubic-bezier(0.22, 1, 0.36, 1)';
    }, 120 + idx * 55);
  });
}