type Preview = { prompt: string; cwd: string; model: string; complexity: string; explanation: string; expires: number };
const globalPreviews = globalThis as typeof globalThis & { quotaPilotPreviews?: Map<string, Preview> };
const previews = globalPreviews.quotaPilotPreviews ??= new Map<string, Preview>();
export function savePreview(value: Omit<Preview, "expires">) {
  for (const [id, item] of previews) if (item.expires < Date.now()) previews.delete(id);
  const id = crypto.randomUUID();
  previews.set(id, { ...value, expires: Date.now() + 5 * 60_000 });
  return id;
}
export function consumePreview(id: string, prompt: string, cwd: string) {
  const value = previews.get(id);
  previews.delete(id);
  if (!value || value.expires < Date.now() || value.prompt !== prompt || value.cwd !== cwd) throw new Error("Routing preview expired or changed. Analyze the task again.");
  return value;
}
