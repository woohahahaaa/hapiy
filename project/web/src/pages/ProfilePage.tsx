import { PageHeader } from '@/components/PageHeader'

export function ProfilePage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="个人资料" subtitle="Account information" />
      <div className="flex-1 p-6">
        <div className="flex h-full items-center justify-center rounded-lg border border-dashed">
          <p className="text-muted-foreground">Profile page will be here</p>
        </div>
      </div>
    </div>
  )
}
