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

export interface GatewayProvider {
  id: string
  name: string
  type: string
  base_urls: number
  keys: number
  status: 'active' | 'disabled' | 'error'
  models: string[]
  created_at: string
}

export interface GatewayProviderFormData {
  name: string
  type: string
  base_urls: string[]
  keys: string[]
  models: string[]
}
