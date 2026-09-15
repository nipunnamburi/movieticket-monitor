import React, { useState } from 'react';
import { Film, Mail, Lock, User, ArrowRight, Sparkles, CheckCircle2, AlertCircle, Check, X } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: { id: string; email: string; name?: string }, token: string) => void;
  onContinueAsGuest?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, onContinueAsGuest }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Real-time password requirement checks
  const hasMinLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>_~`\-+=/]/.test(password);
  const isPasswordValid = hasMinLength && hasNumber && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    if (isSignUp && !isPasswordValid) {
      const missing: string[] = [];
      if (!hasMinLength) missing.push('at least 8 characters');
      if (!hasNumber) missing.push('at least 1 number');
      if (!hasSpecial) missing.push('at least 1 special character');
      setErrorMessage(`Password requirement not met: must have ${missing.join(', ')}.`);
      return;
    }

    setLoading(true);

    try {
      const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/login';
      const payload: any = { email, password };
      if (isSignUp && name.trim()) {
        payload.name = name.trim();
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || (isSignUp ? 'Registration failed' : 'Invalid email or password'));
      }

      setSuccessMessage(isSignUp ? 'Account created successfully! Logging you in...' : 'Logged in successfully!');
      
      setTimeout(() => {
        onLoginSuccess(data.user, data.token);
      }, 400);
    } catch (err: any) {
      setErrorMessage(err.message || 'Something went wrong. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'radial-gradient(ellipse at 50% 10%, rgba(229, 9, 20, 0.18) 0%, rgba(10, 10, 15, 0.95) 75%), var(--bg-base)',
      }}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '36px 32px',
          borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 40px rgba(229, 9, 20, 0.12)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Glow Accent */}
        <div
          style={{
            position: 'absolute',
            top: '-80px',
            right: '-80px',
            width: '160px',
            height: '160px',
            background: 'radial-gradient(circle, rgba(229, 9, 20, 0.3) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              margin: '0 auto 16px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #e50914 0%, #880000 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(229, 9, 20, 0.4)',
            }}
          >
            <Film color="#fff" size={28} />
          </div>
          <h1
            style={{
              fontSize: '1.65rem',
              fontWeight: 800,
              letterSpacing: '-0.5px',
              color: '#ffffff',
              marginBottom: '6px',
            }}
          >
            BookMyShow <span style={{ color: 'var(--bms-red)' }}>Monitor</span>
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            {isSignUp ? 'Create your account with automated direct email alerts' : 'Sign in to monitor movie ticket openings & alerts'}
          </p>
        </div>

        {/* Mode Switcher Tabs */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255, 255, 255, 0.05)',
            padding: '4px',
            borderRadius: '12px',
            marginBottom: '24px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setIsSignUp(false);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: !isSignUp ? 'var(--bms-red)' : 'transparent',
              color: !isSignUp ? '#ffffff' : 'var(--text-secondary)',
              boxShadow: !isSignUp ? '0 2px 10px rgba(229, 9, 20, 0.4)' : 'none',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(true);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: isSignUp ? 'var(--bms-red)' : 'transparent',
              color: isSignUp ? '#ffffff' : 'var(--text-secondary)',
              boxShadow: isSignUp ? '0 2px 10px rgba(229, 9, 20, 0.4)' : 'none',
            }}
          >
            Create Account
          </button>
        </div>

        {/* Error / Success Feedback */}
        {errorMessage && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 14px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '10px',
              color: '#f87171',
              fontSize: '0.84rem',
              marginBottom: '20px',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 14px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              borderRadius: '10px',
              color: '#34d399',
              fontSize: '0.84rem',
              marginBottom: '20px',
            }}
          >
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {isSignUp && (
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Your Name <span style={{ color: 'var(--text-muted)' }}>(Optional)</span>
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 42px',
                    borderRadius: '10px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(229, 9, 20, 0.6)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
                />
              </div>
            </div>
          )}

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}
            >
              Email Address <span style={{ color: 'var(--accent-cyan)', fontSize: '0.76rem' }}>(Alerts sent here)</span>
            </label>
            <div style={{ position: 'relative' }}>
              <Mail
                size={16}
                style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 42px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'rgba(229, 9, 20, 0.6)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
              />
            </div>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '6px',
              }}
            >
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="password"
                required
                placeholder={isSignUp ? 'Min 8 chars, 1 number, 1 special char' : 'Your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 42px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'rgba(229, 9, 20, 0.6)')}
                onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
              />
            </div>

            {/* Real-time Password Policy Checklist for Sign Up */}
            {isSignUp && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  fontSize: '0.76rem',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '2px' }}>
                  Password Requirements:
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: hasMinLength ? '#34d399' : 'var(--text-muted)' }}>
                  {hasMinLength ? <Check size={13} /> : <X size={13} />}
                  <span>At least 8 characters ({password.length}/8)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: hasNumber ? '#34d399' : 'var(--text-muted)' }}>
                  {hasNumber ? <Check size={13} /> : <X size={13} />}
                  <span>At least 1 number (0-9)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: hasSpecial ? '#34d399' : 'var(--text-muted)' }}>
                  {hasSpecial ? <Check size={13} /> : <X size={13} />}
                  <span>At least 1 special character (!@#$%^&*...)</span>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || (isSignUp && !isPasswordValid)}
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '13px',
              marginTop: '8px',
              fontSize: '0.95rem',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: (loading || (isSignUp && !isPasswordValid)) ? 'not-allowed' : 'pointer',
              opacity: (loading || (isSignUp && !isPasswordValid)) ? 0.65 : 1,
            }}
          >
            {loading ? (
              <span>{isSignUp ? 'Creating Account...' : 'Signing In...'}</span>
            ) : (
              <>
                <span>{isSignUp ? 'Create Free Account' : 'Sign In'}</span>
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>

        {/* Quick test credentials or Guest option */}
        {onContinueAsGuest && (
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <div
              style={{
                position: 'relative',
                textAlign: 'center',
                margin: '18px 0 14px',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 0,
                  right: 0,
                  height: '1px',
                  background: 'var(--border-subtle)',
                }}
              />
              <span
                style={{
                  position: 'relative',
                  background: 'var(--bg-card)',
                  padding: '0 12px',
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                }}
              >
                OR
              </span>
            </div>

            <button
              type="button"
              onClick={onContinueAsGuest}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                transition: 'color 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              <Sparkles size={14} color="var(--accent-amber)" />
              <span>Continue with Private Device Vault (Guest)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
