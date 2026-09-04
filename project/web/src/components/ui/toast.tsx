import { Toaster as Sonner, type ToasterProps, toast } from "sonner"

import { useTheme } from "@/components/theme-provider"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      data-slot="toaster"
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
