import { createFileRoute } from '@tanstack/react-router'
import { GatewayModulePage } from '@/features/gateway-pages'

export const Route = createFileRoute('/_authenticated/request-modifiers')({ component: () => <GatewayModulePage kind='modifiers' /> })
