import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { i18n } from "@/i18n/i18n"
import { detectBrowserLanguage } from "@/i18n/languages"
import { ThemeProvider } from "@/components/wooh/theme-provider.tsx"

// Before authentication we cannot read the stored language, so boot with the
// browser language. LanguageProvider reconciles with the backend afterwards.
void i18n.changeLanguage(detectBrowserLanguage())

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <App />
    </ThemeProvider>
  </StrictMode>
)
