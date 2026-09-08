import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Heart, LogOut,
  Menu, Search, ShoppingCart, Trash2, User, X,
} from 'lucide-react';
import { api, qs } from '../lib/api';
import type { CategoryDto, ProductCard as ProductCardDto, SettingsDto } from '../lib/types';
import { useAuth, useCart, useUi, useWishlist } from '../stores';
import { Button, IconButton, QuantityStepper } from './ui';
import { AuthModal } from './AuthModal';
import { PLACEHOLDER } from './ProductCard';

// ═══════════════════════════════════════════════════════════ hooks ══

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsDto>('/settings/public'),
    staleTime: 30 * 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryDto[]>('/categories'),
    staleTime: 30 * 60_000,
  });
}

// ═════════════════════════════════════════════════════ search field ══

function SearchField({ onDone }: { onDone?: () => void }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ProductCardDto[]>([]);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const rows = await api.get<ProductCardDto[]>(
          `/search${qs({ q: term.trim(), suggest: 'true' })}`,
        );
        setSuggestions(rows);
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    setOpen(false);
    onDone?.();
    navigate(`/search?q=${encodeURIComponent(term.trim())}`);
  };

  return (
    <div className="ts-search" ref={boxRef}>
      <form onSubmit={submit} style={{ display: 'flex', width: '100%' }} role="search">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder="Search products, SKUs, part numbers…"
          aria-label="Search products"
          role="combobox"
          aria-expanded={open}
          aria-controls="ts-suggest"
        />
        <button type="submit">Search</button>
      </form>

      {open && suggestions.length > 0 ? (
        <div className="ts-suggest" id="ts-suggest" role="listbox">
          {suggestions.map((s) => (
            <Link
              key={s.slug}
              to={`/product/${s.slug}`}
              className="ts-suggest__item"
              role="option"
              aria-selected={false}
              onClick={() => {
                setOpen(false);
                onDone?.();
              }}
              style={{ color: 'inherit' }}
            >
              <img src={s.image?.sm ?? PLACEHOLDER} alt="" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--ts-text-muted)' }}>{s.subcategory.name}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }} className="ts-clamp-2">{s.name}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ts-primary)' }}>
                {s.price.formatted}
              </div>
            </Link>
          ))}
          <button
            className="ts-suggest__item"
            style={{ width: '100%', border: 0, background: 'var(--ts-surface-alt)', fontWeight: 600, fontSize: 13 }}
            onClick={submit as never}
          >
            See all results for “{term.trim()}”
          </button>
        </div>
      ) : null}

      {open && term.trim().length >= 2 && suggestions.length === 0 ? (
        <div className="ts-suggest" style={{ padding: 14, fontSize: 13.5 }}>
          <div className="mb-2">No products match “{term.trim()}”.</div>
          <Link to="/products" onClick={() => setOpen(false)}>Browse all products</Link>
        </div>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════ mega menu ══

function MegaMenu({ categories, onNavigate }: { categories: CategoryDto[]; onNavigate: () => void }) {
  const [active, setActive] = useState(0);
  const current = categories[active];

  return (
    <div className="ts-mega" role="menu">
      <div className="ts-mega__cats">
        {categories.map((c, i) => (
          <button
            key={c.slug}
            className={`ts-mega__cat ${i === active ? 'ts-mega__cat--active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => {
              onNavigate();
              window.location.href = `/products/c/${c.slug}`;
            }}
          >
            <span>{c.name}</span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      <div className="ts-mega__subs">
        {current?.subcategories.map((s) => (
          <Link
            key={s.slug}
            to={`/products/s/${s.slug}`}
            className="ts-mega__sub"
            onClick={onNavigate}
            style={{ color: 'inherit' }}
          >
            <span>{s.name}</span>
            <span className="ts-mega__count">{s.productCount}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════ drawers ══

function CartDrawer() {
  const open = useUi((s) => s.cartOpen);
  const setOpen = useUi((s) => s.setCartOpen);
  const { cart, setQuantity, remove, busy } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <>
      <div className="ts-scrim" onClick={() => setOpen(false)} />
      <aside className="ts-drawer ts-drawer--right" role="dialog" aria-label="Shopping cart">
        <div className="ts-drawer__head">
          <h2>Shopping cart {cart.itemCount ? `(${cart.itemCount})` : ''}</h2>
          <IconButton label="Close cart" onClick={() => setOpen(false)} style={{ color: '#fff' }}>
            <X size={18} />
          </IconButton>
        </div>

        <div className="ts-drawer__body">
          {cart.notices.length > 0 ? (
            <div className="mb-3" style={{ background: '#fdf6e7', border: '1px solid #f0dcb0', borderRadius: 6, padding: 10, fontSize: 13 }}>
              {cart.notices.map((n, i) => (
                <div key={i} className="d-flex gap-2 align-items-start">
                  <AlertCircle size={14} style={{ marginTop: 3, color: 'var(--ts-warning)' }} />
                  <span>{n.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          {cart.lines.length === 0 ? (
            <div className="ts-empty">
              <ShoppingCart size={44} />
              <h3 style={{ fontSize: 17 }}>Your cart is empty</h3>
              <p className="ts-muted" style={{ fontSize: 14 }}>
                Browse the catalogue and add the parts you need.
              </p>
              <Button onClick={() => { setOpen(false); navigate('/products'); }}>Browse products</Button>
            </div>
          ) : (
            cart.lines.map((l) => (
              <div key={l.sku} className="d-flex gap-3 py-3" style={{ borderBottom: '1px solid var(--ts-border)' }}>
                <img
                  src={l.image?.sm ?? PLACEHOLDER}
                  alt=""
                  width={64}
                  height={64}
                  style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link
                    to={`/product/${l.productSlug}`}
                    onClick={() => setOpen(false)}
                    className="ts-clamp-2"
                    style={{ fontSize: 13.5, fontWeight: 600, color: 'inherit' }}
                  >
                    {l.name}
                  </Link>
                  {l.attributes.length > 0 ? (
                    <div className="ts-muted" style={{ fontSize: 12 }}>
                      {l.attributes.map((a) => `${a.name}: ${a.value}`).join(' · ')}
                    </div>
                  ) : null}
                  <div className="ts-mono ts-muted" style={{ fontSize: 11 }}>{l.sku}</div>

                  <div className="d-flex align-items-center justify-content-between mt-2 gap-2">
                    <QuantityStepper
                      value={l.quantity}
                      max={Math.max(1, l.available)}
                      onChange={(n) => void setQuantity(l.sku, n)}
                      disabled={busy || l.unavailable}
                    />
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{l.lineTotal.formatted}</div>
                  </div>
                </div>
                <IconButton label={`Remove ${l.name}`} onClick={() => void remove(l.sku)}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            ))
          )}
        </div>

        {cart.lines.length > 0 ? (
          <div className="ts-drawer__foot">
            <div className="d-flex justify-content-between mb-1">
              <strong>Sub total</strong>
              <strong>{cart.subtotal.formatted}</strong>
            </div>
            <div className="ts-muted mb-3" style={{ fontSize: 12 }}>
              Shipping is calculated at checkout.
            </div>
            <Button block onClick={() => { setOpen(false); navigate('/checkout'); }}>Checkout</Button>
            <div className="text-center mt-2">
              <Link to="/cart" onClick={() => setOpen(false)} style={{ fontSize: 13 }}>View cart</Link>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function WishlistDrawer() {
  const open = useUi((s) => s.wishlistOpen);
  const setOpen = useUi((s) => s.setWishlistOpen);
  const { items, remove } = useWishlist();
  const add = useCart((s) => s.add);
  const navigate = useNavigate();

  if (!open) return null;
  return (
    <>
      <div className="ts-scrim" onClick={() => setOpen(false)} />
      <aside className="ts-drawer ts-drawer--right" role="dialog" aria-label="Wishlist">
        <div className="ts-drawer__head">
          <h2>Wishlist</h2>
          <IconButton label="Close wishlist" onClick={() => setOpen(false)} style={{ color: '#fff' }}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="ts-drawer__body">
          {items.length === 0 ? (
            <div className="ts-empty">
              <Heart size={44} />
              <h3 style={{ fontSize: 17 }}>Your wishlist is empty</h3>
              <Button onClick={() => { setOpen(false); navigate('/products'); }}>Browse products</Button>
            </div>
          ) : (
            items.map((i) => (
              <div key={i.productSlug} className="d-flex gap-3 py-3" style={{ borderBottom: '1px solid var(--ts-border)' }}>
                <img src={i.image?.sm ?? PLACEHOLDER} alt="" width={56} height={56}
                  style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/product/${i.productSlug}`} onClick={() => setOpen(false)}
                    className="ts-clamp-2" style={{ fontSize: 13.5, fontWeight: 600, color: 'inherit' }}>
                    {i.name}
                  </Link>
                  <div style={{ fontSize: 13, color: 'var(--ts-primary)', fontWeight: 600 }}>{i.price.formatted}</div>
                  <div className="d-flex gap-2 mt-2">
                    <Button size="sm" disabled={!i.inStock || !i.variantSku}
                      onClick={() => i.variantSku && void add(i.variantSku)}>
                      {i.inStock ? 'Move to cart' : 'Out of stock'}
                    </Button>
                  </div>
                </div>
                <IconButton label="Remove" onClick={() => void remove(i.productSlug)}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

function MobileNav({ categories }: { categories: CategoryDto[] }) {
  const open = useUi((s) => s.navOpen);
  const setOpen = useUi((s) => s.setNavOpen);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { user, logout } = useAuth();
  const openAuth = useUi((s) => s.openAuth);

  if (!open) return null;
  return (
    <>
      <div className="ts-scrim" onClick={() => setOpen(false)} />
      <aside className="ts-drawer ts-drawer--left" role="dialog" aria-label="Menu">
        <div className="ts-drawer__head">
          <h2>Menu</h2>
          <IconButton label="Close menu" onClick={() => setOpen(false)} style={{ color: '#fff' }}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="ts-drawer__body">
          <Link to="/" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>Home</Link>
          <Link to="/products" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>Products</Link>

          <div className="py-2" style={{ fontWeight: 600 }}>Shop</div>
          {categories.map((c) => (
            <div key={c.slug}>
              <button
                className="d-flex justify-content-between align-items-center w-100 py-2"
                style={{ border: 0, background: 'transparent', fontSize: 14, textAlign: 'left' }}
                onClick={() => setExpanded(expanded === c.slug ? null : c.slug)}
                aria-expanded={expanded === c.slug}
              >
                <span>{c.name}</span>
                <ChevronDown size={15} style={{ transform: expanded === c.slug ? 'rotate(180deg)' : undefined }} />
              </button>
              {expanded === c.slug ? (
                <div style={{ paddingLeft: 12 }}>
                  {c.subcategories.map((s) => (
                    <Link key={s.slug} to={`/products/s/${s.slug}`} className="d-block py-1"
                      onClick={() => setOpen(false)} style={{ color: 'var(--ts-text-secondary)', fontSize: 13.5 }}>
                      {s.name} <span className="ts-muted">({s.productCount})</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          <hr />
          <Link to="/services" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>Services</Link>
          <Link to="/blog" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>Blog</Link>
          <Link to="/contact" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>Contact us</Link>
          <Link to="/faq" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>FAQ</Link>
          <hr />
          {user ? (
            <>
              <Link to="/account/orders" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>My orders</Link>
              <Link to="/account/profile" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>My account</Link>
              {user.accountType === 'staff' ? (
                <Link to="/admin" className="d-block py-2" onClick={() => setOpen(false)} style={{ color: 'inherit' }}>Admin console</Link>
              ) : null}
              <button className="ts-btn ts-btn--ghost mt-2" onClick={() => { void logout(); setOpen(false); }}>Sign out</button>
            </>
          ) : (
            <Button block onClick={() => { setOpen(false); openAuth('login'); }}>Login | Register</Button>
          )}
        </div>
      </aside>
    </>
  );
}

// ═════════════════════════════════════════════════════════ toasts ══

function Toasts() {
  const { toasts, dismiss } = useUi();
  if (!toasts.length) return null;
  return (
    <div className="ts-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ts-toast ts-toast--${t.tone}`}>
          {t.tone === 'success' ? (
            <CheckCircle2 size={18} style={{ color: 'var(--ts-success)', flexShrink: 0, marginTop: 1 }} />
          ) : (
            <AlertCircle size={18} style={{ color: `var(--ts-${t.tone})`, flexShrink: 0, marginTop: 1 }} />
          )}
          <div style={{ flex: 1 }}>
            <div className="ts-toast__title">{t.title}</div>
            {t.text ? <div className="ts-toast__text">{t.text}</div> : null}
          </div>
          <IconButton label="Dismiss" onClick={() => dismiss(t.id)}><X size={14} /></IconButton>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════ email banner ══

function VerifyBanner() {
  const { user } = useAuth();
  const toast = useUi((s) => s.toast);
  const [sent, setSent] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (!user || user.emailVerified || !user.email || hidden) return null;
  return (
    <div style={{ background: '#fdf6e7', borderBottom: '1px solid #f0dcb0', fontSize: 13.5 }}>
      <div className="container d-flex align-items-center gap-3 py-2 flex-wrap">
        <AlertCircle size={16} style={{ color: 'var(--ts-warning)' }} />
        <span style={{ flex: 1 }}>Please verify your email address to receive order updates.</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={sent}
          onClick={async () => {
            try {
              await api.post('/auth/email/verify/request');
              setSent(true);
              toast({ tone: 'success', title: 'Verification link sent' });
            } catch {
              toast({ tone: 'danger', title: 'Could not send the link' });
            }
          }}
        >
          {sent ? 'Verification link sent' : 'Send verification link'}
        </Button>
        <IconButton label="Dismiss" onClick={() => setHidden(true)}><X size={14} /></IconButton>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ shell ══

export function StorefrontLayout() {
  const { data: settings } = useSettings();
  const { data: categories = [] } = useCategories();
  const { user, logout } = useAuth();
  const cart = useCart((s) => s.cart);
  const wishlist = useWishlist((s) => s.items);
  const ui = useUi();
  const location = useLocation();
  const [shopOpen, setShopOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const shopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShopOpen(false);
    setSupportOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!shopRef.current?.contains(e.target as Node)) setShopOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);


  const wa = settings?.contact.whatsapp ?? '';

  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>

      <header className="ts-header">
        <div className="ts-header__main">
          <div className="container d-flex align-items-center gap-3">
            <button
              className="ts-navicon d-md-none"
              aria-label="Open menu"
              onClick={() => ui.setNavOpen(true)}
            >
              <Menu size={22} />
            </button>

            {/* The header sits on navy, so the light variant of the mark
                (white wordmark, orange cart) is the one that reads here. */}
            <Link to="/" className="ts-logo" aria-label="TechStar Store home">
              <img
                src="/techstar-store-logo-light.png"
                alt="TechStar Store"
                className="ts-logo__img"
                width={168}
                height={95}
              />
              <span className="ts-logo__tag d-none d-lg-block">Build. Learn. Innovate.</span>
            </Link>

            <div className="flex-grow-1 d-none d-lg-flex justify-content-center">
              <SearchField />
            </div>

            <div className="d-flex align-items-center gap-2 ms-auto">
              <button className="ts-navicon" onClick={() => ui.setWishlistOpen(true)} aria-label="Open wishlist">
                <Heart size={20} />
                <span className="ts-navicon__count">{wishlist.length}</span>
              </button>
              <button className="ts-navicon me-2" onClick={() => ui.setCartOpen(true)} aria-label="Open cart">
                <ShoppingCart size={20} />
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={cart.itemCount}
                    className="ts-navicon__count"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                  >
                    {cart.itemCount}
                  </motion.span>
                </AnimatePresence>
                <span className="d-none d-lg-inline" style={{ fontSize: 13 }}>{cart.subtotal.formatted}</span>
              </button>

              {user ? (
                <div className="dropdown">
                  <button className="ts-navicon" onClick={() => setSupportOpen((v) => !v)} aria-label="Account menu">
                    <User size={20} />
                    <span className="d-none d-lg-inline" style={{ fontSize: 13 }}>{user.username.split(' ')[0]}</span>
                    <ChevronDown size={14} />
                  </button>
                  {supportOpen ? (
                    <div style={{
                      position: 'absolute', right: 12, marginTop: 6, background: '#fff', minWidth: 200,
                      border: '1px solid var(--ts-border)', borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-2)', zIndex: 1050, padding: 6,
                    }}>
                      <Link to="/account/orders" className="d-block px-3 py-2" style={{ color: 'inherit', fontSize: 14 }}>My orders</Link>
                      <Link to="/account/profile" className="d-block px-3 py-2" style={{ color: 'inherit', fontSize: 14 }}>Account settings</Link>
                      {user.accountType === 'staff' ? (
                        <Link to="/admin" className="d-block px-3 py-2" style={{ color: 'inherit', fontSize: 14, fontWeight: 600 }}>Admin console</Link>
                      ) : null}
                      <hr style={{ margin: '6px 0' }} />
                      <button
                        className="d-flex align-items-center gap-2 px-3 py-2 w-100"
                        style={{ border: 0, background: 'transparent', fontSize: 14 }}
                        onClick={() => { setSupportOpen(false); void logout(); }}
                      >
                        <LogOut size={15} /> Sign out
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Button size="sm" onClick={() => ui.openAuth('login')}>Login | Register</Button>
              )}
            </div>
          </div>

          <div className="container d-lg-none mt-3">
            <SearchField />
          </div>
        </div>

        <nav className="ts-header__nav d-none d-md-block" aria-label="Catalogue">
          <div className="container position-relative d-flex" ref={shopRef}>
            <NavLink to="/products" className={({ isActive }) => `ts-navlink ${isActive ? 'ts-navlink--active' : ''}`}>
              Products
            </NavLink>
            <button
              className={`ts-navlink ${shopOpen ? 'ts-navlink--active' : ''}`}
              onClick={() => setShopOpen((v) => !v)}
              aria-expanded={shopOpen}
              aria-haspopup="true"
            >
              Shop <ChevronDown size={14} />
            </button>
            <NavLink to="/services" className={({ isActive }) => `ts-navlink ${isActive ? 'ts-navlink--active' : ''}`}>
              Services
            </NavLink>
            <NavLink to="/blog" className={({ isActive }) => `ts-navlink ${isActive ? 'ts-navlink--active' : ''}`}>
              Blog
            </NavLink>
            <NavLink to="/contact" className={({ isActive }) => `ts-navlink ${isActive ? 'ts-navlink--active' : ''}`}>
              Contact us
            </NavLink>
            <NavLink to="/faq" className={({ isActive }) => `ts-navlink ${isActive ? 'ts-navlink--active' : ''}`}>
              FAQ
            </NavLink>

            {shopOpen && categories.length > 0 ? (
              <MegaMenu categories={categories} onNavigate={() => setShopOpen(false)} />
            ) : null}
          </div>
        </nav>
      </header>

      <VerifyBanner />

      <main id="main">
        <Outlet />
      </main>

      <footer className="ts-footer">
        <div className="container">
          <div className="row g-4">
            <div className="col-12 col-md-6 col-lg-3">
              <h3>Contact</h3>
              <div style={{ fontSize: 14 }}>
                <div>{settings?.store.legalName ?? 'TechStar Store Limited'}</div>
                <div>{settings?.store.poBox}</div>
                <div>{settings?.contact.address}</div>
                <div className="mt-2">{settings?.contact.phonePrimary}</div>
                <div>{settings?.contact.phoneSecondary}</div>
                <div>{settings?.contact.email}</div>
              </div>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <h3>Company</h3>
              <div style={{ fontSize: 14 }}>
                <div>Country of registration: {settings?.store.registrationCountry}</div>
                {settings?.store.tin ? <div>TIN: {settings.store.tin}</div> : null}
                {settings?.store.registrationNumber ? (
                  <div>Registration: {settings.store.registrationNumber}</div>
                ) : null}
                <div className="mt-2">{settings?.contact.openingHours}</div>
              </div>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <h3>Policies &amp; Support</h3>
              <Link to="/privacy-policy">Privacy policy</Link>
              <Link to="/terms-and-conditions">Terms &amp; conditions</Link>
              <Link to="/faq">FAQ</Link>
              <Link to="/about">About us</Link>
              <Link to="/contact">Contact us</Link>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <h3>Follow us</h3>
              <div className="d-flex gap-2 flex-wrap">
                {Object.entries(settings?.social ?? {})
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <a key={k} href={v} target="_blank" rel="noopener noreferrer" style={{ textTransform: 'capitalize' }}>
                      {k}
                    </a>
                  ))}
                {Object.values(settings?.social ?? {}).every((v) => !v) ? (
                  <span className="ts-muted" style={{ fontSize: 13 }}>Social links coming soon.</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="ts-footer__legal">
          © {new Date().getFullYear()} {settings?.store.name ?? 'TechStar Store'}. All rights reserved.
        </div>
      </footer>

      {wa ? (
        <a
          className="ts-whatsapp"
          href={`https://wa.me/${wa}?text=${encodeURIComponent('Hello TechStar Store, I have a question about ')}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with TechStar on WhatsApp"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.48-1.75-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.02-1.05 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35M12.04 21.5h-.01a9.44 9.44 0 0 1-4.8-1.32l-.35-.2-3.57.94.95-3.48-.22-.36a9.42 9.42 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44 2.52 0 4.89.99 6.67 2.77a9.38 9.38 0 0 1 2.76 6.68c0 5.2-4.24 9.44-9.44 9.44M20.5 3.49A11.8 11.8 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.59 5.93L.08 24l6.35-1.66a11.8 11.8 0 0 0 5.61 1.43h.01c6.53 0 11.85-5.32 11.86-11.86a11.8 11.8 0 0 0-3.41-8.42" />
          </svg>
        </a>
      ) : null}

      <CartDrawer />
      <WishlistDrawer />
      <MobileNav categories={categories} />
      <AuthModal />
      <Toasts />
    </>
  );
}
