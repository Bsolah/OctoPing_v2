import type { AgentState } from './types';

/**
 * Final node: normalize response payload for the API layer.
 */
export async function responseFormatterNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const response =
    state.response?.trim() ||
    "I'm here to help with products, orders, and returns. What can I do for you?";

  const sources = state.sources ?? [];
  let formatted = response;

  if (sources.length > 0 && !response.toLowerCase().includes('source')) {
    const citations = sources
      .slice(0, 3)
      .map((source, index) => {
        const bits = [
          source.title,
          source.productId ? `id=${source.productId}` : null,
          source.url ? source.url : null,
        ].filter(Boolean);
        return `[${index + 1}] ${bits.join(' · ')}`;
      })
      .join('\n');
    formatted = `${response}\n\nSources:\n${citations}`;
  }

  return {
    response: formatted,
    messages: [{ role: 'assistant', content: formatted }],
    nextNode: undefined,
  };
}
