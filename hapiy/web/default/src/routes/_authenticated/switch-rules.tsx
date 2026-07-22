import { createFileRoute } from '@tanstack/react-router'
import { GatewayModulePage } from '@/features/gateway-pages'

export const Route = createFileRoute('/_authenticated/switch-rules')({ component: () => <GatewayModulePage kind='switch' /> })
