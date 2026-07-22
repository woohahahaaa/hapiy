import { createFileRoute } from '@tanstack/react-router'
import { GatewayLogsPage } from '@/features/gateway-logs'

export const Route = createFileRoute('/_authenticated/logs-new')({ component: GatewayLogsPage })
