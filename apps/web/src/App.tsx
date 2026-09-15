import React, { useState, useEffect } from 'react';
import {
  Film,
  Radio,
  Bell,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Send,
  Plus,
  Clock,
  MapPin,
  ExternalLink,
  ShieldCheck,
  Zap,
  History,
  X,
  Sparkles,
  Check,
  Settings,
  Mail,
  MessageSquare,
  AlertTriangle,
  LogOut,
  User as UserIcon,
  Heart,
  Home,
} from 'lucide-react';
import { LiveEventPayload } from '@bms/shared';
import { LoginPage } from './LoginPage';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

const PRESET_THEATRES = [
  'Asian Lakshmikala Cinepride: Moosapet',
  'Miraj Cinemas: Cine Town, Miyapur',
  'Mallikarjuna 70mm A/C DTS: Kukatpally',
  'Bhramaramba 70MM A/C 4K Dolby: Kukatpally',
  'Cinepolis: Lulu Mall, Hyderabad',
  'Prasads Multiplex: Hyderabad',
  'AMB Cinemas: Gachibowli',
  'PVR: Forum Sujana Mall',
];

interface Monitor {
  id: string;
  name: string;
  url: string;
  city: string;
  language?: string;
  status: 'active' | 'paused' | 'error';
  checkIntervalSec: number;
  lastChecked?: string | null;
  lastError?: string | null;
  filterTheatres: string[];
  filterDates: string[];
  filterTimeFrom?: string | null;
  filterTimeTo?: string | null;
  emailTo?: string | null;
  whatsappPhone?: string | null;
  alerts: Array<{
    id: string;
    openings: any;
    channels: string[];
    createdAt: string;
  }>;
}

async function safeJson<T = any>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function getStoredVaultKey(): string {
  let key = localStorage.getItem('bms_vault_key');
  if (!key) {
    key = `vlt_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem('bms_vault_key', key);
  }
  return key;
}

export default function App() {
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('bms_auth_token'));
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem('bms_auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isGuest, setIsGuest] = useState<boolean>(() => localStorage.getItem('bms_is_guest') === 'true');

  const [vaultKey, setVaultKey] = useState<string>(getStoredVaultKey);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [syncInputKey, setSyncInputKey] = useState('');
  const [vaultCopied, setVaultCopied] = useState(false);

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<LiveEventPayload[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMonitorForHistory, setSelectedMonitorForHistory] = useState<Monitor | null>(null);
  const [theatreSuggestions, setTheatreSuggestions] = useState<string[]>(PRESET_THEATRES);

  // Authenticated/Vault-Scoped Fetch Helper
  const apiFetch = (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (authToken) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    headers.set('x-vault-key', vaultKey);
    return fetch(url, { ...options, headers });
  };

  const handleLoginSuccess = (user: AuthUser, token: string) => {
    localStorage.setItem('bms_auth_token', token);
    localStorage.setItem('bms_auth_user', JSON.stringify(user));
    localStorage.removeItem('bms_is_guest');
    setAuthToken(token);
    setCurrentUser(user);
    setIsGuest(false);
  };

  const handleLogout = () => {
    if (confirm('Are you sure you want to log out?')) {
      localStorage.removeItem('bms_auth_token');
      localStorage.removeItem('bms_auth_user');
      localStorage.removeItem('bms_is_guest');
      setAuthToken(null);
      setCurrentUser(null);
      setIsGuest(false);
    }
  };

  // Form State
  const [rawPastedText, setRawPastedText] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [cleanPreview, setCleanPreview] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('Hyderabad');
  const [newLanguage, setNewLanguage] = useState('');
  const [newInterval, setNewInterval] = useState(30);
  const [selectedTheatres, setSelectedTheatres] = useState<string[]>([]);
  const [customTheatreInput, setCustomTheatreInput] = useState('');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [customDateInput, setCustomDateInput] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [activeTimePreset, setActiveTimePreset] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [isParsing, setIsParsing] = useState(false);

  // User Preferences: Favourites & Nearest Theatre (persisted in localStorage)
  const [favouriteTheatres, setFavouriteTheatres] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('bms_favourite_theatres');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [nearestTheatre, setNearestTheatre] = useState<string>(() => {
    return localStorage.getItem('bms_nearest_theatre') || '';
  });

  // Movie show range dates
  const [movieFirstDate, setMovieFirstDate] = useState<string>('');
  const [movieLastDate, setMovieLastDate] = useState<string>('');
  const [dateOutOfRangeError, setDateOutOfRangeError] = useState<string | null>(null);

  const toggleFavouriteTheatre = (theatre: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFavouriteTheatres((prev) => {
      const next = prev.includes(theatre) ? prev.filter((t) => t !== theatre) : [...prev, theatre];
      localStorage.setItem('bms_favourite_theatres', JSON.stringify(next));
      return next;
    });
  };

  const handleSetNearestTheatre = (theatre: string) => {
    const next = nearestTheatre === theatre ? '' : theatre;
    setNearestTheatre(next);
    localStorage.setItem('bms_nearest_theatre', next);
  };

  // Notification Test state
  const [testStatus, setTestStatus] = useState<string | null>(null);

  // Notification Settings State
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [notifConfig, setNotifConfig] = useState<{
    emailFrom: string;
    hasAppPassword: boolean;
    defaultEmailTo: string;
    twilioSid: string;
    hasTwilioToken: boolean;
    twilioFrom: string;
    callmebotKey: string;
    hasCallmebotKey: boolean;
    defaultWhatsappTo: string;
    hasTwilio: boolean;
    isEmailConfigured: boolean;
    isWhatsappConfigured: boolean;
  }>({
    emailFrom: '',
    hasAppPassword: false,
    defaultEmailTo: '',
    twilioSid: '',
    hasTwilioToken: false,
    twilioFrom: 'whatsapp:+14155238886',
    callmebotKey: '',
    hasCallmebotKey: false,
    defaultWhatsappTo: '',
    hasTwilio: false,
    isEmailConfigured: false,
    isWhatsappConfigured: false,
  });

  const [cfgEmailFrom, setCfgEmailFrom] = useState('');
  const [cfgEmailAppPassword, setCfgEmailAppPassword] = useState('');
  const [cfgDefaultEmailTo, setCfgDefaultEmailTo] = useState('');
  const [cfgTwilioSid, setCfgTwilioSid] = useState('');
  const [cfgTwilioToken, setCfgTwilioToken] = useState('');
  const [cfgTwilioFrom, setCfgTwilioFrom] = useState('whatsapp:+14155238886');
  const [cfgCallmebotKey, setCfgCallmebotKey] = useState('');
  const [cfgDefaultWhatsappTo, setCfgDefaultWhatsappTo] = useState('');
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Fetch Monitors & Theatres
  const fetchMonitors = async () => {
    try {
      const res = await apiFetch('/api/monitors');
      if (res.ok) {
        const data = await safeJson(res);
        if (data && Array.isArray(data)) setMonitors(data);
      }
    } catch (err) {
      console.error('Error loading monitors:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTheatres = async () => {
    try {
      const res = await apiFetch('/api/theatres');
      if (res.ok) {
        const data = await safeJson(res);
        if (data && Array.isArray(data)) {
          setTheatreSuggestions(Array.from(new Set([...PRESET_THEATRES, ...data])));
        }
      }
    } catch {
      // Use defaults
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await apiFetch('/api/settings/notifications');
      if (res.ok) {
        const data = await safeJson(res);
        if (data) {
          setNotifConfig(data);
          setCfgEmailFrom(data.emailFrom || '');
          setCfgDefaultEmailTo(data.defaultEmailTo || '');
          setCfgTwilioSid(data.twilioSid || '');
          setCfgTwilioFrom(data.twilioFrom || 'whatsapp:+14155238886');
          setCfgCallmebotKey(data.callmebotKey || '');
          setCfgDefaultWhatsappTo(data.defaultWhatsappTo || '');
        }
      }
    } catch (err) {
      console.error('Failed to load notification settings:', err);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsStatus('Saving credentials...');
    try {
      const res = await apiFetch('/api/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailFrom: cfgEmailFrom,
          emailAppPassword: cfgEmailAppPassword || undefined,
          defaultEmailTo: cfgDefaultEmailTo,
          twilioSid: cfgTwilioSid,
          twilioToken: cfgTwilioToken || undefined,
          twilioFrom: cfgTwilioFrom,
          callmebotKey: cfgCallmebotKey,
          defaultWhatsappTo: cfgDefaultWhatsappTo,
        }),
      });
      const data = await safeJson(res);
      if (res.ok) {
        setSettingsStatus('✅ Settings saved successfully!');
        setCfgEmailAppPassword('');
        setCfgTwilioToken('');
        await fetchSettings();
        setTimeout(() => setSettingsStatus(null), 3500);
      } else {
        setSettingsStatus(`❌ ${data?.message || `Failed to save settings (HTTP ${res.status})`}`);
      }
    } catch (err: any) {
      setSettingsStatus(`❌ ${err.message}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  useEffect(() => {
    if (!authToken && !isGuest) return;

    fetchMonitors();
    fetchTheatres();
    fetchSettings();

    const sseToken = authToken ? `Bearer ${authToken}` : vaultKey;
    const eventSource = new EventSource(`/api/events?token=${encodeURIComponent(sseToken)}`);
    eventSource.onopen = () => setIsConnected(true);
    eventSource.onerror = () => setIsConnected(false);

    eventSource.onmessage = (e) => {
      try {
        const payload: LiveEventPayload = JSON.parse(e.data);
        setLiveEvents((prev) => [payload, ...prev.slice(0, 49)]);

        if (payload.type === 'CHECK_COMPLETED' || payload.type === 'TICKET_DROP') {
          fetchMonitors();
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    return () => eventSource.close();
  }, [vaultKey]);

  // BMS URL Clean & Extraction feature
  const handleExtractUrl = async (textToClean?: string) => {
    const text = textToClean || rawPastedText;
    if (!text.trim()) return;

    setIsParsing(true);
    try {
      const res = await apiFetch('/api/clean-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await safeJson(res);
        if (data) {
          setNewUrl(data.url);
          setCleanPreview(data.url);
          if (!newName) setNewName(data.name);
          if (data.city) setNewCity(data.city);
          if (data.language) setNewLanguage(data.language);
          if (data.date && !selectedDates.includes(data.date)) {
            setSelectedDates((prev) => Array.from(new Set([...prev, data.date])));
          }

          // Compute first and last showing dates from URL or default window (today to +7 days)
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const dd = String(today.getDate()).padStart(2, '0');
          const todayStr = `${yyyy}-${mm}-${dd}`;

          const maxD = new Date(today);
          maxD.setDate(maxD.getDate() + 14);
          const maxY = maxD.getFullYear();
          const maxM = String(maxD.getMonth() + 1).padStart(2, '0');
          const maxDay = String(maxD.getDate()).padStart(2, '0');
          const maxStr = `${maxY}-${maxM}-${maxDay}`;

          const firstD = data.date || todayStr;
          const lastD = data.date && data.date > maxStr ? data.date : maxStr;
          setMovieFirstDate(firstD);
          setMovieLastDate(lastD);
        }
      }
    } catch (err) {
      console.warn('URL extraction failed:', err);
    } finally {
      setIsParsing(false);
    }
  };

  const handlePastedTextInput = (val: string) => {
    setRawPastedText(val);
    if (val.includes('bookmyshow.com')) {
      handleExtractUrl(val);
    }
  };

  const toggleTheatrePreset = (theatre: string) => {
    setSelectedTheatres((prev) =>
      prev.includes(theatre) ? prev.filter((t) => t !== theatre) : [...prev, theatre]
    );
  };

  const addCustomTheatre = (theatreToAdd?: string) => {
    const val = (theatreToAdd || customTheatreInput).trim();
    if (!val) return;
    if (!selectedTheatres.includes(val)) {
      setSelectedTheatres((prev) => [...prev, val]);
    }
    if (!theatreToAdd) setCustomTheatreInput('');
  };

  const applyTimePreset = (from: string, to: string, label: string) => {
    if (activeTimePreset === label) {
      setTimeFrom('');
      setTimeTo('');
      setActiveTimePreset(null);
    } else {
      setTimeFrom(from);
      setTimeTo(to);
      setActiveTimePreset(label);
    }
  };

  const handleAddDate = () => {
    if (!customDateInput) return;
    setDateOutOfRangeError(null);

    // Validate if movieFirstDate and movieLastDate are set
    if (movieFirstDate && customDateInput < movieFirstDate) {
      setDateOutOfRangeError(`⚠️ Cannot add ${customDateInput}: Movie is not showing before ${movieFirstDate}`);
      return;
    }
    if (movieLastDate && customDateInput > movieLastDate) {
      setDateOutOfRangeError(`⚠️ Cannot add ${customDateInput}: Movie run finishes by ${movieLastDate}. Showtimes are not available after this date.`);
      return;
    }

    if (!selectedDates.includes(customDateInput)) {
      setSelectedDates((prev) => [...prev, customDateInput]);
      setCustomDateInput('');
    }
  };

  const handleCreateMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    setDateOutOfRangeError(null);
    if (!newUrl) {
      alert('Please provide or extract a valid BookMyShow URL.');
      return;
    }

    // Check that all selectedDates fall within [movieFirstDate, movieLastDate]
    if (movieFirstDate || movieLastDate) {
      const invalid = selectedDates.filter((d) => {
        if (movieFirstDate && d < movieFirstDate) return true;
        if (movieLastDate && d > movieLastDate) return true;
        return false;
      });
      if (invalid.length > 0) {
        setDateOutOfRangeError(`⚠️ Cannot schedule monitor: Dates [${invalid.join(', ')}] are out of movie screening range (${movieFirstDate || 'start'} to ${movieLastDate || 'end'}).`);
        return;
      }
    }

    try {
      const payload = {
        url: newUrl,
        name: newName,
        city: newCity,
        language: newLanguage || undefined,
        checkIntervalSec: Number(newInterval),
        filterTheatres: selectedTheatres,
        filterDates: selectedDates,
        filterTimeFrom: timeFrom || undefined,
        filterTimeTo: timeTo || undefined,
        emailTo: emailTo || undefined,
        whatsappPhone: whatsappPhone || undefined,
      };

      const res = await apiFetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowAddModal(false);
        setRawPastedText('');
        setNewUrl('');
        setCleanPreview(null);
        setNewName('');
        setSelectedTheatres([]);
        setSelectedDates([]);
        setTimeFrom('');
        setTimeTo('');
        setActiveTimePreset(null);
        fetchMonitors();
      }
    } catch (err) {
      console.error('Error creating monitor:', err);
    }
  };

  const handleTrigger = async (id: string) => {
    await apiFetch(`/api/monitors/${id}/trigger`, { method: 'POST' });
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'paused' : 'active';
    await apiFetch(`/api/monitors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    fetchMonitors();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this monitor?')) return;
    await apiFetch(`/api/monitors/${id}`, { method: 'DELETE' });
    fetchMonitors();
  };

  const handleSendTestAlert = async (overrideTarget?: string) => {
    const target = overrideTarget || currentUser?.email || '';
    if (!target) {
      setTestStatus('❌ Please sign in or provide a recipient address');
      setTimeout(() => setTestStatus(null), 4000);
      return;
    }
    setTestStatus('Dispatching live test alert...');
    try {
      const res = await apiFetch('/api/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'EMAIL', target }),
      });
      const data = await safeJson(res);
      if (res.ok) {
        setTestStatus(data?.message || `✅ Sample alert delivered to ${target}!`);
      } else {
        setTestStatus(`❌ ${data?.message || `Failed to send alert (HTTP ${res.status})`}`);
      }
    } catch (err: any) {
      setTestStatus(`❌ Network error: ${err.message}`);
    }
    setTimeout(() => setTestStatus(null), 8000);
  };

  // Check if unauthenticated
  if (!authToken && !isGuest) {
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        onContinueAsGuest={() => {
          localStorage.setItem('bms_is_guest', 'true');
          setIsGuest(true);
        }}
      />
    );
  }

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 20px 80px' }}>
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
          paddingBottom: '20px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #e50914 0%, #880000 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 18px var(--bms-red-glow)',
            }}
          >
            <Film color="#fff" size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
              BookMyShow <span style={{ color: 'var(--bms-red)' }}>Live Monitor</span>
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Real-time ticket radar with BullMQ & instant multi-channel alerts
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div className={`badge ${isConnected ? 'badge-active' : 'badge-alert'}`}>
            <span className="pulse-dot" />
            {isConnected ? 'SSE STREAM ACTIVE' : 'DISCONNECTED'}
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => {
              setShowVaultModal(true);
              setSyncInputKey('');
              setVaultCopied(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              background: 'rgba(16, 185, 129, 0.08)',
              color: '#34d399',
            }}
            title="Private Device Vault — Monitors set on this device are private"
          >
            <ShieldCheck size={16} color="#34d399" />
            <span>Vault: {vaultKey.slice(0, 8)}...</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={() => {
              setShowSettingsModal(true);
              setSettingsStatus(null);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Settings size={16} />
            <span>Settings</span>
            {!notifConfig.isEmailConfigured && (
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#ef4444',
                }}
                title="Email credentials not configured"
              />
            )}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> New Monitor
          </button>

          {/* User Profile / Logout Button */}
          {currentUser ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '4px 6px 4px 12px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.2 }}>
                  {currentUser.name || currentUser.email.split('@')[0]}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.2 }}>
                  {currentUser.email}
                </span>
              </div>
              <button
                className="btn"
                onClick={handleLogout}
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  gap: '4px',
                }}
                title="Log out from BookMyShow Monitor"
              >
                <LogOut size={14} />
                <span>Logout</span>
              </button>
            </div>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={() => {
                localStorage.removeItem('bms_is_guest');
                setIsGuest(false);
              }}
              style={{
                gap: '6px',
                border: '1px solid rgba(229, 9, 20, 0.4)',
                color: 'var(--text-primary)',
              }}
              title="Sign in with an account"
            >
              <UserIcon size={15} color="var(--bms-red)" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Warning Banner if Email is not configured */}
      {!notifConfig.isEmailConfigured && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '12px',
            padding: '12px 18px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle color="#ef4444" size={20} />
            <span style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
              <strong>Alert Deliveries Inactive:</strong> Email credentials are not configured yet. Messages cannot be sent until you add your Gmail Address and 16-character Google App Password in Settings.
            </span>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setShowSettingsModal(true);
              setSettingsStatus(null);
            }}
            style={{ padding: '6px 14px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          >
            ⚙️ Configure Now
          </button>
        </div>
      )}

      {/* Grid Layout: Main Monitor Cards & Real-time Telemetry Sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.1fr', gap: '24px' }}>
        {/* Left Column: Monitors */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Active Radar Trackers ({monitors.length})
            </h2>
            <button className="btn btn-secondary" onClick={fetchMonitors} style={{ padding: '6px 12px' }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {loading ? (
            <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading monitored targets...
            </div>
          ) : monitors.length === 0 ? (
            <div className="glass-card" style={{ padding: '50px 20px', textAlign: 'center' }}>
              <Zap size={36} color="var(--bms-red)" style={{ margin: '0 auto 12px' }} />
              <h3 style={{ fontSize: '1.1rem', marginBottom: '6px' }}>No Active Monitors</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '18px' }}>
                Track a movie or concert on BookMyShow to get alerted the instant bookings open.
              </p>
              <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                <Plus size={16} /> Add First Monitor
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {monitors.map((m) => (
                <div key={m.id} className="glass-card" style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{m.name}</h3>
                        <span className={`badge ${m.status === 'active' ? 'badge-active' : 'badge-alert'}`}>
                          {m.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <MapPin size={14} /> {m.city}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={14} /> Every {m.checkIntervalSec}s
                        </span>
                        {m.lastChecked && (
                          <span>Last checked: {new Date(m.lastChecked).toLocaleTimeString()}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleTrigger(m.id)}
                        title="Trigger Instant Check"
                        style={{ padding: '8px 12px' }}
                      >
                        <RefreshCw size={14} /> Check Now
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setSelectedMonitorForHistory(m)}
                        title="View Alert History"
                        style={{ padding: '8px 10px' }}
                      >
                        <History size={14} />
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleToggleStatus(m.id, m.status)}
                        title={m.status === 'active' ? 'Pause' : 'Resume'}
                        style={{ padding: '8px 10px' }}
                      >
                        {m.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleDelete(m.id)}
                        style={{ padding: '8px 10px', color: '#f87171' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Filter tags */}
                  {(m.filterTheatres.length > 0 || m.filterDates.length > 0) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                      {m.filterTheatres.map((t) => {
                        const isFav = favouriteTheatres.includes(t);
                        const isNearest = nearestTheatre === t;
                        return (
                          <span
                            key={t}
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: isFav ? '1px solid rgba(229, 9, 20, 0.4)' : isNearest ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid var(--border-subtle)',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                            title={isFav && isNearest ? 'Favourite & Nearest Theatre' : isFav ? 'Favourite Theatre' : isNearest ? 'Nearest to Home' : undefined}
                          >
                            {isFav && <Heart size={11} color="#e50914" fill="#e50914" />}
                            {isNearest && <Home size={11} color="#38bdf8" />}
                            <span>🏛️ {t}</span>
                          </span>
                        );
                      })}
                      {m.filterDates.map((d) => (
                        <span
                          key={d}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          📅 {d}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Alert summary / link */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.8rem',
                      paddingTop: '12px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <button
                      onClick={() => setSelectedMonitorForHistory(m)}
                      style={{
                        background: 'none',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--accent-green)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        padding: 0,
                      }}
                    >
                      <Bell size={14} />
                      <span>{m.alerts.length} ticket alerts recorded (View History)</span>
                    </button>
                    {/* Booking Link / Date Window Check */}
                    {(() => {
                      const todayStr = new Date().toISOString().slice(0, 10);
                      const dates = m.filterDates.length > 0 ? [...m.filterDates].sort() : [];
                      const firstDate = dates[0] || '';
                      const lastDate = dates[dates.length - 1] || '';

                      const isBeforeRun = firstDate && todayStr < firstDate;
                      const isAfterRun = lastDate && todayStr > lastDate;

                      if (isBeforeRun) {
                        return (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              background: 'rgba(245, 158, 11, 0.12)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              color: '#fbbf24',
                              fontWeight: 600,
                            }}
                            title={`Screenings start on ${firstDate}. Booking opens when showtimes commence.`}
                          >
                            <span>⏳ Shows Start {firstDate} (Pre-Release)</span>
                          </div>
                        );
                      }

                      if (isAfterRun) {
                        return (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              background: 'rgba(239, 68, 68, 0.12)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              color: '#f87171',
                              fontWeight: 600,
                            }}
                            title={`Screenings ended on ${lastDate}. Bookings are closed.`}
                          >
                            <span>⛔ Show Run Ended ({lastDate})</span>
                          </div>
                        );
                      }

                      return (
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: 'var(--bms-red)',
                            textDecoration: 'none',
                            fontWeight: 600,
                          }}
                        >
                          BMS Show Page <ExternalLink size={12} />
                        </a>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right Column: Live Telemetry Feed & Quick Test */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Live Activity Stream */}
          <div className="glass-card" style={{ padding: '20px', flex: 1, minHeight: '340px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Radio size={16} color="var(--accent-cyan)" /> Live Radar Stream
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{liveEvents.length} events</span>
            </div>

            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                maxHeight: '380px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {liveEvents.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
                  Waiting for check cycles...
                </div>
              ) : (
                liveEvents.map((evt, idx) => (
                  <div
                    key={idx}
                    style={{
                      background:
                        evt.type === 'TICKET_DROP'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : evt.type === 'ERROR'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : 'rgba(255, 255, 255, 0.03)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      borderLeft: `3px solid ${
                        evt.type === 'TICKET_DROP'
                          ? '#10b981'
                          : evt.type === 'ERROR'
                          ? '#ef4444'
                          : '#06b6d4'
                      }`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <strong style={{ color: evt.type === 'TICKET_DROP' ? '#34d399' : '#fff' }}>
                        {evt.monitorName || evt.type}
                      </strong>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>{evt.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Account & Direct Alert Destination Card */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserIcon size={16} color="var(--accent-cyan)" /> Account & Direct Alerts
              </h3>
              <button
                onClick={() => {
                  setShowSettingsModal(true);
                  setSettingsStatus(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.75rem',
                  padding: 0,
                }}
              >
                <Settings size={13} /> Settings
              </button>
            </div>

            {currentUser ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Authenticated Account Email:
                  </div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Mail size={15} /> {currentUser.email}
                  </div>
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  🎯 <strong>Zero manual email input required:</strong> When tickets open up for any tracked movie, real-time alerts are routed directly to <strong>{currentUser.email}</strong>.
                </div>

                <button
                  className="btn btn-secondary"
                  onClick={() => handleSendTestAlert(currentUser.email)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '0.82rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <Send size={14} /> Send Sample Alert to My Email
                </button>

                {testStatus && (
                  <div
                    style={{
                      fontSize: '0.78rem',
                      textAlign: 'center',
                      marginTop: '4px',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: testStatus.startsWith('✅') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: testStatus.startsWith('✅') ? '#34d399' : '#fca5a5',
                      wordBreak: 'break-word',
                    }}
                  >
                    {testStatus}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 6px' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                  Sign in or create an account with your email to have movie ticket alerts automatically dispatched to your inbox.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    localStorage.removeItem('bms_is_guest');
                    setIsGuest(false);
                  }}
                  style={{ width: '100%', padding: '10px' }}
                >
                  <UserIcon size={14} /> Sign In / Create Account
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Add Monitor Modal (Responsive Bottom Sheet on Mobile) */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
        >
          <div
            className="glass-card modal-sheet"
            style={{
              maxWidth: '580px',
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Add Target Monitor</h2>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              Paste any BMS link or WhatsApp/App share message. We will extract and verify the URL instantly.
            </p>

            <form onSubmit={handleCreateMonitor} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* URL / Share Text Area */}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  BookMyShow URL or Mobile Share Text *
                </label>
                <textarea
                  className="input-field"
                  rows={2}
                  placeholder="Paste URL or full share text from BookMyShow mobile app..."
                  value={rawPastedText}
                  onChange={(e) => handlePastedTextInput(e.target.value)}
                />

                {rawPastedText && !cleanPreview && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => handleExtractUrl()}
                    style={{ width: '100%', marginTop: '6px', fontSize: '0.8rem', padding: '6px' }}
                  >
                    <Sparkles size={14} color="var(--accent-amber)" /> {isParsing ? 'Extracting...' : 'Extract Clean URL'}
                  </button>
                )}

                {cleanPreview && (
                  <div
                    style={{
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      marginTop: '6px',
                      fontSize: '0.78rem',
                      color: '#34d399',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      wordBreak: 'break-all',
                    }}
                  >
                    <Check size={14} />
                    <span>Cleaned: {cleanPreview}</span>
                  </div>
                )}
              </div>

              {/* Movie Title, City & Language */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Movie / Event Title
                  </label>
                  <input
                    className="input-field"
                    placeholder="Auto-extracted"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    City
                  </label>
                  <input
                    className="input-field"
                    placeholder="Hyderabad"
                    required
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Language
                  </label>
                  <input
                    className="input-field"
                    placeholder="e.g. Telugu"
                    value={newLanguage}
                    onChange={(e) => setNewLanguage(e.target.value)}
                  />
                </div>
              </div>

              {/* 🏢 Frequent Theatre Filters with Top 3 Quick Access & Dropdown */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🏢 Frequent Theatres <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>(Top 3 Quick Access)</span>
                  </label>
                  {nearestTheatre && (
                    <span style={{ fontSize: '0.72rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Home size={12} /> Nearest: <strong>{nearestTheatre.split(':')[0]}</strong>
                    </span>
                  )}
                </div>

                {/* Top 3 Quick Access Chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {theatreSuggestions.slice(0, 3).map((theatre) => {
                    const isSelected = selectedTheatres.includes(theatre);
                    const isFav = favouriteTheatres.includes(theatre);
                    const isNearest = nearestTheatre === theatre;
                    const shortName = theatre.split(':')[0] || theatre;
                    return (
                      <div
                        key={theatre}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid var(--bms-red)' : '1px solid var(--border-subtle)',
                          background: isSelected ? 'rgba(229, 9, 20, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                          padding: '3px 8px',
                          gap: '6px',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleTheatrePreset(theatre)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: 0,
                          }}
                        >
                          <span>{isSelected ? '✓' : '＋'}</span>
                          <span>{shortName}</span>
                        </button>

                        {/* Favorite Heart Toggle */}
                        <button
                          type="button"
                          onClick={(e) => toggleFavouriteTheatre(theatre, e)}
                          title={isFav ? 'Favorited Theatre (Click to unfavorite)' : 'Mark as Favourite'}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Heart
                            size={13}
                            color={isFav ? '#e50914' : 'var(--text-muted)'}
                            fill={isFav ? '#e50914' : 'none'}
                          />
                        </button>

                        {/* Nearest to Home Badge / Toggle */}
                        <button
                          type="button"
                          onClick={() => handleSetNearestTheatre(theatre)}
                          title={isNearest ? 'Nearest to Home (Click to unset)' : 'Set as Nearest to Home'}
                          style={{
                            background: isNearest ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Home
                            size={12}
                            color={isNearest ? '#38bdf8' : 'var(--text-muted)'}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Dropdown Menu for All / Additional Theatres */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginBottom: '8px' }}>
                  <select
                    className="input-field"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        addCustomTheatre(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    style={{ fontSize: '0.82rem' }}
                  >
                    <option value="" disabled>
                      ▼ Select theatre from dropdown menu...
                    </option>
                    {favouriteTheatres.length > 0 && (
                      <optgroup label="❤️ Your Favourite Theatres">
                        {favouriteTheatres.map((t) => (
                          <option key={`fav-${t}`} value={t}>
                            ❤️ {t}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="🏢 All Theatres">
                      {theatreSuggestions.map((t) => {
                        const isFav = favouriteTheatres.includes(t);
                        const isNearest = nearestTheatre === t;
                        return (
                          <option key={t} value={t}>
                            {isFav ? '❤️ ' : ''}{isNearest ? '🏠 [Nearest] ' : ''}{t}
                          </option>
                        );
                      })}
                    </optgroup>
                  </select>
                </div>

                {/* Custom Theatre Input Fallback */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    className="input-field"
                    placeholder="Or type custom theatre name..."
                    list="theatreDatalist"
                    value={customTheatreInput}
                    onChange={(e) => setCustomTheatreInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomTheatre();
                      }
                    }}
                  />
                  <datalist id="theatreDatalist">
                    {theatreSuggestions.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  <button type="button" className="btn btn-secondary" onClick={() => addCustomTheatre()}>
                    Add
                  </button>
                </div>

                {/* Selected Theatres Chips */}
                {selectedTheatres.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {selectedTheatres.map((t) => {
                      const isFav = favouriteTheatres.includes(t);
                      const isNearest = nearestTheatre === t;
                      return (
                        <span
                          key={t}
                          style={{
                            background: 'rgba(229, 9, 20, 0.15)',
                            border: '1px solid var(--bms-red)',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            color: '#fff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          {isFav && <Heart size={11} color="#e50914" fill="#e50914" />}
                          {isNearest && <Home size={11} color="#38bdf8" />}
                          <span>{t}</span>
                          <span
                            onClick={() => setSelectedTheatres((prev) => prev.filter((item) => item !== t))}
                            style={{ cursor: 'pointer', marginLeft: '2px', color: '#f87171' }}
                            title="Remove"
                          >
                            ✕
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 📅 Date Filter Option with Screening Range Enforcement */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                    📅 Target Show Dates
                  </label>
                  {(movieFirstDate || movieLastDate) && (
                    <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
                      🎞️ Showing: {movieFirstDate || 'Current'} → {movieLastDate || 'Open'}
                    </span>
                  )}
                </div>

                {/* Date range error warning */}
                {dateOutOfRangeError && (
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '0.78rem',
                      color: '#f87171',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>{dateOutOfRangeError}</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="date"
                    className="input-field"
                    value={customDateInput}
                    min={movieFirstDate || undefined}
                    max={movieLastDate || undefined}
                    onChange={(e) => {
                      setCustomDateInput(e.target.value);
                      setDateOutOfRangeError(null);
                    }}
                    style={{ colorScheme: 'dark' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleAddDate}
                  >
                    Add Date
                  </button>
                </div>

                {selectedDates.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {selectedDates.map((d) => (
                      <span
                        key={d}
                        onClick={() => setSelectedDates((prev) => prev.filter((item) => item !== d))}
                        style={{
                          background: 'rgba(6, 182, 212, 0.15)',
                          border: '1px solid rgba(6, 182, 212, 0.4)',
                          color: '#38bdf8',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                        title="Click to remove"
                      >
                        📅 {d} ✕
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 1-Tap Show Time Presets */}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  ⏰ Show Time Window (1-Tap Presets)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '8px' }}>
                  <button
                    type="button"
                    className={`time-preset-btn ${activeTimePreset === 'Morning' ? 'active' : ''}`}
                    onClick={() => applyTimePreset('', '12:00', 'Morning')}
                  >
                    🌅 Morning (&lt;12 PM)
                  </button>
                  <button
                    type="button"
                    className={`time-preset-btn ${activeTimePreset === 'Matinee' ? 'active' : ''}`}
                    onClick={() => applyTimePreset('12:00', '16:00', 'Matinee')}
                  >
                    ☀️ Matinee (12-4 PM)
                  </button>
                  <button
                    type="button"
                    className={`time-preset-btn ${activeTimePreset === 'Evening' ? 'active' : ''}`}
                    onClick={() => applyTimePreset('16:00', '20:00', 'Evening')}
                  >
                    🌆 Evening (4-8 PM)
                  </button>
                  <button
                    type="button"
                    className={`time-preset-btn ${activeTimePreset === 'Night' ? 'active' : ''}`}
                    onClick={() => applyTimePreset('20:00', '', 'Night')}
                  >
                    🌙 Night (&gt;8 PM)
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>From</label>
                    <input
                      type="time"
                      className="input-field"
                      value={timeFrom}
                      onChange={(e) => {
                        setTimeFrom(e.target.value);
                        setActiveTimePreset(null);
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>To</label>
                    <input
                      type="time"
                      className="input-field"
                      value={timeTo}
                      onChange={(e) => {
                        setTimeTo(e.target.value);
                        setActiveTimePreset(null);
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Check Frequency */}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  🔄 Check Interval
                </label>
                <select
                  className="input-field"
                  value={newInterval}
                  onChange={(e) => setNewInterval(Number(e.target.value))}
                >
                  <option value={15}>Every 15 seconds (High Speed Radar)</option>
                  <option value={30}>Every 30 seconds (Balanced)</option>
                  <option value={60}>Every 60 seconds (Standard)</option>
                  <option value={300}>Every 5 minutes</option>
                </select>
              </div>

              {/* Alert Channels: Automated Email & WhatsApp */}
              <div style={{ display: 'grid', gridTemplateColumns: currentUser ? '1.2fr 1fr' : '1fr 1fr', gap: '12px' }}>
                {currentUser ? (
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>✉️ Alert Destination (Automatic):</span>
                    <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                      <Mail size={14} /> {currentUser.email}
                    </span>
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                      ✉️ Alert Email (optional)
                    </label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="e.g. alerts@gmail.com"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    💬 WhatsApp Number (optional)
                  </label>
                  <input
                    type="tel"
                    className="input-field"
                    placeholder="+91 9876543210"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  <ShieldCheck size={16} /> Start Monitoring
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Alert History Modal */}
      {selectedMonitorForHistory && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
        >
          <div
            className="glass-card modal-sheet"
            style={{
              maxWidth: '560px',
              width: '100%',
              maxHeight: '80vh',
              overflowY: 'auto',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Alert History</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {selectedMonitorForHistory.name} · {selectedMonitorForHistory.city}
                </p>
              </div>
              <button
                onClick={() => setSelectedMonitorForHistory(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {selectedMonitorForHistory.alerts.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                No alerts recorded yet for this monitor.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {selectedMonitorForHistory.alerts.map((al) => {
                  const openings = Array.isArray(al.openings) ? al.openings : [];
                  return (
                    <div
                      key={al.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        borderRadius: '10px',
                        padding: '12px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-green)' }}>
                          🎉 {openings.length} Show Opening(s)
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(al.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                        {al.channels.map((ch) => (
                          <span
                            key={ch}
                            style={{
                              background: 'rgba(6, 182, 212, 0.15)',
                              color: '#38bdf8',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.68rem',
                              fontWeight: 600,
                            }}
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {openings.map((op: any, i: number) => (
                          <div
                            key={i}
                            style={{
                              fontSize: '0.78rem',
                              color: 'var(--text-secondary)',
                              background: 'rgba(0, 0, 0, 0.2)',
                              padding: '6px 8px',
                              borderRadius: '6px',
                            }}
                          >
                            <strong>{op.theatre}</strong> ({op.date}) — ⏰ {op.showtime}: {op.change}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notification Settings Modal */}
      {showSettingsModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '16px',
          }}
        >
          <div
            className="glass-card modal-sheet"
            style={{
              maxWidth: '540px',
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={20} color="var(--bms-red)" />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Notification Settings</h2>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              Configure your sender credentials to deliver instant BookMyShow ticket alerts to your inbox or phone.
            </p>

            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Section 1: Email Credentials */}
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.9rem' }}>
                    <Mail size={16} color="var(--accent-cyan)" />
                    <span>Gmail SMTP Alert Sender</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: notifConfig.isEmailConfigured ? '#34d399' : '#f87171' }}>
                    {notifConfig.isEmailConfigured ? '✓ Configured' : '⚠ Missing Credentials'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Sender Gmail Address *
                    </label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="e.g. youraccount@gmail.com"
                      required
                      value={cfgEmailFrom}
                      onChange={(e) => setCfgEmailFrom(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Google 16-Character App Password *
                    </label>
                    <input
                      type="password"
                      className="input-field"
                      placeholder={notifConfig.hasAppPassword ? '•••••••••••••••• (Saved — leave blank to keep)' : 'xxxx xxxx xxxx xxxx'}
                      value={cfgEmailAppPassword}
                      onChange={(e) => setCfgEmailAppPassword(e.target.value)}
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Generate at:{' '}
                      <a
                        href="https://myaccount.google.com/apppasswords"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
                      >
                        myaccount.google.com/apppasswords
                      </a>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Default Recipient Email (Where alerts are delivered)
                    </label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="e.g. yourpersonal@gmail.com"
                      value={cfgDefaultEmailTo}
                      onChange={(e) => setCfgDefaultEmailTo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Twilio Alert Provider (WhatsApp & SMS) */}
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.9rem' }}>
                    <MessageSquare size={16} color="#f22f46" />
                    <span>Twilio Alerts (WhatsApp & SMS)</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: notifConfig.hasTwilio ? '#34d399' : 'var(--text-muted)' }}>
                    {notifConfig.hasTwilio ? '✓ Configured' : '⚠ Missing Credentials'}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Twilio Account SID
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={cfgTwilioSid}
                      onChange={(e) => setCfgTwilioSid(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Twilio Auth Token
                    </label>
                    <input
                      type="password"
                      className="input-field"
                      placeholder={notifConfig.hasTwilioToken ? '•••••••••••••••• (Saved — leave blank to keep)' : 'Enter Twilio Auth Token'}
                      value={cfgTwilioToken}
                      onChange={(e) => setCfgTwilioToken(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Twilio Sender Number (From)
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="whatsapp:+14155238886 or +1234567890"
                      value={cfgTwilioFrom}
                      onChange={(e) => setCfgTwilioFrom(e.target.value)}
                    />
                    <div
                      style={{
                        background: 'rgba(242, 47, 70, 0.08)',
                        border: '1px solid rgba(242, 47, 70, 0.25)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        fontSize: '0.78rem',
                        color: '#fca5a5',
                        lineHeight: 1.5,
                        marginTop: '6px',
                      }}
                    >
                      📲 <strong>Twilio WhatsApp Sandbox Step:</strong><br />
                      Twilio Sandbox will block messages until your phone joins the sandbox. Open WhatsApp on your phone and send <code>join nodded-substance</code> to <strong>+1 415 523 8886</strong>. (If you have a different join code in your Twilio Console, send that code).
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Default Recipient Phone Number
                    </label>
                    <input
                      type="tel"
                      className="input-field"
                      placeholder="+919876543210"
                      value={cfgDefaultWhatsappTo}
                      onChange={(e) => setCfgDefaultWhatsappTo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Optional Secondary: CallMeBot Free WhatsApp API */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    Alternative Free API: CallMeBot (Optional)
                  </span>
                  <span style={{ fontSize: '0.72rem', color: notifConfig.hasCallmebotKey ? '#34d399' : 'var(--text-muted)' }}>
                    {notifConfig.hasCallmebotKey ? 'Configured' : 'Optional'}
                  </span>
                </div>
                <div>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={notifConfig.hasCallmebotKey ? '•••••••• (Saved — leave blank to keep)' : 'Enter CallMeBot API Key (optional fallback)'}
                    value={cfgCallmebotKey}
                    onChange={(e) => setCfgCallmebotKey(e.target.value)}
                  />
                </div>
              </div>

              {/* Section 3: Nearest Theatre to Home Preferences */}
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.9rem' }}>
                    <Home size={16} color="#38bdf8" />
                    <span>Nearest Theatre to Home</span>
                  </div>
                  {nearestTheatre && (
                    <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
                      ✓ Set: {nearestTheatre.split(':')[0]}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  Set your closest local theatre to highlight it with a home badge and prioritize ticket drops closest to your location.
                </p>
                <select
                  className="input-field"
                  value={nearestTheatre}
                  onChange={(e) => {
                    handleSetNearestTheatre(e.target.value);
                  }}
                  style={{ fontSize: '0.84rem' }}
                >
                  <option value="">-- None Selected (Click to choose your nearest theatre) --</option>
                  {theatreSuggestions.map((t) => (
                    <option key={`setting-nearest-${t}`} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {settingsStatus && (
                <div
                  style={{
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: settingsStatus.startsWith('✅') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: settingsStatus.startsWith('✅') ? '#34d399' : '#fca5a5',
                  }}
                >
                  {settingsStatus}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSettingsModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSavingSettings}>
                  {isSavingSettings ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Private Device Vault Modal */}
      {showVaultModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 110,
            padding: '16px',
          }}
        >
          <div
            className="glass-card modal-sheet"
            style={{
              maxWidth: '500px',
              width: '100%',
              padding: '24px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={22} color="#34d399" />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Private Device Vault</h2>
              </div>
              <button
                onClick={() => setShowVaultModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '10px',
                padding: '14px',
                fontSize: '0.85rem',
                color: '#d1fae5',
                lineHeight: 1.5,
                marginBottom: '18px',
              }}
            >
              🔒 <strong>Device Privacy Active:</strong> Your monitors, emails, and ticket drop alerts are completely isolated to this device. If a friend visits this site from their phone or laptop, they will get their own blank vault and will never see your monitors or contact info.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                This Device's Private Vault Key
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={vaultKey}
                  style={{
                    flex: 1,
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#34d399',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(vaultKey);
                    setVaultCopied(true);
                    setTimeout(() => setVaultCopied(false), 2000);
                  }}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {vaultCopied ? <Check size={16} color="#34d399" /> : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px', marginTop: '16px' }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '6px' }}>
                Sync with another device (Optional)
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                Want this device to share monitors with your other device (e.g. phone ↔ laptop)? Paste that device's Vault Key below:
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Paste Vault Key (e.g. vlt_...)"
                  value={syncInputKey}
                  onChange={(e) => setSyncInputKey(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!syncInputKey.trim()}
                  onClick={() => {
                    const cleaned = syncInputKey.trim();
                    if (cleaned) {
                      localStorage.setItem('bms_vault_key', cleaned);
                      setVaultKey(cleaned);
                      setShowVaultModal(false);
                    }
                  }}
                >
                  Link & Sync
                </button>
              </div>

              <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Create a new fresh vault for this device? Current monitors will remain saved under the old key.')) {
                      const newKey = `vlt_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
                      localStorage.setItem('bms_vault_key', newKey);
                      setVaultKey(newKey);
                      setShowVaultModal(false);
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Reset / Generate New Private Vault
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Tab Navigation */}
      <nav className="mobile-tab-bar">
        <button
          className="mobile-tab-btn"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={18} />
          <span>Add</span>
        </button>
        <button
          className="mobile-tab-btn active"
          onClick={fetchMonitors}
        >
          <Film size={18} />
          <span>Monitors</span>
        </button>
        <button
          className="mobile-tab-btn"
          onClick={() => {
            setShowVaultModal(true);
            setSyncInputKey('');
            setVaultCopied(false);
          }}
        >
          <ShieldCheck size={18} />
          <span>Vault</span>
        </button>
        <button
          className="mobile-tab-btn"
          onClick={() => setShowSettingsModal(true)}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}
