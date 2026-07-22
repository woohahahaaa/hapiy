/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

import type { SidebarData } from '@/components/layout/types'

export function useSidebarData(): SidebarData {
  const { t } = useTranslation()

  return {
    navGroups: [
      {
        id: 'core',
        title: t('Core'),
        items: [
          {
            title: t('Nodes'),
            url: '/playground-new',
          },
          {
            title: t('Providers'),
            url: '/providers',
          },
          {
            title: t('Usage Logs'),
            url: '/logs-new',
          },
          {
            title: t('API Tokens'),
            url: '/tokens-new',
          },
        ],
      },
      {
        id: 'rules',
        title: t('Rules'),
        items: [
          {
            title: t('Auto-Switch'),
            url: '/switch-rules',
          },
          {
            title: t('Request Modifiers'),
            url: '/request-modifiers',
          },
          {
            title: t('Auto-Reply'),
            url: '/auto-reply',
          },
          {
            title: t('Concurrency'),
            url: '/concurrency-rules',
          },
        ],
      },
      {
        id: 'system',
        title: t('System'),
        items: [
          {
            title: t('System Settings'),
            url: '/system-settings',
          },
        ],
      },
    ],
  }
}
