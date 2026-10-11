// Throwaway harness: mounts the real ProviderPage without the auth guard so a
// headless browser can click through the model endpoint combobox. Deleted
// after verification.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import "./index.css"
import { i18n } from "@/i18n/i18n"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ProviderPage } from "@/pages/ProviderPage"

void i18n.changeLanguage("zh")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SidebarProvider>
      <MemoryRouter>
        <ProviderPage />
      </MemoryRouter>
    </SidebarProvider>
  </StrictMode>,
)
