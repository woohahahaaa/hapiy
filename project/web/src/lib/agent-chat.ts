import type { ChatModelOption, ChatModelUsage } from '@/lib/dashboard-api'

export type AgentModelChoice = {
  readonly model: string
  readonly providerId: string
}

// usable reports whether a model still has at least one channel the picker can
// send through: the provider is not disabled as a whole, and its keys and base
// URLs are not all disabled.
function usable(entry: ChatModelOption): boolean {
  return entry.providers.some((provider) => !provider.autoDisabled)
}

// pickDefaultModel chooses the model for a new conversation: the most used
// model of the recent usage window that still has a usable channel, then the
// first usable model in the list, then whatever the list offers. The provider
// always starts on 自动 so the topology dispatches the request.
export function pickDefaultModel(
  models: readonly ChatModelOption[],
  usage: readonly ChatModelUsage[],
): AgentModelChoice {
  for (const item of usage) {
    const entry = models.find((candidate) => candidate.model === item.model)
    if (entry && usable(entry)) return { model: entry.model, providerId: '' }
  }
  const fallback = models.find(usable) ?? models[0]
  return { model: fallback?.model ?? '', providerId: '' }
}
