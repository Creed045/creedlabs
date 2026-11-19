import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { CartDrawer } from './components/CartDrawer'
import { Navbar } from './components/Navbar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RESTAURANT_NAME } from './lib/config'
import { syncLinkContextFromUrl } from './lib/orderContext'
import { MenuPage } from './pages/MenuPage'

const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })))
const StaffLoginPage = lazy(() => import('./pages/StaffLoginPage').then((m) => ({ default: m.StaffLoginPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))
const KitchenPage = lazy(() => import('./pages/KitchenPage').then((m) => ({ default: m.KitchenPage })))

function RouteFallback() {
  return (
    <div className="page-center" aria-busy="true" aria-label="Loading view">
      <div className="spinner" />
    </div>
  )
}

/** Layout for every customer-facing page: navbar + cart drawer. */
function CustomerLayout() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    document.title = `${RESTAURANT_NAME} — Nigerian Classics, Smoky Proteins & Craft Drinks`
    syncLinkContextFromUrl(pathname, search)
  }, [pathname, search])

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to menu
      </a>
      <Navbar />
      <div id="main-content" key={pathname} className="page-transition">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </div>
      <CartDrawer />
    </>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
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
    </Suspense>
  )
}