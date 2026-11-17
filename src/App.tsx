import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { CartDrawer } from './components/CartDrawer'
import { Navbar } from './components/Navbar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RESTAURANT_NAME } from './lib/config'
import { syncLinkContextFromUrl } from './lib/orderContext'
import { AdminPage } from './pages/AdminPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { KitchenPage } from './pages/KitchenPage'
import { MenuPage } from './pages/MenuPage'
import { StaffLoginPage } from './pages/StaffLoginPage'

/** Layout for every customer-facing page: navbar + cart drawer. */
function CustomerLayout() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    document.title = RESTAURANT_NAME
    syncLinkContextFromUrl(pathname, search)
  }, [pathname, search])

  return (
    <>
      <Navbar />
      <div key={pathname} className="page-transition">
        <Outlet />
      </div>
      <CartDrawer />
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<CustomerLayout />}>
        <Route path="/" element={<MenuPage />} />
        <Route path="/t/:tableCode" element={<MenuPage />} />
        <Route path="/delivery" element={<MenuPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
      </Route>

      <Route path="/staff" element={<StaffLoginPage />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute allow={['admin']}>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/kitchen"
        element={
          <ProtectedRoute allow={['kitchen', 'admin']}>
            <KitchenPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}