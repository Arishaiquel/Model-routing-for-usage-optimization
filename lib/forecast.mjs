const clamp = value => Math.max(0, Math.min(100, value));

export function forecastWindow(current, history, now = new Date().toISOString()) {
  const reset = Date.parse(current.resetsAt || "");
  const present = Date.parse(now);
  const remainingHours = (reset - present) / 3_600_000;
  const rows = history.filter(row => row.limitId === current.limitId && row.slot === current.slot && row.windowMinutes === current.windowMinutes && Number.isFinite(row.remainingPercent) && Date.parse(row.observedAt) <= present && Date.parse(row.observedAt) >= present - (current.windowMinutes || 10080) * 60_000).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const samples = [];
  for (let i = 1; i < rows.length; i++) {
    const hours = (Date.parse(rows[i].observedAt) - Date.parse(rows[i - 1].observedAt)) / 3_600_000;
    const loss = rows[i - 1].remainingPercent - rows[i].remainingPercent;
    // Rising allowance indicates a reset or a rolling-window release, not consumption.
    if (hours >= 1 / 60 && hours <= 24 && loss >= 0 && loss <= 50 && rows[i].remainingPercent <= rows[i - 1].remainingPercent) samples.push({ rate: loss / hours, hours });
  }
  const spanHours = rows.length > 1 ? (Date.parse(rows.at(-1).observedAt) - Date.parse(rows[0].observedAt)) / 3_600_000 : 0;
  const totalHours = samples.reduce((sum, sample) => sum + sample.hours, 0);
  const expectedRate = totalHours ? samples.reduce((sum, sample) => sum + sample.rate * sample.hours, 0) / totalHours : null;
  const sorted = samples.map(sample => sample.rate).sort((a, b) => a - b);
  const percentile = p => sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
  const confidence = samples.length >= 8 && spanHours >= Math.min(24, (current.windowMinutes || 300) / 120) ? "moderate" : "low";
  const valid = Number.isFinite(remainingHours) && remainingHours > 0 && expectedRate !== null && samples.length >= 3 && spanHours >= 1;
  const scenarios = valid ? {
    conservative: clamp(current.remainingPercent - percentile(0.2) * remainingHours),
    expected: clamp(current.remainingPercent - expectedRate * remainingHours),
    highUsage: clamp(current.remainingPercent - percentile(0.8) * remainingHours),
  } : null;
  let signal = "Insufficient history for a usage recommendation.";
  if (confidence === "moderate" && scenarios) {
    if (scenarios.highUsage > 40 && remainingHours < 2) signal = "Allowance may remain unused before reset.";
    else if (scenarios.expected < 10) signal = "Current pace may exhaust this window before reset.";
    else signal = "Current pace appears within the reported allowance.";
  }
  return { limitId: current.limitId, slot: current.slot, windowMinutes: current.windowMinutes, remainingPercent: current.remainingPercent, resetsAt: current.resetsAt, sampledIntervals: samples.length, spanHours, ratePerHour: expectedRate, confidence, scenarios, signal, note: "Projection extends observed percentage change; rolling releases and future work can change it." };
}

export function forecastAll(rates, history, now) {
  return rates.map(rate => forecastWindow(rate, history, now));
}
