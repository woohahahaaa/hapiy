import { createFileRoute } from '@tanstack/react-router'
import { GatewayModulePage } from '@/features/gateway-pages'

export const Route = createFileRoute('/_authenticated/concurrency-rules')({ component: () => <GatewayModulePage kind='concurrency' /> })
