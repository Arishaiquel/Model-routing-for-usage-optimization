export const CAPABILITIES = ["code_generation", "debugging", "architecture", "refactoring", "testing"];

export function validateAnalysis(value, catalog) {
  if (!value || !["simple", "moderate", "advanced"].includes(value.complexity) || typeof value.needsAdvancedReasoning !== "boolean" || !Array.isArray(value.capabilities) || !value.capabilities.every(capability => CAPABILITIES.includes(capability)) || typeof value.explanation !== "string" || value.explanation.length < 1 || value.explanation.length > 500 || typeof value.recommendedModel !== "string" || !catalog.some(model => model.model === value.recommendedModel)) throw new Error("Nemotron returned an invalid task analysis or a model outside the Codex catalog.");
  return { complexity: value.complexity, needsAdvancedReasoning: value.needsAdvancedReasoning, capabilities: [...new Set(value.capabilities)], explanation: value.explanation, recommendedModel: value.recommendedModel };
}

export function selectRoute(analysis, catalog, profiles, forecasts) {
  const supported = catalog.filter(model => model.model && profiles[model.model]);
  const candidates = supported.filter(model => {
    const profile = profiles[model.model];
    return analysis.capabilities.every(capability => profile.capabilities.includes(capability));
  });
  const eligible = candidates.length ? candidates : supported;
  const preferred = catalog.find(model => model.model === analysis.recommendedModel);
  const defaultModel = catalog.find(model => model.isDefault) || catalog[0];
  if (!eligible.length) return { model: preferred?.model || defaultModel?.model || null, explanation: "No configured model capability profiles are available; using Nemotron's catalog-validated recommendation or the Codex default. Comparative suitability is unverified.", confidence: "low" };
  const pressure = forecasts.some(item => item.confidence === "moderate" && item.scenarios?.expected < 15);
  const opportunity = forecasts.some(item => item.confidence === "moderate" && item.scenarios?.highUsage > 40 && item.resetsAt && Date.parse(item.resetsAt) - Date.now() < 2 * 3_600_000);
  const desired = analysis.complexity === "advanced" || analysis.needsAdvancedReasoning ? 3 : analysis.complexity === "moderate" ? 2 : 1;
  const target = pressure && desired < 3 ? 1 : opportunity && desired === 2 ? 3 : desired;
  const ranked = eligible.map(model => ({ model, distance: Math.abs(profiles[model.model].tier - target), preferred: model.model === preferred?.model })).sort((a, b) => a.distance - b.distance || Number(b.preferred) - Number(a.preferred));
  const chosen = ranked[0]?.model || preferred || defaultModel;
  const usageNote = pressure && desired < 3 ? " Forecast suggests allowance pressure; favoring efficiency." : opportunity && desired === 2 ? " Forecast suggests room to use a stronger configured profile before reset." : " Allowance forecasts do not justify changing the task-fit tier.";
  return { model: chosen?.model || null, explanation: `${analysis.explanation}${usageNote} Profile tiers are operator configured; model-specific allowance cost is unknown.`, confidence: candidates.length ? "configured" : "low" };
}

export function escalationDecision(task, catalog, profiles, enabled = false) {
  if (task.status !== "failed" && !(task.status === "completed" && typeof task.verification === "string" && task.verification.includes(": failed ("))) return { allowed: false, reason: "Only failed tasks or tasks with observed test failures can be escalated." };
  if (!enabled) return { allowed: false, reason: "Automatic escalation is disabled." };
  if (task.escalation_count >= 1) return { allowed: false, reason: "Retry limit reached." };
  const current = profiles[task.model];
  const next = current && catalog.filter(model => profiles[model.model]?.tier > current.tier).sort((a, b) => profiles[a.model].tier - profiles[b.model].tier)[0];
  return next ? { allowed: true, model: next.model, reason: "A stronger configured profile is available; user confirmation is required before another execution." } : { allowed: false, reason: "No stronger configured supported model is available." };
}
