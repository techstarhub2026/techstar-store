import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth, useUi } from '../stores';
import { Button, Checkbox, Modal, TextInput } from './ui';

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
