import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { IconProvider, DEFAULT_ICON_CONFIGS } from "@icon-park/react"
import type { IIconConfig } from "@icon-park/react/es/runtime"
import iconConfig from "@/config/icons.json"

const iconProviderValue: IIconConfig = {
  ...DEFAULT_ICON_CONFIGS,
  rtl: iconConfig.global.rtl,
  size: iconConfig.global.size,
  strokeWidth: iconConfig.global.strokeWidth,
  theme: iconConfig.global.theme as IIconConfig["theme"],
  strokeLinecap: iconConfig.global.strokeLinecap as IIconConfig["strokeLinecap"],
  strokeLinejoin: iconConfig.global.strokeLinejoin as IIconConfig["strokeLinejoin"],
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <IconProvider value={iconProviderValue}>
        <App />
      </IconProvider>
    </ThemeProvider>
  </StrictMode>
)
