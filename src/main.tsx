import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { AuthProvider } from './components/AuthProvider'
import { CartProvider } from './components/CartProvider'
import { ThemeProvider } from './components/ThemeProvider'
import './styles/global.css'
import './styles/menu.css'
import './styles/cart.css'
import './styles/checkout.css'
import './styles/staff.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)