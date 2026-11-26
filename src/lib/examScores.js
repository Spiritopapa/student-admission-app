export function parseExamScore(value, maximum) {
  const input = String(value ?? '').trim();
  if (!input) return { valid: true, value: null };

  const score = Number(input);
  if (!Number.isFinite(score) || score < 0 || score > maximum) {
    return { valid: false, value: null };
  }
  return { valid: true, value: score };
}
