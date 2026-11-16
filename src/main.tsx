import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CrashScreen } from './CrashScreen.tsx'
import { IS_TOUCH_DEVICE } from './engine/touch.ts'

// No browser right-click menu and no text selection anywhere in the game
// (menus, HUD and cards included), except in text boxes. These only cancel the
// browser's default action, so clicks still reach the game as before.
const isTextBox = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select');
document.addEventListener('contextmenu', (e) => { if (!isTextBox(e.target)) e.preventDefault() })
document.addEventListener('selectstart', (e) => { if (!isTextBox(e.target)) e.preventDefault() })
document.addEventListener('dragstart', (e) => { if (!(e.target instanceof HTMLElement && e.target.draggable)) e.preventDefault() })
document.body.classList.add('game-page')
if (IS_TOUCH_DEVICE) document.body.classList.add('touch-device')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashScreen>
      <App />
    </CrashScreen>
  </StrictMode>,
)
