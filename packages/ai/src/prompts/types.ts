export type PromptVersion = 'prompt_v1' | 'prompt_v2';

export type VersionedPrompt = {
  id: string;
  version: PromptVersion;
  template: string;
};

export function selectPromptVersion(
  prompts: Record<PromptVersion, VersionedPrompt>,
  version: PromptVersion = 'prompt_v1',
): VersionedPrompt {
  return prompts[version] ?? prompts.prompt_v1;
}
