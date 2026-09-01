/**
 * Shared animated "Fees by Class" bar chart.
 *
 * Renders a modern grouped horizontal bar chart where each class shows:
 *   - Total fees expected   (indigo gradient bar)
 *   - Fees collected / paid (emerald gradient bar)
 *   - Outstanding left to pay (amber gradient bar)
 *
 * Bars scale relative to the largest value across all three series so the
 * grouped bars within a class are always proportional to one another, and
 * animate from 0 → target width with a small stagger when
 * `animateFeeClassChart()` is called (expected right after the HTML is
 * inserted into the DOM).
 */

function fmtMoney(amount) {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Computes an exact percentage (numerator ÷ denominator × 100) and stringifies
 * it without losing precision to `Math.round`, e.g. 100% stays 100%, 2/3 of a
 * collection shows 66.7% instead of 67%. A zero/negative denominator yields 0%.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {string} formatted percentage, e.g. "66.7%" or "100%"
 */
export function formatPct(numerator, denominator) {
  const denom = Number(denominator);
  if (!(denom > 0)) return '0%';
  // Numerator is never negative in practice (amounts are clamped upstream),
  // but guard anyway so a stray negative can never render "-5%".
  const num = Math.max(Number(numerator) || 0, 0);
  const pct = (num / denom) * 100;
  // Round only for display (1 decimal) — the underlying ratio stays exact.
  const display = Math.round(pct * 10) / 10;
  return `${Number.isInteger(display) ? display : display.toFixed(1)}%`;
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
 * @param {Object<string, {totalFees: number, collected: number, outstanding: number}>} classMap
 *   Keys are class names; values hold the aggregated total fees, collected
 *   amount and outstanding balance for that class.
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
      outstanding: Math.max(Number(raw.outstanding) || 0, 0),
    };
  });

  const maxValue = Math.max(
    ...rows.map((r) => Math.max(r.totalFees, r.collected, r.outstanding)),
    0
  );

  const legend = `
    <div class="fee-chart-legend">
      <span class="fee-chart-legend-item"><span class="fee-chart-legend-dot total"></span>Total Fees</span>
      <span class="fee-chart-legend-item"><span class="fee-chart-legend-dot paid"></span>Collected</span>
      <span class="fee-chart-legend-item"><span class="fee-chart-legend-dot outstanding"></span>Outstanding</span>
    </div>
  `;

  const barRows = rows.map((r, idx) => {
    const totalW = maxValue > 0 ? (r.totalFees / maxValue) * 100 : 0;
    const collectedW = maxValue > 0 ? (r.collected / maxValue) * 100 : 0;
    const outstandingW = maxValue > 0 ? (r.outstanding / maxValue) * 100 : 0;

    const collectedPct = formatPct(r.collected, r.totalFees);
    const outstandingPct = formatPct(r.outstanding, r.totalFees);

    return `
      <div class="fee-chart-bar-item" style="animation-delay:${idx * 0.08}s">
        <div class="fee-chart-bar-label" title="${r.cls}">${r.cls}</div>
        <div class="fee-chart-bars">
          <div class="fee-chart-bar">
            <div class="fee-chart-bar-track">
              <div class="fee-chart-bar-fill total" data-width="${totalW}%" style="width:0;"></div>
            </div>
            <div class="fee-chart-bar-value total">GHC ${fmtMoney(r.totalFees)}</div>
          </div>
          <div class="fee-chart-bar">
            <div class="fee-chart-bar-track">
              <div class="fee-chart-bar-fill paid" data-width="${collectedW}%" style="width:0;"></div>
            </div>
            <div class="fee-chart-bar-value paid">GHC ${fmtMoney(r.collected)} <em>· ${collectedPct}</em></div>
          </div>
          <div class="fee-chart-bar">
            <div class="fee-chart-bar-track">
              <div class="fee-chart-bar-fill outstanding" data-width="${outstandingW}%" style="width:0;"></div>
            </div>
            <div class="fee-chart-bar-value outstanding">GHC ${fmtMoney(r.outstanding)} <em>· ${outstandingPct}</em></div>
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