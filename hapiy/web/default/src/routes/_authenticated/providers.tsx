import { createFileRoute } from '@tanstack/react-router'
import { GatewayProvidersPage } from '@/features/gateway-providers'

export const Route = createFileRoute('/_authenticated/providers')({ component: GatewayProvidersPage })
