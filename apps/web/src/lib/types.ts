export interface Money {
  amount: number;
  currency: string;
  formatted: string;
}

export interface MediaDto {
  id: number;
  publicId: string;
  sm: string;
  md: string;
  lg: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}

export interface VariantDto {
  sku: string;
  price: Money;
  listPrice: Money | null;
  compareAt: Money | null;
  discount: { percent: number; endsAt: string } | null;
  attributes: { name: string; unit: string | null; value: string }[];
  stock: { available: number; status: 'in_stock' | 'low_stock' | 'out_of_stock'; lowThreshold: number };
  isActive: boolean;
  position: number;
}

export interface ProductCard {
  slug: string;
  name: string;
  sku: string;
  shortDescription: string | null;
  brand: string | null;
  image: MediaDto | null;
  subcategory: { slug: string; name: string; category: { slug: string; name: string } | null };
  price: Money;
  priceMax: Money | null;
  wasPrice: Money | null;
  hasVariants: boolean;
  variantCount: number;
  discount: { percent: number; endsAt: string } | null;
  totalStock: number;
  inStock: boolean;
  isNew: boolean;
  isFeatured: boolean;
  rating: { average: number; count: number };
  orderCount: number;
}

export interface ProductDetail extends ProductCard {
  descriptionHtml: string;
  manufacturerPartNumber: string | null;
  specSheet: { url: string; filename: string; byteSize: number } | null;
  images: (MediaDto & { altText: string | null })[];
  attributes: { name: string; unit: string | null }[];
  variants: VariantDto[];
  publishedAt: string | null;
}

export interface CategoryDto {
  slug: string;
  name: string;
  skuCode: string;
  description: string | null;
  image: MediaDto | null;
  productCount: number;
  subcategories: { slug: string; name: string; skuCode: string; productCount: number }[];
}

export interface CartLine {
  sku: string;
  productSlug: string;
  name: string;
  image: { sm: string; md: string; lg: string } | null;
  attributes: { name: string; value: string }[];
  unitPrice: Money;
  listPrice: Money | null;
  quantity: number;
  available: number;
  lineTotal: Money;
  unavailable: boolean;
}

export interface CartDto {
  lines: CartLine[];
  notices: { sku: string; type: string; message: string }[];
  subtotal: Money;
  itemCount: number;
  unitCount: number;
}

export interface ShippingMethodDto {
  slug: string;
  name: string;
  description: string;
  cost: Money;
  requiresShippingAddress: boolean;
  acceptsMobilePayment: boolean;
  isCashOnDelivery: boolean;
  freeOver: Money | null;
  estimatedDays: { min: number; max: number } | null;
}

export interface OrderDto {
  orderNumber: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  paymentStatus: string;
  fulfilmentStatus: string;
  customer: { name: string; email: string | null; phone: string; isGuest: boolean };
  items: {
    name: string;
    slug: string | null;
    sku: string;
    attributes: { name: string; value: string }[];
    image: string | null;
    unitPrice: Money;
    quantity: number;
    lineTotal: Money;
  }[];
  shipping: {
    methodName: string;
    cost: Money;
    address: null | {
      receiverName: string;
      email: string | null;
      phone: string;
      country: string;
      region: string;
      district: string;
      streetAddress: string;
      postalCode: string | null;
    };
  };
  payment: {
    method: string | null;
    number: string | null;
    delegatedPayerEmail: string | null;
    paid: Money;
    outstanding: Money;
    records: {
      id: number;
      method: string;
      provider: string | null;
      amount: Money;
      status: string;
      payerPhone: string | null;
      reference: string | null;
      verifiedAt: string | null;
      createdAt: string;
    }[];
  };
  totals: { subtotal: Money; discount: Money; shipping: Money; tax: Money; total: Money };
  timeline: { type: string; from: string | null; to: string | null; actorType: string; message: string | null; at: string }[];
  nextStates: string[];
  customerNote: string | null;
  internalNote?: string | null;
  cancelReason: string | null;
  reservationExpiresAt: string | null;
  placedAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  confirmationToken?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  accountType: 'customer' | 'staff';
  status: string;
  marketingOptIn: boolean;
  profileImage: { sm: string; md: string; lg: string } | null;
  roles: string[];
  permissions: string[];
}

export interface SettingsDto {
  store: Record<string, string>;
  contact: Record<string, string | number>;
  social: Record<string, string>;
  payment: Record<string, string>;
  currency: { code: string; fractionDigits: number };
  policies: { returnsWindowDays: number; invoiceTerms: string };
  features: Record<string, boolean>;
  pageImages: Record<string, string>;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  [k: string]: unknown;
}

export interface Paged<T> {
  data: T[];
  meta: PageMeta;
}
