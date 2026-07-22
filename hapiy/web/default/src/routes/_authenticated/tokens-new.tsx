import { createFileRoute } from '@tanstack/react-router'
import { GatewayTokensPage } from '@/features/gateway-tokens'

export const Route = createFileRoute('/_authenticated/tokens-new')({ component: GatewayTokensPage })
