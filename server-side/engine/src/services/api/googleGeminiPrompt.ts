export function projectSystemPromptForGoogleGemini(
  systemPrompt: string[],
): string[] {
  return systemPrompt.filter(Boolean)
}
