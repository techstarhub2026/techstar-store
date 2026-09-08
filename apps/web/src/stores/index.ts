import { create } from 'zustand';
import { api, setAccessToken, setUnauthorisedHandler } from '../lib/api';
import type { AuthUser, CartDto } from '../lib/types';

// ─────────────────────────────────────────────────────────── toasts ──

export interface Toast {
  id: number;
  tone: 'success' | 'danger' | 'warning' | 'info';
  title: string;
  text?: string;
}

interface UiState {
  toasts: Toast[];
  cartOpen: boolean;
  wishlistOpen: boolean;
  navOpen: boolean;
  authOpen: false | 'login' | 'register' | 'forgot';
  nextRoute: string | null;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  setCartOpen: (v: boolean) => void;
  setWishlistOpen: (v: boolean) => void;
  setNavOpen: (v: boolean) => void;
  openAuth: (mode: 'login' | 'register' | 'forgot', nextRoute?: string) => void;
  closeAuth: () => void;
}

let toastId = 0;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  cartOpen: false,
  wishlistOpen: false,
  navOpen: false,
  authOpen: false,
  nextRoute: null,
  toast: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    // Errors stay until dismissed; everything else clears itself.
    if (t.tone !== 'danger') {
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setCartOpen: (v) => set({ cartOpen: v }),
  setWishlistOpen: (v) => set({ wishlistOpen: v }),
  setNavOpen: (v) => set({ navOpen: v }),
  openAuth: (mode, nextRoute) => set({ authOpen: mode, nextRoute: nextRoute ?? null }),
  closeAuth: () => set({ authOpen: false }),
}));

// ───────────────────────────────────────────────────────────── auth ──

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  isStaff: () => boolean;
  can: (permission: string) => boolean;
  bootstrap: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  register: (input: Record<string, unknown>) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,

  isStaff: () => get().user?.accountType === 'staff',
  can: (permission) => {
    const u = get().user;
    if (!u || u.accountType !== 'staff') return false;
    return u.roles.includes('owner') || u.permissions.includes(permission);
  },

  bootstrap: async () => {
    try {
      const ok = await api.refresh();
      if (ok) {
        const user = await api.get<AuthUser>('/me');
        set({ user });
      }
    } catch {
      /* not signed in — a normal state */
    } finally {
      set({ ready: true });
    }
  },

  login: async (identifier, password) => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', {
      identifier,
      password,
    });
    setAccessToken(res.accessToken);
    set({ user: res.user });
    await useCart.getState().merge();
    return res.user;
  },

  register: async (input) => {
    const res = await api.post<{ accessToken: string; user: AuthUser }>('/auth/register', input);
    setAccessToken(res.accessToken);
    set({ user: res.user });
    await useCart.getState().merge();
    return res.user;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* signing out locally regardless */
    }
    setAccessToken(null);
    set({ user: null });
    await useCart.getState().load();
  },

  setUser: (user) => set({ user }),
}));

setUnauthorisedHandler(() => {
  useAuth.getState().setUser(null);
});

// ───────────────────────────────────────────────────────────── cart ──

const EMPTY: CartDto = {
  lines: [],
  notices: [],
  subtotal: { amount: 0, currency: 'TZS', formatted: 'TZS 0' },
  itemCount: 0,
  unitCount: 0,
};

interface CartState {
  cart: CartDto;
  busy: boolean;
  load: () => Promise<void>;
  add: (variantSku: string, quantity?: number) => Promise<void>;
  setQuantity: (variantSku: string, quantity: number) => Promise<void>;
  remove: (variantSku: string) => Promise<void>;
  clear: () => Promise<void>;
  merge: () => Promise<void>;
}

export const useCart = create<CartState>((set, get) => ({
  cart: EMPTY,
  busy: false,

  load: async () => {
    try {
      const cart = await api.get<CartDto>('/cart');
      set({ cart });
    } catch {
      set({ cart: EMPTY });
    }
  },

  add: async (variantSku, quantity = 1) => {
    set({ busy: true });
    try {
      const cart = await api.post<CartDto & { clamped?: { available: number } }>('/cart/items', {
        variantSku,
        quantity,
      });
      set({ cart });
      useUi.getState().setCartOpen(true);
      if (cart.clamped) {
        useUi.getState().toast({
          tone: 'warning',
          title: 'Quantity adjusted',
          text: `Only ${cart.clamped.available} available.`,
        });
      }
    } finally {
      set({ busy: false });
    }
  },

  setQuantity: async (variantSku, quantity) => {
    set({ busy: true });
    try {
      const cart = await api.patch<CartDto>(`/cart/items/${encodeURIComponent(variantSku)}`, {
        quantity,
      });
      set({ cart });
    } finally {
      set({ busy: false });
    }
  },

  remove: async (variantSku) => {
    set({ busy: true });
    try {
      const cart = await api.del<CartDto>(`/cart/items/${encodeURIComponent(variantSku)}`);
      set({ cart });
    } finally {
      set({ busy: false });
    }
  },

  clear: async () => {
    const cart = await api.del<CartDto>('/cart');
    set({ cart });
  },

  merge: async () => {
    try {
      const cart = await api.post<CartDto & { merged: number }>('/cart/merge');
      set({ cart });
      if (cart.merged > 0) {
        useUi.getState().toast({
          tone: 'success',
          title: `${cart.merged} item${cart.merged === 1 ? '' : 's'} added to your cart`,
        });
      }
    } catch {
      await get().load();
    }
  },
}));

// ───────────────────────────────────────────────────────── wishlist ──

interface WishlistItem {
  productSlug: string;
  name: string;
  image: { sm: string; md: string; lg: string } | null;
  price: { formatted: string; amount: number };
  variantSku: string | null;
  inStock: boolean;
}

interface WishlistState {
  items: WishlistItem[];
  load: () => Promise<void>;
  toggle: (productSlug: string, variantSku?: string) => Promise<void>;
  has: (productSlug: string) => boolean;
  remove: (productSlug: string) => Promise<void>;
}

export const useWishlist = create<WishlistState>((set, get) => ({
  items: [],
  load: async () => {
    try {
      const res = await api.get<{ items: WishlistItem[] }>('/wishlist');
      set({ items: res.items });
    } catch {
      set({ items: [] });
    }
  },
  has: (productSlug) => get().items.some((i) => i.productSlug === productSlug),
  toggle: async (productSlug, variantSku) => {
    if (get().has(productSlug)) {
      await get().remove(productSlug);
      return;
    }
    const res = await api.post<{ items: WishlistItem[] }>('/wishlist/items', {
      productSlug,
      variantSku,
    });
    set({ items: res.items });
    useUi.getState().toast({ tone: 'success', title: 'Added to your wishlist' });
  },
  remove: async (productSlug) => {
    const res = await api.del<{ items: WishlistItem[] }>(
      `/wishlist/items/${encodeURIComponent(productSlug)}`,
    );
    set({ items: res.items });
  },
}));
