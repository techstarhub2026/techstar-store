import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy, Printer, ShoppingCart, Trash2 } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import type { OrderDto, ShippingMethodDto } from '../lib/types';
import { useAuth, useCart, useUi } from '../stores';
import { useSettings } from '../components/Layout';
import {
  Button, Checkbox, EmptyState, QuantityStepper, RichText, Select, TextInput,
} from '../components/ui';
import { PLACEHOLDER } from '../components/ProductCard';

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// ═══════════════════════════════════════════════════════ cart page ══

export function CartPage() {
  const { cart, setQuantity, remove, load } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Your cart — TechStar Store';
    void load();
  }, [load]);

  if (!cart.lines.length) {
    return (
      <div className="container py-5">
        <EmptyState
          icon={<ShoppingCart size={48} />}
          title="Your cart is empty"
          description="Browse the catalogue and add the parts you need."
          action={<Link to="/products" className="ts-btn ts-btn--primary">Browse products</Link>}
        />
      </div>
    );
  }

  return (
    <div className="container py-4 pb-5">
      <h1 style={{ fontSize: 26, marginBottom: 20 }}>Your cart</h1>
      <div className="row g-4">
        <div className="col-12 col-lg-8">
          <div className="ts-table__wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Unit price</th>
                  <th>Quantity</th>
                  <th>Total</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {cart.lines.map((l) => (
                  <tr key={l.sku}>
                    <td>
                      <div className="d-flex gap-3 align-items-center">
                        <img src={l.image?.sm ?? PLACEHOLDER} alt="" width={52} height={52}
                          style={{ objectFit: 'contain', background: 'var(--ts-surface-sunken)', borderRadius: 4 }} />
                        <div>
                          <Link to={`/product/${l.productSlug}`} style={{ color: 'inherit', fontWeight: 600 }}>
                            {l.name}
                          </Link>
                          {l.attributes.length ? (
                            <div className="ts-muted" style={{ fontSize: 12 }}>
                              {l.attributes.map((a) => `${a.name}: ${a.value}`).join(' · ')}
                            </div>
                          ) : null}
                          <div className="ts-mono ts-muted" style={{ fontSize: 11 }}>{l.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td>{l.unitPrice.formatted}</td>
                    <td>
                      <QuantityStepper
                        value={l.quantity}
                        max={Math.max(1, l.available)}
                        onChange={(n) => void setQuantity(l.sku, n)}
                      />
                    </td>
                    <td style={{ fontWeight: 600 }}>{l.lineTotal.formatted}</td>
                    <td>
                      <button className="ts-iconbtn" aria-label={`Remove ${l.name}`} onClick={() => void remove(l.sku)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <Link to="/products" className="ts-btn ts-btn--ghost">Continue shopping</Link>
          </div>
        </div>

        <div className="col-12 col-lg-4">
          <div className="ts-panel">
            <h2 style={{ fontSize: 16, marginBottom: 14 }}>Order summary</h2>
            <div className="d-flex justify-content-between mb-2">
              <span>Sub total</span><strong>{cart.subtotal.formatted}</strong>
            </div>
            <div className="ts-muted mb-3" style={{ fontSize: 12.5 }}>
              Shipping is calculated at checkout.
            </div>
            <Button block onClick={() => navigate('/checkout')}>Proceed to checkout</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════ payment panel ══

export function PaymentInstructions({ amount, reference }: { amount: string; reference: string }) {
  const { data: settings } = useSettings();
  const [lang, setLang] = useState<'sw' | 'en'>('sw');
  const toast = useUi((s) => s.toast);

  const html = lang === 'sw'
    ? (settings?.payment.instructionsSw ?? '')
    : (settings?.payment.instructionsEn ?? '');

  return (
    <div className="ts-card p-4">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div className="ts-label">Pay exactly</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ts-primary)' }}>
            {amount}
            <button
              className="ts-iconbtn"
              aria-label="Copy amount"
              onClick={() => {
                void navigator.clipboard?.writeText(amount.replace(/[^0-9]/g, ''));
                toast({ tone: 'success', title: 'Amount copied' });
              }}
            >
              <Copy size={14} />
            </button>
          </div>
          <div className="ts-muted" style={{ fontSize: 13 }}>
            Quote reference <span className="ts-mono">{reference}</span>
          </div>
        </div>
        <div className="btn-group" role="group" aria-label="Language">
          <Button size="sm" variant={lang === 'sw' ? 'primary' : 'ghost'} onClick={() => setLang('sw')}>Kiswahili</Button>
          <Button size="sm" variant={lang === 'en' ? 'primary' : 'ghost'} onClick={() => setLang('en')}>English</Button>
        </div>
      </div>

      <div className="row g-3">
        {[
          ['M-Pesa (Vodacom)', settings?.payment.tillMpesa],
          ['Mixx by Yas (Tigo Pesa)', settings?.payment.tillMixx],
          ['Airtel Money', settings?.payment.tillAirtel],
        ].map(([name, till]) => (
          <div className="col-12 col-md-4" key={name as string}>
            <div style={{ border: '1px solid var(--ts-border)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
              <div className="ts-muted" style={{ fontSize: 12 }}>Lipa namba</div>
              <div className="ts-mono" style={{ fontSize: 18, fontWeight: 700 }}>{till || '—'}</div>
            </div>
          </div>
        ))}
      </div>

      {html ? <div className="mt-3" style={{ fontSize: 13.5 }}><RichText html={html} /></div> : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════ checkout ══

export function CheckoutPage() {
  const { cart, load } = useCart();
  const { user } = useAuth();
  const openAuth = useUi((s) => s.openAuth);
  const toast = useUi((s) => s.toast);
  const navigate = useNavigate();

  const [idempotencyKey] = useState(uuid);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [showDelegate, setShowDelegate] = useState(false);

  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    shippingMethodSlug: '',
    receiverName: '', addrEmail: '', addrPhone: '',
    region: '', district: '', streetAddress: '', postalCode: '',
    paymentMethod: '' as '' | 'lipa_namba' | 'cash',
    paymentNumber: '',
    delegatedPayerEmail: '',
    customerNote: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: methods = [] } = useQuery({
    queryKey: ['shipping-methods'],
    queryFn: () => api.get<ShippingMethodDto[]>('/shipping-methods'),
  });
  const { data: regions = [] } = useQuery({
    queryKey: ['regions'],
    queryFn: () => api.get<string[]>('/locations/regions'),
  });
  const { data: districts = [] } = useQuery({
    queryKey: ['districts', form.region],
    queryFn: () => api.get<string[]>(`/locations/regions/${encodeURIComponent(form.region)}/districts`),
    enabled: Boolean(form.region),
  });

  useEffect(() => {
    document.title = 'Checkout — TechStar Store';
    void load();
  }, [load]);

  // Prefill from the profile, never overwriting anything already typed.
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: f.name || user.username,
      phone: f.phone || user.phone || '',
      email: f.email || user.email || '',
    }));
    void (async () => {
      try {
        const addresses = await api.get<any[]>('/me/addresses');
        const a = addresses.find((x) => x.isDefault) ?? addresses[0];
        if (!a) return;
        setForm((f) => ({
          ...f,
          receiverName: f.receiverName || a.receiverName,
          addrEmail: f.addrEmail || a.email || '',
          addrPhone: f.addrPhone || a.phone,
          region: f.region || a.region,
          district: f.district || a.district,
          streetAddress: f.streetAddress || a.streetAddress,
          postalCode: f.postalCode || a.postalCode || '',
        }));
      } catch { /* optional */ }
    })();
  }, [user]);

  const method = useMemo(
    () => methods.find((m) => m.slug === form.shippingMethodSlug),
    [methods, form.shippingMethodSlug],
  );

  const shippingCost = method
    ? method.freeOver && cart.subtotal.amount >= method.freeOver.amount
      ? 0
      : method.cost.amount
    : 0;
  const total = cart.subtotal.amount + shippingCost;
  const fmt = (n: number) => `TZS ${n.toLocaleString('en-US')}`;

  if (!cart.lines.length) {
    return (
      <div className="container py-5">
        <EmptyState
          icon={<ShoppingCart size={48} />}
          title="Your cart is empty"
          description="Add something to your cart before checking out."
          action={<Link to="/products" className="ts-btn ts-btn--primary">Browse products</Link>}
        />
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setBanner(null);
    setBusy(true);
    try {
      const order = await api.post<OrderDto & { confirmationToken: string }>('/orders', {
        customer: { name: form.name, phone: form.phone, email: form.email || undefined },
        shippingMethodSlug: form.shippingMethodSlug,
        shippingAddress: method?.requiresShippingAddress
          ? {
              receiverName: form.receiverName || form.name,
              email: form.addrEmail || form.email || undefined,
              phone: form.addrPhone || form.phone,
              country: 'Tanzania',
              region: form.region,
              district: form.district,
              streetAddress: form.streetAddress,
              postalCode: form.postalCode || undefined,
            }
          : undefined,
        paymentMethod: method?.isCashOnDelivery ? 'cash' : form.paymentMethod || undefined,
        paymentNumber: form.paymentNumber || undefined,
        delegatedPayerEmail: form.delegatedPayerEmail || undefined,
        customerNote: form.customerNote || undefined,
        idempotencyKey,
      });

      sessionStorage.setItem(`order:${order.orderNumber}`, order.confirmationToken ?? '');
      await load();
      navigate(`/order/confirmation/${order.orderNumber}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields: Record<string, string> = {};
        for (const d of err.details ?? []) {
          const key = (d.field ?? '').split('.').pop() ?? '';
          if (key) fields[key] = d.message;
        }
        setErrors(fields);
        setBanner(
          err.code === 'PRICE_CHANGED' || err.code === 'INSUFFICIENT_STOCK'
            ? `${err.message} ${(err.details ?? []).map((d) => d.message).join(' ')}`
            : err.details?.length
              ? `${err.details.length} field${err.details.length === 1 ? '' : 's'} need attention.`
              : err.message,
        );
        if (err.code === 'PRICE_CHANGED' || err.code === 'INSUFFICIENT_STOCK') await load();
      } else {
        setBanner('We could not reach the server. Your cart is safe — please try again.');
      }
      toast({ tone: 'danger', title: 'Order not placed', text: 'Please review the details below.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-4 pb-5">
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>Getting your order</h1>

      {!user ? (
        <div className="mb-4" style={{ fontSize: 14 }}>
          <div>
            Returning customer?{' '}
            <button style={{ border: 0, background: 'transparent', color: 'var(--ts-primary)', fontWeight: 600, padding: 0 }}
              onClick={() => openAuth('login', '/checkout')}>Click here to log in</button>
          </div>
          <div>
            Don’t have a TechStar account?{' '}
            <button style={{ border: 0, background: 'transparent', color: 'var(--ts-primary)', fontWeight: 600, padding: 0 }}
              onClick={() => openAuth('register', '/checkout')}>Click here to create an account</button>
          </div>
        </div>
      ) : null}

      {banner ? (
        <div className="mb-4 d-flex gap-2" role="alert"
          style={{ background: '#fdf3f2', border: '1px solid #f2c9c4', borderRadius: 6, padding: 12, fontSize: 14 }}>
          <AlertCircle size={18} style={{ color: 'var(--ts-danger)', flexShrink: 0 }} />
          <span>{banner}</span>
        </div>
      ) : null}

      <form onSubmit={submit} noValidate>
        <div className="row g-4">
          <div className="col-12 col-lg-8">
            {/* 1 client details */}
            <section className="ts-card p-4 mb-4">
              <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                Client details
              </h2>
              <div className="row">
                <div className="col-12 col-md-6">
                  <TextInput label="Username" value={form.name} error={errors.name}
                    onChange={(e) => set('name', e.target.value)} autoComplete="name" required />
                </div>
                <div className="col-12 col-md-6">
                  <TextInput label="Phone" value={form.phone} error={errors.phone}
                    onChange={(e) => set('phone', e.target.value)} placeholder="255XXXXXXXXX"
                    inputMode="numeric" autoComplete="tel" required />
                </div>
                <div className="col-12">
                  <TextInput label="Email (optional)" type="email" value={form.email} error={errors.email}
                    onChange={(e) => set('email', e.target.value)} autoComplete="email"
                    hint="We send your receipt and order updates here." />
                </div>
              </div>
            </section>

            {/* 2 shipping method */}
            <section className="ts-card p-4 mb-4">
              <div className="d-flex justify-content-between mb-3">
                <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
                  Shipping method
                </h2>
                <span className="ts-label" style={{ margin: 0 }}>Estimated cost</span>
              </div>
              {methods.map((m) => (
                <label key={m.slug} className="d-flex gap-3 py-3"
                  style={{ borderTop: '1px solid var(--ts-border)', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="shipping"
                    checked={form.shippingMethodSlug === m.slug}
                    onChange={() => set('shippingMethodSlug', m.slug)}
                    style={{ marginTop: 4 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{m.name}</div>
                    <div className="ts-muted" style={{ fontSize: 12.5 }}>{m.description}</div>
                    {m.estimatedDays ? (
                      <div className="ts-muted" style={{ fontSize: 12 }}>
                        {m.estimatedDays.min}–{m.estimatedDays.max} working days
                      </div>
                    ) : null}
                  </div>
                  <div style={{ fontWeight: 700 }}>
                    {m.freeOver && cart.subtotal.amount >= m.freeOver.amount ? 'FREE' : m.cost.formatted}
                  </div>
                </label>
              ))}
              {errors.shippingMethodSlug ? (
                <div className="ts-error mt-2">{errors.shippingMethodSlug}</div>
              ) : null}
            </section>

            {/* 3 shipping details */}
            {method?.requiresShippingAddress ? (
              <section className="ts-card p-4 mb-4">
                <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                  Shipping details
                </h2>
                <div className="row">
                  <div className="col-12 col-md-6">
                    <TextInput label="Receiver's name" value={form.receiverName} error={errors.receiverName}
                      onChange={(e) => set('receiverName', e.target.value)} required />
                  </div>
                  <div className="col-12 col-md-6">
                    <TextInput label="Phone" value={form.addrPhone} error={errors.addrPhone}
                      onChange={(e) => set('addrPhone', e.target.value)} placeholder="255XXXXXXXXX" required />
                  </div>
                  <div className="col-12 col-md-6">
                    <TextInput label="Email" type="email" value={form.addrEmail}
                      onChange={(e) => set('addrEmail', e.target.value)} />
                  </div>
                  <div className="col-12 col-md-6">
                    <TextInput label="Country" value="Tanzania" disabled />
                  </div>
                  <div className="col-12 col-md-6">
                    <Select label="Region" value={form.region} error={errors.region}
                      onChange={(e) => { set('region', e.target.value); set('district', ''); }} required>
                      <option value="">Select one</option>
                      {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </div>
                  <div className="col-12 col-md-6">
                    <Select label="District" value={form.district} error={errors.district}
                      onChange={(e) => set('district', e.target.value)}
                      disabled={!form.region} required>
                      <option value="">{form.region ? 'Select one' : 'Choose a region first'}</option>
                      {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </Select>
                  </div>
                  <div className="col-12 col-md-8">
                    <TextInput label="Street address" value={form.streetAddress} error={errors.streetAddress}
                      onChange={(e) => set('streetAddress', e.target.value)} required />
                  </div>
                  <div className="col-12 col-md-4">
                    <TextInput label="Postal code (optional)" value={form.postalCode}
                      onChange={(e) => set('postalCode', e.target.value)} />
                  </div>
                </div>
              </section>
            ) : null}

            {/* 4 payment */}
            {method && !method.isCashOnDelivery && method.acceptsMobilePayment ? (
              <section className="ts-card p-4 mb-4">
                <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                  Payment method
                </h2>
                {(['lipa_namba', 'cash'] as const).map((pm) => (
                  <label key={pm} className="d-flex gap-3 align-items-center py-2" style={{ cursor: 'pointer' }}>
                    <input type="radio" name="pm" checked={form.paymentMethod === pm}
                      onChange={() => set('paymentMethod', pm)} />
                    <span style={{ fontWeight: 600 }}>{pm === 'lipa_namba' ? 'Lipa Namba (mobile money)' : 'Cash'}</span>
                  </label>
                ))}
                {errors.paymentMethod ? <div className="ts-error">{errors.paymentMethod}</div> : null}

                {form.paymentMethod === 'lipa_namba' ? (
                  <div className="mt-3">
                    <TextInput
                      label="Payment number"
                      value={form.paymentNumber}
                      error={errors.paymentNumber}
                      onChange={(e) => set('paymentNumber', e.target.value)}
                      placeholder="255XXXXXXXXX"
                      inputMode="numeric"
                      hint="The mobile money number you will pay from."
                      required
                    />
                    <PaymentInstructions amount={fmt(total)} reference="(your order number)" />
                  </div>
                ) : null}
              </section>
            ) : method?.isCashOnDelivery ? (
              <div className="ts-panel mb-4" style={{ fontSize: 14 }}>
                You will pay the courier in cash when your package arrives. We will call to confirm
                before dispatch.
              </div>
            ) : null}

            {/* 5 delegated payer */}
            <section className="ts-card p-4 mb-4">
              <button
                type="button"
                className="d-flex justify-content-between align-items-center w-100"
                style={{ border: 0, background: 'transparent', fontSize: 14, fontWeight: 600 }}
                onClick={() => setShowDelegate((v) => !v)}
                aria-expanded={showDelegate}
              >
                Someone else is paying for this order
                <span>{showDelegate ? '−' : '+'}</span>
              </button>
              {showDelegate ? (
                <div className="mt-3">
                  <TextInput
                    label="Payer's email address"
                    type="email"
                    value={form.delegatedPayerEmail}
                    error={errors.delegatedPayerEmail}
                    onChange={(e) => set('delegatedPayerEmail', e.target.value)}
                    hint="We email them a secure payment link. Your order is held until they pay. They never see your address or phone number."
                  />
                </div>
              ) : null}
            </section>
          </div>

          {/* summary */}
          <div className="col-12 col-lg-4">
            <div className="ts-panel" style={{ position: 'sticky', top: 170 }}>
              <h2 style={{ fontSize: 15, marginBottom: 14 }} className="d-flex align-items-center gap-2">
                <ShoppingCart size={16} /> Your order
              </h2>
              <Button type="submit" block loading={busy} className="mb-3">Place order</Button>

              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {cart.lines.map((l) => (
                  <div key={l.sku} className="d-flex gap-2 py-2" style={{ borderBottom: '1px solid var(--ts-border)' }}>
                    <img src={l.image?.sm ?? PLACEHOLDER} alt="" width={40} height={40}
                      style={{ objectFit: 'contain', background: '#fff', borderRadius: 4 }} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                      <div className="ts-clamp-2" style={{ fontWeight: 600 }}>{l.name}</div>
                      <div className="ts-muted">Quantity: {l.quantity}</div>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{l.lineTotal.formatted}</div>
                  </div>
                ))}
              </div>

              <div className="d-flex justify-content-between mt-3" style={{ fontSize: 14 }}>
                <span>Sub total:</span><span>{cart.subtotal.formatted}</span>
              </div>
              <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
                <span>Shipping cost:</span><span>{method ? fmt(shippingCost) : '—'}</span>
              </div>
              <hr />
              <div className="d-flex justify-content-between" style={{ fontSize: 18, fontWeight: 700 }}>
                <span>Total</span><span>{fmt(total)}</span>
              </div>
              <div className="text-center mt-3">
                <Link to="/cart" style={{ fontSize: 13 }}>Edit cart</Link>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════ order confirmation ══

export function OrderConfirmationPage() {
  const { orderNumber = '' } = useParams();
  const token = sessionStorage.getItem(`order:${orderNumber}`) ?? '';

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderNumber],
    queryFn: () => api.get<OrderDto>(`/orders/${orderNumber}`, { 'X-Confirmation-Token': token }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    document.title = `Order ${orderNumber} — TechStar Store`;
  }, [orderNumber]);

  if (isLoading || !order) {
    return <div className="container py-5"><div className="ts-skel" style={{ height: 300 }} /></div>;
  }

  const paid = order.paymentStatus === 'paid';

  return (
    <div className="container py-4 pb-5">
      <div className="ts-card p-4 mb-4 text-center">
        <CheckCircle2 size={48} style={{ color: 'var(--ts-success)' }} />
        <h1 style={{ fontSize: 24, margin: '10px 0 4px' }}>Order placed</h1>
        <div className="ts-mono" style={{ fontSize: 18 }}>{order.orderNumber}</div>
        {order.customer.email ? (
          <p className="ts-muted mt-2 mb-0">We have emailed a copy to {order.customer.email}</p>
        ) : null}
        {paid ? <div className="mt-3"><span className="ts-badge ts-badge--success">Payment confirmed</span></div> : null}
      </div>

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <div className="ts-card p-4 mb-4">
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>What happens next</h2>
            <ol style={{ fontSize: 14, paddingLeft: 18 }}>
              {order.payment.method === 'cash' ? (
                <>
                  <li>We call you to confirm your order.</li>
                  <li>We pack your items.</li>
                  <li>You pay the courier in cash on delivery.</li>
                </>
              ) : order.payment.delegatedPayerEmail ? (
                <>
                  <li>We have emailed a payment link to {order.payment.delegatedPayerEmail}.</li>
                  <li>Your order is held until they pay.</li>
                  <li>We confirm and ship once payment arrives.</li>
                </>
              ) : (
                <>
                  <li>Pay {order.totals.total.formatted} to our Lipa Namba till using the details below.</li>
                  <li>We confirm your payment, usually within one business hour.</li>
                  <li>We pack and ship your order, and you receive an SMS.</li>
                </>
              )}
            </ol>
          </div>

          {!paid && order.payment.method === 'lipa_namba' ? (
            <PaymentInstructions amount={order.totals.total.formatted} reference={order.orderNumber} />
          ) : null}
        </div>

        <div className="col-12 col-lg-5">
          <div className="ts-panel">
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>Order summary</h2>
            {order.items.map((i) => (
              <div key={i.sku} className="d-flex gap-2 py-2" style={{ borderBottom: '1px solid var(--ts-border)' }}>
                <img src={i.image ?? PLACEHOLDER} alt="" width={40} height={40}
                  style={{ objectFit: 'contain', background: '#fff', borderRadius: 4 }} />
                <div style={{ flex: 1, fontSize: 12.5 }}>
                  <div className="ts-clamp-2" style={{ fontWeight: 600 }}>{i.name}</div>
                  <div className="ts-muted">Quantity: {i.quantity}</div>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{i.lineTotal.formatted}</div>
              </div>
            ))}
            <div className="d-flex justify-content-between mt-3" style={{ fontSize: 14 }}>
              <span>Sub total:</span><span>{order.totals.subtotal.formatted}</span>
            </div>
            <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
              <span>Shipping cost:</span><span>{order.totals.shipping.formatted}</span>
            </div>
            <hr />
            <div className="d-flex justify-content-between" style={{ fontSize: 17, fontWeight: 700 }}>
              <span>Total</span><span>{order.totals.total.formatted}</span>
            </div>

            {order.shipping.address ? (
              <div className="mt-3" style={{ fontSize: 13 }}>
                <div className="ts-label">Delivering to</div>
                <div>{order.shipping.address.receiverName}</div>
                <div>{order.shipping.address.streetAddress}</div>
                <div>{order.shipping.address.district}, {order.shipping.address.region}</div>
                <div className="ts-muted mt-1">{order.shipping.methodName}</div>
              </div>
            ) : (
              <div className="mt-3 ts-muted" style={{ fontSize: 13 }}>{order.shipping.methodName}</div>
            )}

            <div className="d-flex gap-2 mt-3 flex-wrap no-print">
              <Link to="/account/orders" className="ts-btn ts-btn--secondary ts-btn--sm">View orders</Link>
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                <Printer size={14} /> Print
              </Button>
              <Link to="/products" className="ts-btn ts-btn--ghost ts-btn--sm">Continue shopping</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════ delegated payment ══

export function DelegatedPaymentPage() {
  const { token = '' } = useParams();
  const toast = useUi((s) => s.toast);
  const [method, setMethod] = useState<'lipa_namba' | 'cash'>('lipa_namba');
  const [number, setNumber] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['pay', token],
    queryFn: () => api.get(`/pay/${token}`),
    retry: false,
  });

  useEffect(() => {
    document.title = 'Payment request — TechStar Store';
  }, []);

  if (isLoading) return <div className="container py-5"><div className="ts-skel" style={{ height: 260 }} /></div>;

  if (isError) {
    return (
      <div className="container py-5">
        <EmptyState
          title={(loadError as ApiError)?.message ?? 'This payment link is no longer valid.'}
          description="If you believe this is a mistake, please contact TechStar Store."
          action={<Link to="/contact" className="ts-btn ts-btn--primary">Contact us</Link>}
        />
      </div>
    );
  }

  if (done) {
    return (
      <div className="container py-5">
        <div className="ts-card p-5 text-center">
          <CheckCircle2 size={48} style={{ color: 'var(--ts-success)' }} />
          <h1 style={{ fontSize: 22, marginTop: 12 }}>Thank you</h1>
          <p className="ts-muted">
            Your payment details have been recorded. TechStar Store will verify the payment and
            notify both of you.
          </p>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await api.post(`/pay/${token}`, { paymentMethod: method, paymentNumber: number || undefined });
      setDone(true);
    } catch (err) {
      const msg = err instanceof ApiError
        ? (err.details?.[0]?.message ?? err.message)
        : 'Something went wrong.';
      setError(msg);
      toast({ tone: 'danger', title: 'Payment not recorded', text: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-4 pb-5" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24 }}>Payment request</h1>
      <p className="ts-muted">
        <strong>{data.requestedBy}</strong> has asked you to pay for this order.
      </p>

      <div className="ts-card p-4 mb-4">
        {data.items.map((i: any, idx: number) => (
          <div key={idx} className="d-flex justify-content-between py-2"
            style={{ borderBottom: '1px solid var(--ts-border)', fontSize: 14 }}>
            <span>{i.name} <span className="ts-muted">· Quantity: {i.quantity}</span></span>
            <span style={{ fontWeight: 600 }}>{i.lineTotal.formatted}</span>
          </div>
        ))}
        <div className="d-flex justify-content-between mt-3" style={{ fontSize: 14 }}>
          <span>Sub total:</span><span>{data.totals.subtotal.formatted}</span>
        </div>
        <div className="d-flex justify-content-between" style={{ fontSize: 14 }}>
          <span>Shipping cost:</span><span>{data.totals.shipping.formatted}</span>
        </div>
        <hr />
        <div className="d-flex justify-content-between" style={{ fontSize: 18, fontWeight: 700 }}>
          <span>Total</span><span>{data.totals.total.formatted}</span>
        </div>
      </div>

      <form onSubmit={submit} className="ts-card p-4">
        <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payment methods</h2>
        {(['lipa_namba', 'cash'] as const).map((pm) => (
          <label key={pm} className="d-flex gap-3 align-items-center py-2" style={{ cursor: 'pointer' }}>
            <input type="radio" name="pm" checked={method === pm} onChange={() => setMethod(pm)} />
            <span style={{ fontWeight: 600 }}>{pm === 'lipa_namba' ? 'Lipa Namba (mobile money)' : 'Cash'}</span>
          </label>
        ))}

        {method === 'lipa_namba' ? (
          <div className="mt-3">
            <TextInput
              label="Payment number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="255XXXXXXXXX"
              inputMode="numeric"
              error={error}
              hint="The mobile money number you will pay from."
              required
            />
            <PaymentInstructions amount={data.totals.total.formatted} reference={data.orderNumber} />
          </div>
        ) : null}

        <Button type="submit" block loading={busy} className="mt-3">Make payment</Button>
      </form>
    </div>
  );
}
