import { createFileRoute } from '@tanstack/react-router'
import { GatewayModulePage } from '@/features/gateway-pages'

export const Route = createFileRoute('/_authenticated/auto-reply')({ component: () => <GatewayModulePage kind='auto-reply' /> })
