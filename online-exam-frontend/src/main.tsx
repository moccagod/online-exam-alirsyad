import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Recovery from './components/Recovery.jsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Recovery />
  </StrictMode>,
)
