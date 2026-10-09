import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/dm-sans' // bundled, so the app stays fully offline
import 'leaflet/dist/leaflet.css'
import './index.css'
import { App } from './App'
import { applyTheme, storedTheme } from './theme'

applyTheme(storedTheme()) // before first paint, so there is no flash of the wrong theme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
