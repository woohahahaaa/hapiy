import { createFileRoute } from '@tanstack/react-router'
import { GatewayPlayground } from '@/features/gateway-playground'

export const Route = createFileRoute('/_authenticated/playground-new')({ component: GatewayPlayground })
