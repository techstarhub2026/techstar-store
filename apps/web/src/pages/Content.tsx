import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Mail, MapPin, MessageCircle, Newspaper, Phone } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useSettings } from '../components/Layout';
import { Button, EmptyState, RichText, TextArea, TextInput } from '../components/ui';
import { useAuth, useUi } from '../stores';
import { PLACEHOLDER } from '../components/ProductCard';

function PageHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ background: 'var(--ts-primary-dark)', color: '#fff', padding: '40px 0' }}>
      <div className="container text-center">
        <h1 style={{ fontSize: 30, margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{title}</h1>
        {subtitle ? <p className="mt-2 mb-0" style={{ opacity: 0.85 }}>{subtitle}</p> : null}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════ about ══

export function AboutPage() {
  const { data: settings } = useSettings();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { document.title = 'About us — TechStar Store'; }, []);

  const lat = Number(settings?.contact.latitude ?? -6.7924);
  const lng = Number(settings?.contact.longitude ?? 39.2083);

  return (
    <>
      <PageHero title="About us" subtitle="Build. Learn. Innovate." />
      <div className="container py-5">
        <div className="row g-5">
          <div className="col-12 col-lg-7">
            <h2 style={{ fontSize: 22 }}>Our story</h2>
            <p>
              TechStar Store exists because finding the right component in Tanzania has been harder
              than it should be. A student in Dodoma with a coursework deadline, a technician in
              Mwanza restocking a workshop, and an engineer in Dar es Salaam prototyping a product
              all need the same thing: an honest catalogue, accurate stock, and delivery that
              actually arrives.
            </p>
            <p>
              We stock two adjacent worlds. On one side, STEM — kits, robots, drones, starter
              bundles and teaching aids for schools, clubs and anyone learning. On the other,
              electronics — components, modules, development boards, instruments, tools and
              consumables for people who already know exactly what they want.
            </p>
            {expanded ? (
              <>
                <p>
                  Everything is priced in shillings, paid for with mobile money or cash on
                  delivery, and shipped to every mainland region. There are no surprises at
                  checkout and no minimum order — if you need one resistor, buy one resistor.
                </p>
                <p>
                  We also help beyond the shelf: PCB design and printing, prototype debugging and
                  sourcing parts we do not normally carry. If you cannot find something, ask us.
                </p>
              </>
            ) : null}
            <Button variant="ghost" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Read less' : 'Read more'}
            </Button>
          </div>

          <div className="col-12 col-lg-5">
            <div className="ts-card p-4 mb-3">
              <h3 style={{ fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Vision</h3>
              <p className="mb-0" style={{ fontSize: 14 }}>
                To be the most trusted supplier of electronic components and STEM equipment in
                Tanzania, and a partner to everyone building with them.
              </p>
            </div>
            <div className="ts-card p-4">
              <h3 style={{ fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mission</h3>
              <p className="mb-0" style={{ fontSize: 14 }}>
                To make quality parts, tools and knowledge available and affordable, so that ideas
                built here can be finished here.
              </p>
            </div>
          </div>
        </div>

        <h2 style={{ fontSize: 22, marginTop: 48 }}>Core values</h2>
        <div className="row g-3 mt-1">
          {[
            ['Integrity', 'What the page says is what arrives in the box.'],
            ['Commitment', 'We answer, we follow up, and we finish what we start.'],
            ['Open-mindedness', 'Every question is a fair question, whatever your level.'],
            ['Quality', 'We would rather lose a sale than sell a part we do not trust.'],
          ].map(([name, text]) => (
            <div className="col-12 col-md-6 col-lg-3" key={name}>
              <div className="ts-card p-3 h-100">
                <div style={{ fontWeight: 700, color: 'var(--ts-primary)' }}>{name}</div>
                <div style={{ fontSize: 13.5 }} className="ts-muted">{text}</div>
              </div>
            </div>
          ))}
        </div>

        <h2 id="map" style={{ fontSize: 22, marginTop: 48, scrollMarginTop: 170 }}>Find us</h2>
        <p className="ts-muted">{settings?.contact.address}</p>
        <div className="ts-card" style={{ overflow: 'hidden' }}>
          <iframe
            title="TechStar Store location"
            width="100%"
            height="380"
            style={{ border: 0, display: 'block' }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.03}%2C${lat - 0.03}%2C${lng + 0.03}%2C${lat + 0.03}&layer=mapnik&marker=${lat}%2C${lng}`}
          />
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════ contact ══

export function ContactPage() {
  const { data: settings } = useSettings();
  const toast = useUi((s) => s.toast);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', sendCopy: false, website: '' });

  useEffect(() => { document.title = 'Contact us — TechStar Store'; }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    try {
      await api.post('/contact-messages', form);
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      toast({ tone: 'danger', title: 'Failed to send message' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHero title="Contact us" />
      <div className="container py-5">
        <div className="row g-5">
          <div className="col-12 col-lg-7 order-lg-1 order-2">
            <h2 style={{ fontSize: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Get in touch with us
            </h2>
            {sent ? (
              <div className="ts-card p-4 mt-3">
                <h3 style={{ fontSize: 17 }}>Thank you for getting in touch with TechStar Store</h3>
                <p className="ts-muted">We usually reply within one business day.</p>
                <Button variant="secondary" onClick={() => { setSent(false); setForm({ name: '', email: '', subject: '', message: '', sendCopy: false, website: '' }); }}>
                  Submit another message
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-3" noValidate>
                <input
                  type="text"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  style={{ position: 'absolute', left: -9999 }}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                />
                <div className="row">
                  <div className="col-12 col-md-6">
                    <TextInput label="Your name" value={form.name} error={errors.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div className="col-12 col-md-6">
                    <TextInput label="Email" type="email" value={form.email} error={errors.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </div>
                </div>
                <TextInput label="Subject (optional)" value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })} />
                <TextArea label="Message" value={form.message} error={errors.message} rows={6}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  hint={`${form.message.length}/3000`} required />
                <label className="d-flex gap-2 align-items-center mb-3" style={{ fontSize: 14 }}>
                  <input type="checkbox" checked={form.sendCopy}
                    onChange={(e) => setForm({ ...form, sendCopy: e.target.checked })} />
                  Send me a copy of this message
                </label>
                <Button type="submit" loading={busy}>Send message</Button>
              </form>
            )}
          </div>

          <div className="col-12 col-lg-5 order-lg-2 order-1">
            <div className="ts-card p-4">
              <h2 style={{ fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Contact details</h2>
              <div className="d-flex gap-2 align-items-start mt-3" style={{ fontSize: 14 }}>
                <MapPin size={16} style={{ color: 'var(--ts-primary)', marginTop: 3 }} />
                <div>{settings?.contact.address}<br />{settings?.store.poBox}</div>
              </div>
              <div className="d-flex gap-2 align-items-center mt-3" style={{ fontSize: 14 }}>
                <Mail size={16} style={{ color: 'var(--ts-primary)' }} />
                <a href={`mailto:${settings?.contact.email}`}>{settings?.contact.email}</a>
              </div>
              <div className="d-flex gap-2 align-items-center mt-2" style={{ fontSize: 14 }}>
                <Phone size={16} style={{ color: 'var(--ts-primary)' }} />
                <a href={`tel:${settings?.contact.phonePrimary}`}>{settings?.contact.phonePrimary}</a>
              </div>
              {settings?.contact.whatsapp ? (
                <div className="d-flex gap-2 align-items-center mt-2" style={{ fontSize: 14 }}>
                  <MessageCircle size={16} style={{ color: 'var(--ts-primary)' }} />
                  <a href={`https://wa.me/${settings.contact.whatsapp}`} target="_blank" rel="noopener noreferrer">
                    Chat on WhatsApp
                  </a>
                </div>
              ) : null}
              <div className="ts-muted mt-3" style={{ fontSize: 13 }}>{settings?.contact.openingHours}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════ FAQ ══

export function FaqPage() {
  const { data = [] } = useQuery({
    queryKey: ['faqs'],
    queryFn: () => api.get<{ group: string; items: { question: string; answerHtml: string }[] }[]>('/faqs'),
  });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { document.title = 'Frequently asked questions — TechStar Store'; }, []);

  return (
    <>
      <PageHero title="Frequently asked questions" />
      <div className="container py-5" style={{ maxWidth: 860 }}>
        {data.map((g) => (
          <section key={g.group} className="mb-4">
            <h2 style={{ fontSize: 18, color: 'var(--ts-primary-dark)' }}>{g.group}</h2>
            {g.items.map((f) => {
              const id = `${g.group}-${f.question}`;
              const isOpen = open === id;
              return (
                <div key={id} className="ts-card mb-2">
                  <button
                    className="d-flex justify-content-between align-items-center w-100 p-3"
                    style={{ border: 0, background: 'transparent', fontSize: 14.5, fontWeight: 600, textAlign: 'left' }}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : id)}
                  >
                    {f.question}
                    <ChevronDown size={18} style={{ transform: isOpen ? 'rotate(180deg)' : undefined, flexShrink: 0 }} />
                  </button>
                  {isOpen ? (
                    <div className="px-3 pb-3" style={{ fontSize: 14 }}>
                      <RichText html={f.answerHtml} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}

        <div className="ts-panel text-center mt-4">
          <h3 style={{ fontSize: 17 }}>Can’t find your answer?</h3>
          <div className="d-flex gap-2 justify-content-center flex-wrap mt-2">
            <Link to="/contact" className="ts-btn ts-btn--primary">Contact us</Link>
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════ legal ══

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const title = kind === 'privacy' ? 'Privacy policy' : 'Terms & conditions';
  const { data: settings } = useSettings();

  useEffect(() => { document.title = `${title} — TechStar Store`; }, [title]);

  return (
    <>
      <PageHero title={title} />
      <div className="container py-5" style={{ maxWidth: 860 }}>
        <div className="ts-panel mb-4" style={{ fontSize: 13.5 }}>
          <strong>Draft for review.</strong> This page carries placeholder wording. Before launch it
          must be drafted or reviewed for {settings?.store.legalName ?? 'TechStar Store'} against
          Tanzanian consumer and data-protection law.
        </div>

        {kind === 'privacy' ? (
          <div className="ts-rich">
            <h2>What we collect</h2>
            <p>We collect only what an order needs: your name, phone number and, where the shipping method requires one, a delivery address. We do not collect a date of birth, gender or national identifier.</p>
            <h2>How we use it</h2>
            <p>To process and deliver your order, to contact you about it, and — only if you have opted in — to send occasional offers.</p>
            <h2>Marketing consent</h2>
            <p>Marketing consent is off by default. You can withdraw it at any time from your account, or by using the unsubscribe link in any message we send.</p>
            <h2>Retention</h2>
            <p>Orders and invoices are retained for statutory record-keeping. Guest carts are removed after 30 days. Search logs are retained for 24 months.</p>
            <h2>Your rights</h2>
            <p>You may request a copy of your personal data or ask us to close your account. Closing an account anonymises your profile; orders are retained with the details recorded at the time of purchase.</p>
            <h2>Contact</h2>
            <p>Questions about this policy: {settings?.contact.email}</p>
          </div>
        ) : (
          <div className="ts-rich">
            <h2>Ordering</h2>
            <p>An order is an offer to buy. We confirm it once payment is received or, for cash on delivery, once we have spoken to you.</p>
            <h2>Pricing</h2>
            <p>All prices are in Tanzanian shillings and include any applicable taxes unless stated otherwise. The price charged is the price shown when the order was placed.</p>
            <h2>Payment</h2>
            <p>Goods are shipped upon confirmation of full payment. All payments must be made through the designated payment methods of {settings?.store.legalName ?? 'TechStar Store'}.</p>
            <h2>Shipping and handling</h2>
            <p>Shipping costs are shown at checkout and depend on the method chosen. Upcountry delivery typically takes two to five working days.</p>
            <h2>Returns</h2>
            <p>Faulty items may be returned within {settings?.policies.returnsWindowDays ?? 7} days of delivery. Components sold in opened anti-static packaging cannot be returned unless faulty, because they cannot be resold.</p>
            <h2>Reservations</h2>
            <p>Unpaid orders reserve stock for 48 hours. After that the reservation is released and the order expires; you can reorder in one click.</p>
            <h2>Liability</h2>
            <p>Components are supplied for use by people competent to use them. Mains-voltage and battery products in particular must be handled according to the manufacturer’s guidance.</p>
          </div>
        )}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════ blog ══

export function BlogIndexPage() {
  const { data } = useQuery({
    queryKey: ['articles'],
    queryFn: () => api.raw<{ data: any[]; meta: any }>('/articles?pageSize=9'),
  });

  useEffect(() => { document.title = 'Blog — TechStar Store'; }, []);

  return (
    <div className="container py-4 pb-5">
      <h1 style={{ fontSize: 26, marginBottom: 20 }}>Blog</h1>
      {!data?.data.length ? (
        <EmptyState icon={<Newspaper size={48} />} title="No articles yet"
          description="We are writing. Check back soon." />
      ) : (
        <div className="row g-4">
          {data.data.map((a) => (
            <div className="col-12 col-md-6 col-lg-4" key={a.slug}>
              <article className="ts-card h-100" style={{ overflow: 'hidden' }}>
                <Link to={`/blog/${a.slug}`}>
                  <img src={a.coverImage?.md ?? PLACEHOLDER} alt=""
                    style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} />
                </Link>
                <div className="p-3">
                  <Link to={`/blog/${a.slug}`} className="ts-clamp-2"
                    style={{ color: 'inherit', fontWeight: 700, fontSize: 16 }}>
                    {a.title}
                  </Link>
                  <div className="ts-muted" style={{ fontSize: 12.5 }}>
                    {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ''} · {a.author}
                  </div>
                  <p className="ts-clamp-3 mt-2 mb-2" style={{ fontSize: 14 }}>{a.excerpt}</p>
                  <Link to={`/blog/${a.slug}`} style={{ fontSize: 13.5, fontWeight: 600 }}>Read more →</Link>
                </div>
              </article>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArticlePage() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const openAuth = useUi((s) => s.openAuth);
  const toast = useUi((s) => s.toast);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: article, isLoading, isError } = useQuery({
    queryKey: ['article', slug],
    queryFn: () => api.get(`/articles/${slug}`),
  });

  useEffect(() => {
    if (article) document.title = `${article.title} — TechStar Store`;
  }, [article]);

  if (isError) {
    return <div className="container py-5"><EmptyState title="Article not found"
      action={<Link to="/blog" className="ts-btn ts-btn--primary">Back to blog</Link>} /></div>;
  }
  if (isLoading || !article) return <div className="container py-5"><div className="ts-skel" style={{ height: 300 }} /></div>;

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/articles/${slug}/comments`, { body });
      setBody('');
      toast({ tone: 'success', title: 'Thank you for your comment — it will appear once approved.' });
    } catch {
      toast({ tone: 'danger', title: 'Could not post your comment' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-4 pb-5">
      <div className="row g-5">
        <div className="col-12 col-lg-8">
          <img src={article.coverImage?.lg ?? PLACEHOLDER} alt=""
            style={{ width: '100%', borderRadius: 'var(--radius-md)', maxHeight: 380, objectFit: 'cover' }} />
          <h1 style={{ fontSize: 28, marginTop: 20 }}>{article.title}</h1>
          <div className="ts-muted" style={{ fontSize: 13.5 }}>
            {article.author} · {article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : ''}
          </div>
          <div className="mt-4" style={{ maxWidth: '72ch' }}>
            <RichText html={article.contentHtml} />
          </div>

          <hr className="my-5" />
          <h2 style={{ fontSize: 18 }}>Comments ({article.comments.length})</h2>
          {article.comments.map((c: any) => (
            <div key={c.id} className="py-3" style={{ borderBottom: '1px solid var(--ts-border)' }}>
              <strong style={{ fontSize: 14 }}>{c.author}</strong>
              <span className="ts-muted" style={{ fontSize: 12 }}> · {new Date(c.createdAt).toLocaleDateString()}</span>
              <p className="mb-0 mt-1" style={{ fontSize: 14 }}>{c.body}</p>
            </div>
          ))}

          {user ? (
            <form onSubmit={postComment} className="mt-4">
              <TextArea label="Add a comment" value={body} placeholder="Write something here"
                onChange={(e) => setBody(e.target.value)} required />
              <Button type="submit" loading={busy}>Post comment</Button>
            </form>
          ) : (
            <div className="ts-panel mt-4 d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span>Please create an account or log in to comment.</span>
              <Button size="sm" onClick={() => openAuth('login')}>Sign in</Button>
            </div>
          )}
        </div>

        <aside className="col-12 col-lg-4">
          <h2 style={{ fontSize: 16 }}>Latest articles</h2>
          {article.latest.map((l: any) => (
            <Link key={l.slug} to={`/blog/${l.slug}`} className="d-flex gap-3 py-3"
              style={{ borderBottom: '1px solid var(--ts-border)', color: 'inherit' }}>
              <img src={l.coverImage?.sm ?? PLACEHOLDER} alt="" width={56} height={56}
                style={{ objectFit: 'cover', borderRadius: 4 }} />
              <div>
                <div className="ts-clamp-2" style={{ fontSize: 13.5, fontWeight: 600 }}>{l.title}</div>
                <div className="ts-muted" style={{ fontSize: 12 }}>
                  {l.publishedAt ? new Date(l.publishedAt).toLocaleDateString() : ''}
                </div>
              </div>
            </Link>
          ))}
        </aside>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════ services ══

export function ServicesPage() {
  const { data = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<any[]>('/services'),
  });

  useEffect(() => { document.title = 'Services — TechStar Store'; }, []);

  return (
    <div className="container py-4 pb-5">
      <h1 style={{ fontSize: 26, marginBottom: 20 }}>Services</h1>
      {!data.length ? <EmptyState title="No services listed yet" /> : (
        <div className="row g-4">
          {data.map((s) => (
            <div className="col-12 col-md-6" key={s.slug}>
              <div className="ts-card h-100" style={{ overflow: 'hidden' }}>
                <img src={s.image?.md ?? PLACEHOLDER} alt=""
                  style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', background: 'var(--ts-surface-sunken)' }} />
                <div className="p-4">
                  <h2 style={{ fontSize: 18 }}>{s.heading}</h2>
                  <p style={{ fontSize: 14 }} className="ts-muted">{s.excerpt}</p>
                  <Link to={`/services/${s.slug}`} className="ts-btn ts-btn--secondary ts-btn--sm">Learn more</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ServicePage() {
  const { slug = '' } = useParams();
  const { data: service, isLoading, isError } = useQuery({
    queryKey: ['service', slug],
    queryFn: () => api.get(`/services/${slug}`),
  });

  useEffect(() => {
    if (service) document.title = `${service.heading} — TechStar Store`;
  }, [service]);

  if (isError) {
    return <div className="container py-5"><EmptyState title="Service not found"
      action={<Link to="/services" className="ts-btn ts-btn--primary">All services</Link>} /></div>;
  }
  if (isLoading || !service) return <div className="container py-5"><div className="ts-skel" style={{ height: 280 }} /></div>;

  return (
    <div className="container py-4 pb-5">
      <div className="row g-5">
        <div className="col-12 col-lg-8">
          <img src={service.image?.lg ?? PLACEHOLDER} alt=""
            style={{ width: '100%', borderRadius: 'var(--radius-md)', maxHeight: 360, objectFit: 'cover' }} />
          <h1 style={{ fontSize: 26, marginTop: 20 }}>{service.heading}</h1>
          <div className="mt-3"><RichText html={service.contentHtml} /></div>

          <div className="ts-panel text-center mt-5">
            <h2 style={{ fontSize: 18, color: 'var(--ts-primary-dark)' }}>Ask for this service</h2>
            <p className="ts-muted">Tell us what you need and we will come back with a quote.</p>
            <Link to={`/contact?subject=${encodeURIComponent(service.heading)}`} className="ts-btn ts-btn--primary">
              Contact us
            </Link>
          </div>
        </div>
        <aside className="col-12 col-lg-4">
          <h2 style={{ fontSize: 16 }}>Other services</h2>
          {service.others.map((o: any) => (
            <Link key={o.slug} to={`/services/${o.slug}`} className="d-flex gap-3 py-3"
              style={{ borderBottom: '1px solid var(--ts-border)', color: 'inherit' }}>
              <img src={o.image?.sm ?? PLACEHOLDER} alt="" width={56} height={56}
                style={{ objectFit: 'cover', borderRadius: 4 }} />
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{o.heading}</div>
            </Link>
          ))}
        </aside>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════ 404 ══

export function NotFoundPage() {
  useEffect(() => { document.title = 'Page not found — TechStar Store'; }, []);
  return (
    <div className="container py-5 text-center">
      <div style={{ fontSize: 72, fontWeight: 800, color: 'var(--ts-primary)' }}>404</div>
      <h1 style={{ fontSize: 26 }}>Oops! Page not found</h1>
      <p className="ts-muted">The page you’re looking for doesn’t exist.</p>
      <div className="d-flex gap-2 justify-content-center mt-3">
        <Link to="/" className="ts-btn ts-btn--primary">Go home</Link>
        <Link to="/products" className="ts-btn ts-btn--secondary">Browse products</Link>
      </div>
    </div>
  );
}
