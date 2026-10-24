import type { ChatModelOption } from '@/lib/dashboard-api'

export type AgentModelChoice = {
  readonly model: string
  readonly providerId: string
}

// pickDefaultModel chooses the model for a new conversation: the model the
// account used when it last started one, otherwise the first model in the
// current list. A remembered provider survives only while the model still
// offers it; an empty provider means 自动 (dispatch through the topology).
export function pickDefaultModel(
  models: readonly ChatModelOption[],
  preference: AgentModelChoice,
): AgentModelChoice {
  const remembered = models.find((entry) => entry.model === preference.model)
  if (remembered) {
    return {
      model: remembered.model,
      providerId: remembered.providers.some((provider) => provider.id === preference.providerId)
        ? preference.providerId
        : '',
    }
  }
  return { model: models[0]?.model ?? '', providerId: '' }
}
