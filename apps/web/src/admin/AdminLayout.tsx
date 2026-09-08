import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Boxes, Building2, CalendarDays, ClipboardCheck, ClipboardList, FileText,
  FolderKanban, GalleryHorizontal, Globe, GraduationCap, Handshake, Hash,
  Image as ImageIcon, Layers, ListChecks, LayoutDashboard, LayoutGrid, LogOut, Mail, Megaphone, Menu,
  MessageSquare, Newspaper, Package, PieChart, Search, Settings, ShieldCheck, ShoppingBag,
  Sparkles, Star, Store, Table2, Tags, Truck, Users, Warehouse,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useUi } from '../stores';
import { Button } from '../components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
  badge?: number;
}

export function AdminLayout() {
  const { user, ready, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const openAuth = useUi((s) => s.openAuth);
  const [open, setOpen] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ['admin', 'summary', 'nav'],
    queryFn: () => api.get('/admin/analytics/summary?period=last30days'),
    enabled: Boolean(user && user.accountType === 'staff'),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (ready && !user) {
      openAuth('login', '/admin');
      navigate('/');
    }
  }, [ready, user, openAuth, navigate]);

  useEffect(() => setOpen(false), [location.pathname]);

  if (!ready) return <div className="p-5"><div className="ts-skel" style={{ height: 200 }} /></div>;

  if (!user) return null;

  if (user.accountType !== 'staff') {
    return (
      <div className="container py-5 text-center">
        <ShieldCheck size={48} style={{ color: 'var(--ts-text-muted)' }} />
        <h1 style={{ fontSize: 22, marginTop: 12 }}>You don’t have access to this page.</h1>
        <Link to="/" className="ts-btn ts-btn--primary mt-3">Go home</Link>
      </div>
    );
  }

  const attention = (summary as any)?.attention ?? {};

  /**
   * The console drives two separate products that happen to share one login:
   * the online shop and the techstarhub.or.tz website. Grouping alone was not
   * enough to keep that straight, so the nav is split into labelled *realms*
   * with their own colour, and each group sits inside one of them. Anything
   * that genuinely serves both (media, campaigns, settings) lives in "Shared".
   */
  const realms: {
    key: string;
    label: string;
    caption: string;
    icon: React.ReactNode;
    groups: { title: string; items: NavItem[] }[];
  }[] = [
    {
      key: 'store',
      label: 'Online store',
      caption: 'Products, orders & stock',
      icon: <ShoppingBag size={14} />,
      groups: [
        {
          title: 'Catalogue',
          items: [
            { to: '/admin/products', label: 'Products', icon: <Package size={16} />, permission: 'product.read' },
            { to: '/admin/categories', label: 'Categories', icon: <Tags size={16} />, permission: 'category.read' },
            { to: '/admin/subcategories', label: 'Subcategories', icon: <Boxes size={16} />, permission: 'category.read' },
            { to: '/admin/banners', label: 'Store banners', icon: <ImageIcon size={16} />, permission: 'banner.read' },
            { to: '/admin/reviews', label: 'Product reviews', icon: <Star size={16} />, permission: 'review.moderate' },
          ],
        },
        {
          // Everything to do with "how much do we have".
          title: 'Inventory',
          items: [
            { to: '/admin/stock', label: 'Stock overview', icon: <Warehouse size={16} />, permission: 'stock.read', badge: attention.lowStock },
            { to: '/admin/stock-editor', label: 'Stock editor', icon: <Table2 size={16} />, permission: 'stock.adjust' },
            { to: '/admin/replenishment', label: 'What to reorder', icon: <Sparkles size={16} />, permission: 'stock.read' },
            { to: '/admin/purchase-orders', label: 'Purchase orders', icon: <Truck size={16} />, permission: 'stock.read' },
            { to: '/admin/stock-takes', label: 'Stocktakes', icon: <ClipboardCheck size={16} />, permission: 'stock.read' },
            { to: '/admin/suppliers', label: 'Suppliers', icon: <Store size={16} />, permission: 'stock.read' },
          ],
        },
        {
          title: 'Sales',
          items: [
            { to: '/admin/orders', label: 'Orders', icon: <ShoppingBag size={16} />, permission: 'order.read', badge: attention.awaitingVerification },
            { to: '/admin/invoices', label: 'Invoices', icon: <FileText size={16} />, permission: 'invoice.read' },
            { to: '/admin/customers', label: 'Customers', icon: <Users size={16} />, permission: 'customer.read' },
            { to: '/admin/shipping', label: 'Shipping', icon: <Truck size={16} />, permission: 'shipping.read' },
          ],
        },
        {
          title: 'Reports',
          items: [
            { to: '/admin/reports/profit', label: 'Profit & margin', icon: <PieChart size={16} />, permission: 'analytics.view' },
            { to: '/admin/reports/stock-decisions', label: 'What to stock next', icon: <BarChart3 size={16} />, permission: 'analytics.view' },
            { to: '/admin/reports/business', label: 'Customers & ops', icon: <Users size={16} />, permission: 'analytics.view' },
            { to: '/admin/searches', label: 'Search terms', icon: <Search size={16} />, permission: 'analytics.view' },
          ],
        },
      ],
    },
    {
      key: 'site',
      label: 'TechStar website',
      caption: 'techstarhub.or.tz pages',
      icon: <Globe size={14} />,
      groups: [
        {
          title: 'Home page',
          items: [
            { to: '/admin/site/hero', label: 'Hero slides', icon: <GalleryHorizontal size={16} />, permission: 'service.read' },
            { to: '/admin/site/highlights', label: 'Highlight cards', icon: <LayoutGrid size={16} />, permission: 'service.read' },
            { to: '/admin/site/stats', label: 'Impact numbers', icon: <Hash size={16} />, permission: 'service.read' },
            { to: '/admin/site/offer', label: 'What We Offer', icon: <ListChecks size={16} />, permission: 'service.read' },
          ],
        },
        {
          title: 'Pages',
          items: [
            { to: '/admin/courses', label: 'Courses', icon: <GraduationCap size={16} />, permission: 'service.read' },
            { to: '/admin/site/projects', label: 'Programs', icon: <FolderKanban size={16} />, permission: 'service.read' },
            { to: '/admin/events', label: 'Events', icon: <CalendarDays size={16} />, permission: 'service.read' },
            { to: '/admin/team', label: 'Team', icon: <Users size={16} />, permission: 'service.read' },
            { to: '/admin/services', label: 'Services', icon: <Building2 size={16} />, permission: 'service.read' },
            { to: '/admin/partners', label: 'Partners', icon: <Handshake size={16} />, permission: 'partner.read' },
          ],
        },
        {
          title: 'Blog & help',
          items: [
            { to: '/admin/articles', label: 'Articles', icon: <Newspaper size={16} />, permission: 'article.read' },
            { to: '/admin/comments', label: 'Comments', icon: <MessageSquare size={16} />, permission: 'comment.moderate' },
            { to: '/admin/faqs', label: 'FAQs', icon: <ClipboardList size={16} />, permission: 'article.read' },
          ],
        },
      ],
    },
    {
      key: 'shared',
      label: 'Shared',
      caption: 'Used by both',
      icon: <Layers size={14} />,
      groups: [
        {
          title: 'Marketing',
          items: [
            { to: '/admin/campaigns', label: 'Campaigns', icon: <Megaphone size={16} />, permission: 'campaign.read' },
            { to: '/admin/contacts', label: 'Contacts', icon: <Mail size={16} />, permission: 'campaign.read' },
          ],
        },
        {
          title: 'System',
          items: [
            { to: '/admin/media', label: 'Media library', icon: <ImageIcon size={16} />, permission: 'media.upload' },
            { to: '/admin/settings', label: 'Settings', icon: <Settings size={16} />, permission: 'settings.update' },
            { to: '/admin/staff', label: 'Staff & roles', icon: <ShieldCheck size={16} />, permission: 'staff.manage' },
            { to: '/admin/audit', label: 'Audit log', icon: <BarChart3 size={16} />, permission: 'audit.view' },
          ],
        },
      ],
    },
  ];

  return (
    <div className="ts-admin">
      <aside className={`ts-side ${open ? 'ts-side--open' : ''}`}>
        <div className="px-3 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Link to="/admin" aria-label="TechStar Store admin">
            <img
              src="/techstar-store-logo-light.png"
              alt="TechStar Store"
              style={{ width: 150, height: 'auto', display: 'block' }}
            />
          </Link>
          <div style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ts-primary)', marginTop: 4 }}>
            ADMIN CONSOLE
          </div>
        </div>

        <nav style={{ flex: 1, paddingBottom: 16 }}>
          {can('dashboard.view') ? (
            <NavLink
              to="/admin"
              end
              className={({ isActive }) => `ts-side__link ts-side__link--top ${isActive ? 'ts-side__link--active' : ''}`}
            >
              <LayoutDashboard size={16} />
              <span>Dashboard</span>
            </NavLink>
          ) : null}

          {realms.map((realm) => {
            const groups = realm.groups
              .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) }))
              .filter((g) => g.items.length);
            if (!groups.length) return null;

            return (
              <section key={realm.key} className={`ts-realm ts-realm--${realm.key}`}>
                <header className="ts-realm__head">
                  <span className="ts-realm__icon">{realm.icon}</span>
                  <span>
                    <span className="ts-realm__label">{realm.label}</span>
                    <span className="ts-realm__caption">{realm.caption}</span>
                  </span>
                </header>

                {groups.map((g) => (
                  <div key={g.title}>
                    <div className="ts-side__group">{g.title}</div>
                    {g.items.map((i) => (
                      <NavLink
                        key={i.to}
                        to={i.to}
                        className={({ isActive }) => `ts-side__link ${isActive ? 'ts-side__link--active' : ''}`}
                      >
                        {i.icon}
                        <span>{i.label}</span>
                        {i.badge ? <span className="ts-side__badge">{i.badge}</span> : null}
                      </NavLink>
                    ))}
                  </div>
                ))}
              </section>
            );
          })}
        </nav>

        <button
          className="ts-side__link"
          style={{ border: 0, background: 'transparent', width: '100%', textAlign: 'left' }}
          onClick={() => { void logout(); navigate('/'); }}
        >
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      <div className="ts-admin__main">
        <header className="ts-admin__top">
          <button className="ts-iconbtn d-lg-none" aria-label="Open menu" onClick={() => setOpen((v) => !v)}>
            <Menu size={20} />
          </button>
          <div style={{ flex: 1 }} />
          <Link to="/" target="_blank" className="ts-btn ts-btn--ghost ts-btn--sm">View store</Link>
          <div className="d-flex align-items-center gap-2">
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: 'var(--ts-primary)',
              color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700,
            }}>
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="d-none d-md-block" style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{user.username}</div>
              <div className="ts-muted" style={{ fontSize: 11 }}>{user.roles.join(', ') || 'staff'}</div>
            </div>
          </div>
        </header>

        <div className="ts-admin__content">
          <Outlet />
        </div>
      </div>

      {open ? <div className="ts-scrim d-lg-none" onClick={() => setOpen(false)} /> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
      <div>
        <h1 style={{ fontSize: 22, margin: 0 }}>{title}</h1>
        {description ? <p className="ts-muted mb-0" style={{ fontSize: 13.5 }}>{description}</p> : null}
      </div>
      {actions ? <div className="d-flex gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}
