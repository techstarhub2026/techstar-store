import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth, useUi } from '../stores';
import { Button, Checkbox, Modal, TextInput } from './ui';

/** Google's four-colour "G", as their branding guidelines require. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Hands the browser to the API's Google route, which redirects on to Google
 * and back. A plain link rather than a fetch: the whole point is to leave the
 * page, and the session comes back as a cookie the SPA reads on reload.
 */
function GoogleButton({ nextRoute }: { nextRoute?: string | null }) {
  const href = `/api/v1/auth/google${nextRoute ? `?next=${encodeURIComponent(nextRoute)}` : ''}`;
  return (
    <>
      <div className="d-flex align-items-center gap-2 my-3">
        <span style={{ flex: 1, height: 1, background: 'var(--ts-border)' }} />
        <span className="ts-muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>or</span>
        <span style={{ flex: 1, height: 1, background: 'var(--ts-border)' }} />
      </div>
      <a
        href={href}
        className="ts-btn ts-btn--ghost w-100 d-inline-flex align-items-center justify-content-center gap-2"
        style={{ textTransform: 'none', letterSpacing: 0, border: '1px solid var(--ts-border)' }}
      >
        <GoogleMark />
        Continue with Google
      </a>
    </>
  );
}

export function AuthModal() {
  const mode = useUi((s) => s.authOpen);
  const nextRoute = useUi((s) => s.nextRoute);
  const close = useUi((s) => s.closeAuth);
  const openAuth = useUi((s) => s.openAuth);
  const toast = useUi((s) => s.toast);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    identifier: '',
    password: '',
    username: '',
    email: '',
    phone: '',
    confirm: '',
    terms: false,
    marketing: false,
  });

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const reset = () => {
    setErrors({});
    setMessage(null);
  };

  const handleError = (e: unknown) => {
    if (e instanceof ApiError) {
      setErrors(e.fieldErrors());
      setMessage(e.details?.length ? null : e.message);
    } else {
      setMessage('Something went wrong. Please try again.');
    }
  };

  const finish = () => {
    close();
    setForm({ identifier: '', password: '', username: '', email: '', phone: '', confirm: '', terms: false, marketing: false });
    reset();
    if (nextRoute) navigate(nextRoute);
  };

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      const user = await login(form.identifier.trim(), form.password);
      toast({ tone: 'success', title: `Welcome back, ${user.username.split(' ')[0]}` });
      finish();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const doRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    if (form.password !== form.confirm) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    try {
      const user = await register({
        username: form.username.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        password: form.password,
        acceptedTerms: form.terms,
        marketingOptIn: form.marketing,
      });
      toast({ tone: 'success', title: `Welcome to TechStar, ${user.username.split(' ')[0]}` });
      finish();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const doForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      const res = await api.post<{ message: string }>('/auth/password/forgot', {
        email: form.email.trim(),
      });
      setMessage(res.message);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'register' ? 'Register' : mode === 'forgot' ? 'Forgot password' : 'Login';

  return (
    <Modal open={Boolean(mode)} onClose={close} title={title}>
      {message ? (
        <div
          className="mb-3"
          style={{
            background: 'var(--ts-primary-tint)', border: '1px solid var(--ts-primary-pale)',
            borderRadius: 6, padding: 10, fontSize: 13.5,
          }}
          role="status"
        >
          {message}
        </div>
      ) : null}

      {mode === 'login' ? (
        <form onSubmit={doLogin} noValidate>
          <TextInput
            label="Email or phone"
            value={form.identifier}
            onChange={(e) => set('identifier', e.target.value)}
            error={errors.identifier}
            autoComplete="username"
            required
          />
          <TextInput
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            error={errors.password}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="ts-btn ts-btn--ghost ts-btn--sm px-0 mb-3"
            style={{ textTransform: 'none', letterSpacing: 0 }}
            onClick={() => { reset(); openAuth('forgot'); }}
          >
            Forgot password?
          </button>
          <Button type="submit" block loading={busy}>Login</Button>
          <GoogleButton nextRoute={nextRoute} />
          <div className="text-center mt-3" style={{ fontSize: 13.5 }}>
            Don’t have an account?{' '}
            <button
              type="button"
              style={{ border: 0, background: 'transparent', color: 'var(--ts-primary)', fontWeight: 600, padding: 0 }}
              onClick={() => { reset(); openAuth('register', nextRoute ?? undefined); }}
            >
              Create your account here
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'register' ? (
        <form onSubmit={doRegister} noValidate>
          <TextInput
            label="Username"
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
            error={errors.username}
            autoComplete="name"
            required
          />
          <TextInput
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
            autoComplete="email"
          />
          <TextInput
            label="Phone"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={errors.phone}
            placeholder="255XXXXXXXXX"
            inputMode="numeric"
            hint="Enter an email address, a phone number, or both."
          />
          <TextInput
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            error={errors.password}
            autoComplete="new-password"
            hint="At least 10 characters."
            required
          />
          <TextInput
            label="Confirm password"
            type="password"
            value={form.confirm}
            onChange={(e) => set('confirm', e.target.value)}
            error={errors.confirm}
            autoComplete="new-password"
            required
          />
          <Checkbox
            label={
              <>
                I agree to the <a href="/terms-and-conditions" target="_blank">Terms &amp; Conditions</a> and{' '}
                <a href="/privacy-policy" target="_blank">Privacy Policy</a>
              </>
            }
            checked={form.terms}
            onChange={(e) => set('terms', e.target.checked)}
          />
          {errors.acceptedTerms ? (
            <div className="ts-error mb-2">{errors.acceptedTerms}</div>
          ) : null}
          <Checkbox
            label="Send me occasional offers and product news"
            checked={form.marketing}
            onChange={(e) => set('marketing', e.target.checked)}
          />
          <Button type="submit" block loading={busy}>Register</Button>
          <GoogleButton nextRoute={nextRoute} />
          <div className="text-center mt-3" style={{ fontSize: 13.5 }}>
            Already have an account?{' '}
            <button
              type="button"
              style={{ border: 0, background: 'transparent', color: 'var(--ts-primary)', fontWeight: 600, padding: 0 }}
              onClick={() => { reset(); openAuth('login', nextRoute ?? undefined); }}
            >
              Sign in
            </button>
          </div>
        </form>
      ) : null}

      {mode === 'forgot' ? (
        <form onSubmit={doForgot} noValidate>
          <TextInput
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
            required
          />
          <Button type="submit" block loading={busy}>Send reset link</Button>
          <div className="text-center mt-3">
            <button
              type="button"
              style={{ border: 0, background: 'transparent', color: 'var(--ts-primary)', fontWeight: 600, fontSize: 13.5 }}
              onClick={() => { reset(); openAuth('login'); }}
            >
              Back to sign in
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
