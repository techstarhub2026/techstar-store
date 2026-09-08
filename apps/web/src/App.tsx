import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { StorefrontLayout } from './components/Layout';
import { HomePage } from './pages/Home';
import { CataloguePage } from './pages/Catalogue';
import { ProductPage } from './pages/Product';
import {
  CartPage, CheckoutPage, DelegatedPaymentPage, OrderConfirmationPage,
} from './pages/Checkout';
import {
  AccountLayout, AddressTab, OrderDetailPage, OrdersTab, PasswordTab, ProfileTab,
} from './pages/Account';
import {
  AboutPage, ArticlePage, BlogIndexPage, ContactPage, FaqPage, LegalPage,
  NotFoundPage, ServicePage, ServicesPage,
} from './pages/Content';
import { AdminLayout } from './admin/AdminLayout';
import { AdminDashboard } from './admin/Dashboard';
import { AdminProductForm, AdminProducts } from './admin/Products';
import { AdminOrderDetail, AdminOrders } from './admin/Orders';
import {
  AdminCategories, AdminMedia, AdminStock, AdminSubcategories,
} from './admin/Catalogue';
import {
  AdminAudit, AdminBanners, AdminCampaigns, AdminContacts, AdminCustomerDetail,
  AdminCustomers, AdminModeration, AdminSearches, AdminSettings, AdminShipping, AdminStaff,
} from './admin/Ops';
import {
  AdminArticles, AdminFaqs, AdminInvoices, AdminPartners, AdminServices,
} from './admin/Content';
import { AdminCourses, AdminEvents, AdminTeam } from './admin/WebsiteContent';
import {
  AdminHeroSlides, AdminHighlights, AdminHomeOffer, AdminPrograms, AdminProjects, AdminSiteStats,
} from './admin/SiteHome';
import {
  AdminPurchaseOrderDetail, AdminPurchaseOrderForm, AdminPurchaseOrders,
  AdminReplenishment, AdminStockEditor, AdminStockTakeDetail, AdminStockTakes, AdminSuppliers,
} from './admin/Inventory';
import {
  AdminBusinessReport, AdminProfitReport, AdminStockDecisions,
} from './admin/Reports';
import { useAuth, useCart, useWishlist } from './stores';

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const loadCart = useCart((s) => s.load);
  const loadWishlist = useWishlist((s) => s.load);

  useEffect(() => {
    void (async () => {
      await bootstrap();
      await loadCart();
      await loadWishlist();
    })();
  }, [bootstrap, loadCart, loadWishlist]);

  return (
    <Routes>
      {/* ───────────────────────────────────────────── storefront ── */}
      <Route element={<StorefrontLayout />}>
        <Route index element={<HomePage />} />

        <Route path="products" element={<CataloguePage mode="all" />} />
        <Route path="products/c/:categorySlug" element={<CataloguePage mode="category" />} />
        <Route path="products/s/:subcategorySlug" element={<CataloguePage mode="subcategory" />} />
        <Route path="search" element={<CataloguePage mode="search" />} />
        <Route path="product/:slug" element={<ProductPage />} />

        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="order/confirmation/:orderNumber" element={<OrderConfirmationPage />} />
        <Route path="pay/:token" element={<DelegatedPaymentPage />} />

        <Route path="account" element={<AccountLayout />}>
          <Route index element={<Navigate to="/account/orders" replace />} />
          <Route path="profile" element={<ProfileTab />} />
          <Route path="orders" element={<OrdersTab />} />
          <Route path="orders/:orderNumber" element={<OrderDetailPage />} />
          <Route path="address" element={<AddressTab />} />
          <Route path="password" element={<PasswordTab />} />
        </Route>

        <Route path="about" element={<AboutPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="privacy-policy" element={<LegalPage kind="privacy" />} />
        <Route path="terms-and-conditions" element={<LegalPage kind="terms" />} />
        <Route path="blog" element={<BlogIndexPage />} />
        <Route path="blog/:slug" element={<ArticlePage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="services/:slug" element={<ServicePage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* ──────────────────────────────────────────────── admin ── */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />

        <Route path="products" element={<AdminProducts />} />
        <Route path="products/new" element={<AdminProductForm mode="create" />} />
        <Route path="products/:id/edit" element={<AdminProductForm mode="edit" />} />
        <Route path="categories" element={<AdminCategories />} />
        <Route path="subcategories" element={<AdminSubcategories />} />
        <Route path="stock" element={<AdminStock />} />
        <Route path="stock-editor" element={<AdminStockEditor />} />
        <Route path="replenishment" element={<AdminReplenishment />} />
        <Route path="suppliers" element={<AdminSuppliers />} />
        <Route path="purchase-orders" element={<AdminPurchaseOrders />} />
        <Route path="purchase-orders/new" element={<AdminPurchaseOrderForm />} />
        <Route path="purchase-orders/:id" element={<AdminPurchaseOrderDetail />} />
        <Route path="stock-takes" element={<AdminStockTakes />} />
        <Route path="stock-takes/:id" element={<AdminStockTakeDetail />} />
        <Route path="media" element={<AdminMedia />} />

        <Route path="orders" element={<AdminOrders />} />
        <Route path="orders/:orderNumber" element={<AdminOrderDetail />} />
        <Route path="invoices" element={<AdminInvoices />} />
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="customers/:id" element={<AdminCustomerDetail />} />
        <Route path="shipping" element={<AdminShipping />} />

        <Route path="banners" element={<AdminBanners />} />
        <Route path="articles" element={<AdminArticles />} />
        <Route path="services" element={<AdminServices />} />
        <Route path="partners" element={<AdminPartners />} />
        <Route path="comments" element={<AdminModeration kind="comments" />} />
        <Route path="reviews" element={<AdminModeration kind="reviews" />} />
        <Route path="faqs" element={<AdminFaqs />} />
        <Route path="team" element={<AdminTeam />} />
        <Route path="events" element={<AdminEvents />} />
        <Route path="courses" element={<AdminCourses />} />

        <Route path="site/hero" element={<AdminHeroSlides />} />
        <Route path="site/highlights" element={<AdminHighlights />} />
        <Route path="site/stats" element={<AdminSiteStats />} />
        <Route path="site/offer" element={<AdminHomeOffer />} />
        <Route path="site/programs" element={<AdminPrograms />} />
        <Route path="site/projects" element={<AdminProjects />} />

        <Route path="campaigns" element={<AdminCampaigns />} />
        <Route path="contacts" element={<AdminContacts />} />
        <Route path="searches" element={<AdminSearches />} />
        <Route path="reports/profit" element={<AdminProfitReport />} />
        <Route path="reports/stock-decisions" element={<AdminStockDecisions />} />
        <Route path="reports/business" element={<AdminBusinessReport />} />

        <Route path="settings" element={<AdminSettings />} />
        <Route path="staff" element={<AdminStaff />} />
        <Route path="audit" element={<AdminAudit />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
