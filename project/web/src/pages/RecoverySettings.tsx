import { useState } from 'react'
import { AppIcon } from '@/components/AppIcon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'

export function RecoverySettings() {
  const [recoveryMinutes, setRecoveryMinutes] = useState('')

  const showUnavailable = () => {
    toast('暂未开发')
  }

  return (
    <Card>
      <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AppIcon name="refresh" size={16} /> 恢复自动禁用
          </CardTitle>
          <CardDescription>恢复自动禁用的供应商、BaseURL、Key 的时间间隔。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-sm" htmlFor="automatic-disable-recovery-minutes">
            时间间隔（分钟）
            <Input
              id="automatic-disable-recovery-minutes"
              className="w-40"
              type="number"
              min={0}
              value={recoveryMinutes}
              onChange={(event) => setRecoveryMinutes(event.target.value)}
            />
          </label>
          <Button type="button" onClick={showUnavailable}>保存</Button>
        </div>
      </CardContent>
    </Card>
  )
}
