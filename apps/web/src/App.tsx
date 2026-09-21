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
  Ticket,
  Search,
  Key,
  ChevronDown,
  ChevronUp,
  Copy,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
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
  const [showVaultSyncAccordion, setShowVaultSyncAccordion] = useState(false);
  const [vaultSyncFeedback, setVaultSyncFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<LiveEventPayload[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMonitorForHistory, setSelectedMonitorForHistory] = useState<Monitor | null>(null);
  const [theatreSuggestions, setTheatreSuggestions] = useState<string[]>(PRESET_THEATRES);
  const [activeTab, setActiveTab] = useState<'monitors' | 'radar'>('monitors');
  const [radarSubTab, setRadarSubTab] = useState<'stream' | 'drops'>('stream');
  const [streamFilter, setStreamFilter] = useState<'all' | 'drops' | 'cycles' | 'errors'>('all');
  const [monitorSearchQuery, setMonitorSearchQuery] = useState('');
  const [monitorStatusFilter, setMonitorStatusFilter] = useState<'all' | 'active' | 'paused' | 'alerts'>('all');

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

  // Handle Google OAuth redirect — picks up ?auth_token= & ?auth_user= from the callback URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get('auth_token');
    const oauthUser = params.get('auth_user');
    const oauthError = params.get('auth_error');

    if (oauthToken && oauthUser) {
      try {
        const parsedUser = JSON.parse(oauthUser) as AuthUser;
        handleLoginSuccess(parsedUser, oauthToken);
      } catch {
        // Ignore parse errors — user will see the login page
      }
      // Clean up the URL so token is not visible or bookmarkable
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (oauthError) {
      // Let the login page show the error by storing it briefly
      const msg = decodeURIComponent(oauthError).replace(/_/g, ' ');
      console.error('Google OAuth error:', msg);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [theatreSearchQuery, setTheatreSearchQuery] = useState('');
  const [isTheatreDropdownOpen, setIsTheatreDropdownOpen] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [customDateInput, setCustomDateInput] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  // Slider slots: 0–48 each slot = 30 min (0=00:00, 48=24:00)
  const [sliderFrom, setSliderFrom] = useState(0);
  const [sliderTo, setSliderTo] = useState(48);
  const [activeTimePreset, setActiveTimePreset] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [heroPasteInput, setHeroPasteInput] = useState('');

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

  // Track which monitor's error popover or action overflow menu is open
  const [activeErrorPopoverId, setActiveErrorPopoverId] = useState<string | null>(null);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  // Movie show range dates & calendar pagination
  const [movieFirstDate, setMovieFirstDate] = useState<string>('');
  const [movieLastDate, setMovieLastDate] = useState<string>('');
  const [dateOutOfRangeError, setDateOutOfRangeError] = useState<string | null>(null);
  const [calendarMonthOffset, setCalendarMonthOffset] = useState<number>(0);

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
  const [isEmailBannerDismissed, setIsEmailBannerDismissed] = useState(() => {
    return sessionStorage.getItem('bms_dismiss_email_banner') === 'true';
  });
  const [notifConfig, setNotifConfig] = useState<{
    emailFrom: string;
    hasAppPassword: boolean;
    defaultEmailTo: string;
    smtpHost: string;
    smtpPort: number;
    isEmailConfigured: boolean;
  }>({
    emailFrom: '',
    hasAppPassword: false,
    defaultEmailTo: '',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    isEmailConfigured: false,
  });

  const [cfgEmailFrom, setCfgEmailFrom] = useState('');
  const [cfgEmailAppPassword, setCfgEmailAppPassword] = useState('');
  const [cfgDefaultEmailTo, setCfgDefaultEmailTo] = useState('');
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
        }),
      });
      const data = await safeJson(res);
      if (res.ok) {
        setSettingsStatus('✅ Settings saved successfully!');
        setCfgEmailAppPassword('');
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
  }, [vaultKey, authToken, isGuest]);

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

  const addCustomTheatre = (theatreToAdd?: string) => {
    const val = (theatreToAdd || customTheatreInput).trim();
    if (!val) return;
    if (!selectedTheatres.includes(val)) {
      setSelectedTheatres((prev) => [...prev, val]);
    }
    if (!theatreToAdd) setCustomTheatreInput('');
  };

  // Converts 30-min slot index to HH:MM string (slot 0 = 00:00, 48 = 24:00→stored as '')
  const slotToTime = (slot: number): string => {
    if (slot <= 0) return '';
    if (slot >= 48) return '';
    const totalMins = slot * 30;
    const h = Math.floor(totalMins / 60).toString().padStart(2, '0');
    const m = (totalMins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const slotLabel = (slot: number): string => {
    if (slot <= 0) return '12:00 AM';
    if (slot >= 48) return '11:59 PM';
    const totalMins = slot * 30;
    const h24 = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
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
        setWizardStep(1);
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* SSE Live Status Indicator */}
          <div className={`badge ${isConnected ? 'badge-active' : 'badge-alert'}`} style={{ marginRight: '4px' }}>
            <span className="pulse-dot" />
            <span style={{ fontSize: '0.72rem' }}>{isConnected ? 'LIVE RADAR' : 'OFFLINE'}</span>
          </div>

          {/* Private Device Vault Button (Icon-Only with Tooltip) */}
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => {
              setShowVaultModal(true);
              setSyncInputKey('');
              setVaultCopied(false);
            }}
            style={{
              border: '1px solid rgba(16, 185, 129, 0.4)',
              background: 'rgba(16, 185, 129, 0.08)',
              color: '#34d399',
            }}
            title={`Private Vault (${vaultKey.slice(0, 8)}...) — Click to view / sync keys`}
            aria-label="Device Vault"
          >
            <ShieldCheck size={18} color="#34d399" />
          </button>

          {/* Notification Settings Button (Icon-Only with Unconfigured Red Dot Badge) */}
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => {
              setShowSettingsModal(true);
              setSettingsStatus(null);
            }}
            title={notifConfig.isEmailConfigured ? 'Notification Settings (Email Active)' : 'Notification Settings (⚠️ Email Not Configured)'}
            aria-label="Settings"
          >
            <Settings size={18} />
            {!notifConfig.isEmailConfigured && (
              <span
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  boxShadow: '0 0 6px #ef4444',
                }}
              />
            )}
          </button>

          {/* Prominent "+ New Monitor" Primary CTA Button */}
          <button
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
            style={{ padding: '8px 16px', fontSize: '0.82rem' }}
          >
            <Plus size={16} /> New Monitor
          </button>

          {/* User Account / Logout Action */}
          {currentUser ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '3px 4px 3px 10px',
              }}
            >
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  maxWidth: '140px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={currentUser.email}
              >
                {currentUser.name || currentUser.email.split('@')[0]}
              </span>
              <button
                className="btn btn-icon"
                onClick={handleLogout}
                style={{
                  width: '32px',
                  height: '32px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '6px',
                }}
                title={`Log out from ${currentUser.email}`}
                aria-label="Logout"
              >
                <LogOut size={14} />
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
                padding: '8px 14px',
                fontSize: '0.82rem',
              }}
              title="Sign in with an account"
            >
              <UserIcon size={15} color="var(--bms-red)" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Dismissible Inline Notice Bar if Email is not configured */}
      {!notifConfig.isEmailConfigured && !isEmailBannerDismissed && (
        <div
          style={{
            background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.12) 0%, rgba(229, 9, 20, 0.06) 100%)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '10px 14px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            boxShadow: '0 2px 10px rgba(239, 68, 68, 0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                background: 'rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AlertTriangle color="#ef4444" size={15} />
            </div>
            <div style={{ fontSize: '0.82rem', color: '#fca5a5', lineHeight: 1.4 }}>
              <strong style={{ color: '#ffffff' }}>Alert Deliveries Inactive:</strong> Email credentials are not configured yet.{' '}
              <span style={{ opacity: 0.85 }}>
                Add your Resend API Key or Gmail App Password to receive real-time ticket drop alerts.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                setShowSettingsModal(true);
                setSettingsStatus(null);
              }}
              style={{ padding: '5px 12px', fontSize: '0.76rem', whiteSpace: 'nowrap', gap: '5px' }}
            >
              <Settings size={13} /> Configure Settings
            </button>
            <button
              onClick={() => {
                setIsEmailBannerDismissed(true);
                sessionStorage.setItem('bms_dismiss_email_banner', 'true');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.4)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                transition: 'color 0.15s ease',
              }}
              title="Dismiss for this session"
              aria-label="Dismiss banner"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: 'rgba(229, 9, 20, 0.15)', color: 'var(--bms-red)' }}>
            <Film size={20} />
          </div>
          <div>
            <div className="kpi-label">Active Monitors</div>
            <div className="kpi-val">
              {monitors.filter((m) => m.status === 'active').length}
              <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '6px' }}>
                / {monitors.length} total
              </span>
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
            <Bell size={20} />
          </div>
          <div>
            <div className="kpi-label">Alerts Triggered</div>
            <div className="kpi-val">
              {monitors.reduce((acc, m) => acc + (m.alerts?.length || 0), 0)}
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: isConnected ? 'rgba(6, 182, 212, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: isConnected ? '#38bdf8' : '#f87171' }}>
            <Radio size={20} />
          </div>
          <div>
            <div className="kpi-label">Radar Stream</div>
            <div className="kpi-val" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="pulse-dot" style={{ color: isConnected ? '#10b981' : '#ef4444' }} />
              {isConnected ? 'ONLINE (SSE)' : 'OFFLINE'}
            </div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrapper" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
            <Clock size={20} />
          </div>
          <div>
            <div className="kpi-label">Fastest Check Cadence</div>
            <div className="kpi-val">
              {monitors.length > 0
                ? `${Math.min(...monitors.map((m) => m.checkIntervalSec || 60))}s`
                : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard View Tabs */}
      <div className="dashboard-tabs">
        <button
          className={`dashboard-tab-btn ${activeTab === 'monitors' ? 'active' : ''}`}
          onClick={() => setActiveTab('monitors')}
        >
          <Film size={16} />
          <span>Tracked Monitors ({monitors.length})</span>
        </button>

        <button
          className={`dashboard-tab-btn ${activeTab === 'radar' ? 'active' : ''}`}
          onClick={() => setActiveTab('radar')}
        >
          <Radio size={16} color="var(--accent-cyan)" />
          <span>Live Radar Feed & Telemetry</span>
          {liveEvents.length > 0 && (
            <span
              style={{
                fontSize: '0.7rem',
                background: 'rgba(6, 182, 212, 0.2)',
                color: '#38bdf8',
                padding: '1px 6px',
                borderRadius: '10px',
                fontWeight: 700,
              }}
            >
              {liveEvents.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab 1: Monitors Table View */}
      {activeTab === 'monitors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                Monitored Target Schedule ({monitors.length})
              </h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Active BullMQ cron radar polling BookMyShow directly
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={fetchMonitors} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                <RefreshCw size={14} /> Refresh
              </button>
              <button className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ padding: '6px 14px', fontSize: '0.8rem' }}>
                <Plus size={14} /> New Monitor
              </button>
            </div>
          </div>

          {/* Integrated Search & Status Filter Toolbar (Option A) */}
          {monitors.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '8px 12px',
              }}
            >
              {/* Search Input Box */}
              <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px', maxWidth: '420px' }}>
                <Search
                  size={14}
                  color="var(--text-muted)"
                  style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="text"
                  className="input-field"
                  placeholder="Filter by movie, theatre, city..."
                  value={monitorSearchQuery}
                  onChange={(e) => setMonitorSearchQuery(e.target.value)}
                  style={{
                    paddingLeft: '32px',
                    paddingRight: monitorSearchQuery ? '28px' : '10px',
                    paddingTop: '6px',
                    paddingBottom: '6px',
                    fontSize: '0.78rem',
                    background: 'rgba(0, 0, 0, 0.25)',
                  }}
                />
                {monitorSearchQuery && (
                  <button
                    onClick={() => setMonitorSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Status Filter Pill Chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {[
                  { id: 'all', label: 'All', count: monitors.length },
                  { id: 'active', label: 'Active', count: monitors.filter((m) => m.status === 'active').length },
                  { id: 'paused', label: 'Paused', count: monitors.filter((m) => m.status === 'paused').length },
                  {
                    id: 'alerts',
                    label: 'Has Alerts',
                    count: monitors.filter((m) => (m.alerts?.length || 0) > 0).length,
                  },
                ].map((tab) => {
                  const isSelected = monitorStatusFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setMonitorStatusFilter(tab.id as any)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '16px',
                        border: isSelected ? '1px solid var(--bms-red)' : '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(229, 9, 20, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                        color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                        fontSize: '0.74rem',
                        fontWeight: isSelected ? 700 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>{tab.label}</span>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '1px 5px',
                          borderRadius: '8px',
                          background: isSelected ? 'var(--bms-red)' : 'rgba(255, 255, 255, 0.08)',
                          color: '#ffffff',
                        }}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {loading ? (
            <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading monitored targets...
            </div>
          ) : monitors.length === 0 ? (
            <div className="glass-card empty-hero-card">
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '14px',
                  background: 'rgba(229, 9, 20, 0.14)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  border: '1px solid rgba(229, 9, 20, 0.35)',
                  boxShadow: '0 0 24px rgba(229, 9, 20, 0.2)',
                }}
              >
                <Film size={26} color="var(--bms-red)" />
              </div>
              <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px', letterSpacing: '-0.3px' }}>
                Track Any BookMyShow Movie
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
                Paste any BookMyShow movie link or share text below. Our radar will inspect the showtimes and notify you the second tickets drop.
              </p>

              {/* Instant Hero Paste Box */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (heroPasteInput.trim()) {
                    handlePastedTextInput(heroPasteInput);
                    setShowAddModal(true);
                  }
                }}
                className="hero-paste-box"
              >
                <Film size={18} color="var(--text-muted)" style={{ flexShrink: 0, marginLeft: '4px' }} />
                <input
                  type="text"
                  className="hero-paste-input"
                  placeholder="Paste BookMyShow link (e.g. https://in.bookmyshow.com/...)"
                  value={heroPasteInput}
                  onChange={(e) => setHeroPasteInput(e.target.value)}
                  autoFocus
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!heroPasteInput.trim()}
                  style={{
                    padding: '8px 18px',
                    fontSize: '0.82rem',
                    whiteSpace: 'nowrap',
                    opacity: heroPasteInput.trim() ? 1 : 0.6,
                  }}
                >
                  <Sparkles size={14} /> Inspect &amp; Track
                </button>
              </form>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                <span>⚡ 15–30s fast polling</span>
                <span>•</span>
                <span>✉️ Email &amp; WhatsApp alerts</span>
                <span>•</span>
                <span>🏛️ Filter specific theatres</span>
              </div>
            </div>
          ) : (
            <div className="glass-card monitor-table-container">
              <table className="monitor-table">
                <thead>
                  <tr>
                    <th className="col-sticky-movie">Movie / Event</th>
                    <th>City</th>
                    <th>Theatres & Dates</th>
                    <th>Status</th>
                    <th>Last Checked</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filteredMonitors = monitors.filter((m) => {
                      // Status filtering
                      if (monitorStatusFilter === 'active' && m.status !== 'active') return false;
                      if (monitorStatusFilter === 'paused' && m.status !== 'paused') return false;
                      if (monitorStatusFilter === 'alerts' && (!m.alerts || m.alerts.length === 0)) return false;

                      // Text query filtering (name, city, theatres)
                      if (monitorSearchQuery.trim()) {
                        const q = monitorSearchQuery.toLowerCase();
                        const matchName = m.name.toLowerCase().includes(q);
                        const matchCity = m.city.toLowerCase().includes(q);
                        const matchTheatre = m.filterTheatres.some((t) => t.toLowerCase().includes(q));
                        if (!matchName && !matchCity && !matchTheatre) return false;
                      }
                      return true;
                    });

                    if (filteredMonitors.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                            <Search size={24} style={{ margin: '0 auto 8px', opacity: 0.6 }} />
                            <div>No monitors match your search or filter criteria.</div>
                            <button
                              type="button"
                              onClick={() => {
                                setMonitorSearchQuery('');
                                setMonitorStatusFilter('all');
                              }}
                              style={{
                                marginTop: '8px',
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent-cyan)',
                                cursor: 'pointer',
                                fontSize: '0.78rem',
                                textDecoration: 'underline',
                              }}
                            >
                              Reset filters
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return filteredMonitors.map((m) => {
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const dates = m.filterDates.length > 0 ? [...m.filterDates].sort() : [];
                    const firstDate = dates[0] || '';
                    const lastDate = dates[dates.length - 1] || '';
                    const isBeforeRun = firstDate && todayStr < firstDate;
                    const isAfterRun = lastDate && todayStr > lastDate;

                    const latestAlert = m.alerts && m.alerts.length > 0 ? m.alerts[0] : null;
                    const latestOpenings: any[] = latestAlert && Array.isArray(latestAlert.openings) ? latestAlert.openings : [];
                    const hasLiveOpenings = latestOpenings.length > 0;

                    return (
                      <React.Fragment key={m.id}>
                        <tr style={{ borderBottom: hasLiveOpenings ? 'none' : undefined }}>
                          {/* Target Title & Link */}
                          <td className="col-sticky-movie" style={{ minWidth: '180px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                              {m.name}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <a
                                href={m.url}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  color: 'var(--bms-red)',
                                  textDecoration: 'none',
                                  fontSize: '0.74rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  fontWeight: 600,
                                }}
                              >
                                BMS Link <ExternalLink size={10} />
                              </a>
                              {isBeforeRun && (
                                <span style={{ fontSize: '0.7rem', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                                  Starts {firstDate}
                                </span>
                              )}
                              {isAfterRun && (
                                <span style={{ fontSize: '0.7rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                                  Ended ({lastDate})
                                </span>
                              )}
                            </div>
                          </td>

                          {/* City & Interval */}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
                              <MapPin size={13} color="var(--text-secondary)" /> {m.city}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              Every {m.checkIntervalSec}s
                            </div>
                          </td>

                          {/* Theatres & Dates */}
                          <td style={{ maxWidth: '240px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                              {m.filterTheatres.length === 0 ? (
                                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>All Theatres</span>
                              ) : (
                                m.filterTheatres.slice(0, 2).map((t) => {
                                  const isFav = favouriteTheatres.includes(t);
                                  const isNearest = nearestTheatre === t;
                                  const shortName = t.split(':')[0] || t;
                                  return (
                                    <span
                                      key={t}
                                      style={{
                                        background: 'rgba(255,255,255,0.06)',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: '0.72rem',
                                        color: 'var(--text-secondary)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                      }}
                                      title={t}
                                    >
                                      {isFav && <Heart size={10} color="#e50914" fill="#e50914" />}
                                      {isNearest && <Home size={10} color="#38bdf8" />}
                                      <span>{shortName}</span>
                                    </span>
                                  );
                                })
                              )}
                              {m.filterTheatres.length > 2 && (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                  +{m.filterTheatres.length - 2} more
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {m.filterDates.length === 0 ? (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>All Dates</span>
                              ) : (
                                m.filterDates.map((d) => (
                                  <span
                                    key={d}
                                    style={{
                                      background: 'rgba(255,255,255,0.04)',
                                      padding: '2px 5px',
                                      borderRadius: '3px',
                                      fontSize: '0.7rem',
                                      color: 'var(--text-muted)',
                                    }}
                                  >
                                    {d}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>

                          {/* Status & Error Popover */}
                          <td style={{ position: 'relative' }}>
                            {m.status === 'error' || m.lastError ? (
                              <div style={{ position: 'relative', display: 'inline-block' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveErrorPopoverId(activeErrorPopoverId === m.id ? null : m.id);
                                  }}
                                  className="badge badge-alert"
                                  style={{
                                    cursor: 'pointer',
                                    border: '1px solid rgba(239, 68, 68, 0.5)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 9px',
                                  }}
                                  title="Click to view error diagnostics"
                                >
                                  <AlertTriangle size={12} color="#f87171" />
                                  <span>{m.status}</span>
                                </button>

                                {activeErrorPopoverId === m.id && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      position: 'absolute',
                                      top: 'calc(100% + 6px)',
                                      left: 0,
                                      zIndex: 20,
                                      width: '280px',
                                      background: '#181828',
                                      border: '1px solid rgba(239, 68, 68, 0.4)',
                                      borderRadius: '8px',
                                      padding: '12px',
                                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
                                      fontSize: '0.78rem',
                                      color: 'var(--text-primary)',
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#f87171' }}>
                                        <AlertTriangle size={14} />
                                        <span>Check Diagnostic</span>
                                      </div>
                                      <button
                                        onClick={() => setActiveErrorPopoverId(null)}
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          color: 'var(--text-muted)',
                                          cursor: 'pointer',
                                          padding: '2px',
                                        }}
                                      >
                                        <X size={13} />
                                      </button>
                                    </div>

                                    <div
                                      style={{
                                        background: 'rgba(0, 0, 0, 0.3)',
                                        border: '1px solid rgba(255, 255, 255, 0.06)',
                                        borderRadius: '6px',
                                        padding: '8px',
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '0.72rem',
                                        color: '#fca5a5',
                                        maxHeight: '90px',
                                        overflowY: 'auto',
                                        wordBreak: 'break-word',
                                        lineHeight: 1.4,
                                        marginBottom: '10px',
                                      }}
                                    >
                                      {m.lastError || 'Unknown error occurred during background radar fetch.'}
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                        {m.lastChecked ? `Failed at ${new Date(m.lastChecked).toLocaleTimeString()}` : 'Never ran successfully'}
                                      </span>
                                      <button
                                        className="btn btn-primary"
                                        onClick={() => {
                                          handleTrigger(m.id);
                                          setActiveErrorPopoverId(null);
                                        }}
                                        style={{ padding: '4px 10px', fontSize: '0.72rem', gap: '4px' }}
                                      >
                                        <RefreshCw size={11} /> Retry Now
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className={`badge ${m.status === 'active' ? 'badge-active' : 'badge-alert'}`}>
                                {m.status}
                              </span>
                            )}
                          </td>

                          {/* Last Checked */}
                          <td style={{ whiteSpace: 'nowrap', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                            {m.lastChecked ? new Date(m.lastChecked).toLocaleTimeString() : 'Pending'}
                            <div style={{ marginTop: '2px' }}>
                              <button
                                onClick={() => setSelectedMonitorForHistory(m)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: hasLiveOpenings ? 'var(--accent-green)' : 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontSize: '0.72rem',
                                  padding: 0,
                                  textDecoration: 'underline',
                                  fontWeight: hasLiveOpenings ? 700 : 400,
                                }}
                              >
                                {m.alerts?.length || 0} alert(s)
                              </button>
                            </div>
                          </td>

                          {/* Action buttons (Option A: Primary Check Now + ... Overflow Menu) */}
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap', position: 'relative' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <button
                                className="btn btn-secondary"
                                onClick={() => handleTrigger(m.id)}
                                title="Trigger Instant Check"
                                style={{
                                  padding: '5px 10px',
                                  fontSize: '0.74rem',
                                  gap: '5px',
                                  background: 'rgba(255, 255, 255, 0.04)',
                                }}
                              >
                                <RefreshCw size={12} />
                                <span>Check Now</span>
                              </button>

                              {/* Overflow Menu Button */}
                              <div style={{ position: 'relative', display: 'inline-block' }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveActionMenuId(activeActionMenuId === m.id ? null : m.id);
                                  }}
                                  title="More Actions"
                                  style={{
                                    padding: '5px 8px',
                                    fontSize: '0.75rem',
                                    borderRadius: '6px',
                                    background: activeActionMenuId === m.id ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                                  }}
                                >
                                  <MoreHorizontal size={14} />
                                </button>

                                {/* Overflow Popover Menu */}
                                {activeActionMenuId === m.id && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      position: 'absolute',
                                      top: 'calc(100% + 4px)',
                                      right: 0,
                                      zIndex: 30,
                                      minWidth: '160px',
                                      background: '#181828',
                                      border: '1px solid var(--border-subtle)',
                                      borderRadius: '8px',
                                      padding: '4px',
                                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '2px',
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedMonitorForHistory(m);
                                        setActiveActionMenuId(null);
                                      }}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '7px 10px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.76rem',
                                        cursor: 'pointer',
                                        borderRadius: '5px',
                                        textAlign: 'left',
                                        width: '100%',
                                        transition: 'background 0.1s ease',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                    >
                                      <History size={13} color="var(--accent-cyan)" />
                                      <span>Alert History</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleToggleStatus(m.id, m.status);
                                        setActiveActionMenuId(null);
                                      }}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '7px 10px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.76rem',
                                        cursor: 'pointer',
                                        borderRadius: '5px',
                                        textAlign: 'left',
                                        width: '100%',
                                        transition: 'background 0.1s ease',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                    >
                                      {m.status === 'active' ? (
                                        <>
                                          <Pause size={13} color="#fbbf24" />
                                          <span>Pause Monitor</span>
                                        </>
                                      ) : (
                                        <>
                                          <Play size={13} color="#34d399" />
                                          <span>Resume Monitor</span>
                                        </>
                                      )}
                                    </button>

                                    <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '2px 0' }} />

                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleDelete(m.id);
                                        setActiveActionMenuId(null);
                                      }}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '7px 10px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#f87171',
                                        fontSize: '0.76rem',
                                        cursor: 'pointer',
                                        borderRadius: '5px',
                                        textAlign: 'left',
                                        width: '100%',
                                        transition: 'background 0.1s ease',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)')}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                    >
                                      <Trash2 size={13} color="#f87171" />
                                      <span>Delete Monitor</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {/* Dedicated Availability Drawer / Alert Strip */}
                        {hasLiveOpenings && (
                          <tr className="availability-strip-row">
                            <td colSpan={6}>
                              <div className="availability-strip">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399', fontWeight: 700, fontSize: '0.78rem' }}>
                                    <Ticket size={14} />
                                    <span>TICKETS AVAILABLE:</span>
                                  </div>
                                  <div className="availability-theatres-list">
                                    {latestOpenings.slice(0, 3).map((op: any, i: number) => {
                                      const theatreName = (op.theatre || 'Theatre').split(':')[0];
                                      return (
                                        <span key={i} className="availability-pill" title={`${op.theatre || ''} (${op.date || ''}) — ${op.showtime || ''}`}>
                                          🏛️ {theatreName} {op.showtime ? `· ⏰ ${op.showtime}` : ''}
                                        </span>
                                      );
                                    })}
                                    {latestOpenings.length > 3 && (
                                      <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
                                        +{latestOpenings.length - 3} more shows
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {latestAlert?.createdAt && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                      Detected {new Date(latestAlert.createdAt).toLocaleTimeString()}
                                    </span>
                                  )}
                                  <a
                                    href={m.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-primary"
                                    style={{
                                      padding: '4px 10px',
                                      fontSize: '0.74rem',
                                      borderRadius: '6px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      textDecoration: 'none',
                                    }}
                                  >
                                    Book on BMS <ExternalLink size={11} />
                                  </a>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  });
                })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Live Activity Radar & Diagnostics */}
      {activeTab === 'radar' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
          {/* Live Activity Stream Console with Tabbed Activity Drawer (Option B) */}
          <div className="glass-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Radio size={18} color="var(--accent-cyan)" /> Activity Console
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Real-time Server-Sent Events (SSE) and verified ticket openings
                </p>
              </div>

              {/* Activity Sub-Tabs (Option B) */}
              <div style={{ display: 'flex', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => setRadarSubTab('stream')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: radarSubTab === 'stream' ? 'rgba(6, 182, 212, 0.18)' : 'transparent',
                    color: radarSubTab === 'stream' ? '#38bdf8' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Radio size={13} />
                  <span>Live Stream</span>
                  <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>({liveEvents.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setRadarSubTab('drops')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: radarSubTab === 'drops' ? 'rgba(16, 185, 129, 0.18)' : 'transparent',
                    color: radarSubTab === 'drops' ? '#34d399' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Ticket size={13} />
                  <span>Recent Drops</span>
                  <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                    ({monitors.reduce((acc, m) => acc + (m.alerts?.length || 0), 0)})
                  </span>
                </button>
              </div>
            </div>

            {/* Sub-Tab 1: Live Stream Telemetry (Option A: Filter Pills: All / Drops / Cycles / Errors) */}
            {radarSubTab === 'stream' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Event Category Filter Pills */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '2px' }}>
                  {[
                    { id: 'all', label: 'All Events', count: liveEvents.length },
                    { id: 'drops', label: 'Ticket Drops', count: liveEvents.filter((e) => e.type === 'TICKET_DROP').length, color: '#34d399' },
                    { id: 'cycles', label: 'Check Cycles', count: liveEvents.filter((e) => e.type === 'CHECK_STARTED' || e.type === 'CHECK_COMPLETED').length, color: '#38bdf8' },
                    { id: 'errors', label: 'Errors', count: liveEvents.filter((e) => e.type === 'ERROR').length, color: '#f87171' },
                  ].map((pill) => {
                    const isSelected = streamFilter === pill.id;
                    return (
                      <button
                        key={pill.id}
                        type="button"
                        onClick={() => setStreamFilter(pill.id as any)}
                        style={{
                          padding: '3px 10px',
                          borderRadius: '14px',
                          border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                          background: isSelected ? 'rgba(6, 182, 212, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                          color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                          fontSize: '0.73rem',
                          fontWeight: isSelected ? 700 : 500,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span>{pill.label}</span>
                        <span
                          style={{
                            fontSize: '0.67rem',
                            padding: '1px 5px',
                            borderRadius: '8px',
                            background: isSelected ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.08)',
                            color: isSelected ? '#000000' : (pill.color || 'var(--text-muted)'),
                            fontWeight: 700,
                          }}
                        >
                          {pill.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  style={{
                    minHeight: '420px',
                    maxHeight: '560px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: 'rgba(0, 0, 0, 0.25)',
                    padding: '16px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {(() => {
                    const filteredEvents = liveEvents.filter((evt) => {
                      if (streamFilter === 'drops') return evt.type === 'TICKET_DROP';
                      if (streamFilter === 'cycles') return evt.type === 'CHECK_STARTED' || evt.type === 'CHECK_COMPLETED';
                      if (streamFilter === 'errors') return evt.type === 'ERROR';
                      return true;
                    });

                    if (filteredEvents.length === 0) {
                      return (
                        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '60px 0' }}>
                          <Radio size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
                          <div>No events match "{streamFilter}" in the current session.</div>
                          <div style={{ fontSize: '0.72rem', marginTop: '6px' }}>
                            {streamFilter !== 'all' ? (
                              <button
                                type="button"
                                onClick={() => setStreamFilter('all')}
                                style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                View all events
                              </button>
                            ) : (
                              'Click "Check Now" on any monitor in Tracked Monitors to trigger a live check'
                            )}
                          </div>
                        </div>
                      );
                    }

                    return filteredEvents.map((evt, idx) => {
                      const isDrop = evt.type === 'TICKET_DROP';
                      const isError = evt.type === 'ERROR';
                      const isCycle = evt.type === 'CHECK_STARTED' || evt.type === 'CHECK_COMPLETED';
                      
                      const borderColor = isDrop ? '#10b981' : isError ? '#ef4444' : '#06b6d4';
                      const badgeBg = isDrop ? 'rgba(16, 185, 129, 0.18)' : isError ? 'rgba(239, 68, 68, 0.18)' : 'rgba(6, 182, 212, 0.18)';
                      const badgeColor = isDrop ? '#34d399' : isError ? '#f87171' : '#38bdf8';
                      const badgeText = isDrop ? '🎉 Ticket Drop' : isError ? '⚠️ Alert Error' : isCycle ? '🔄 Radar Cycle' : '📡 Event';

                    return (
                      <div
                        key={idx}
                        style={{
                          background: isDrop
                            ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(255, 255, 255, 0.02) 100%)'
                            : isError
                            ? 'linear-gradient(90deg, rgba(239, 68, 68, 0.1) 0%, rgba(255, 255, 255, 0.02) 100%)'
                            : 'rgba(255, 255, 255, 0.025)',
                          border: '1px solid var(--border-subtle)',
                          borderLeft: `4px solid ${borderColor}`,
                          borderRadius: '8px',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: badgeBg,
                                color: badgeColor,
                                border: `1px solid ${borderColor}40`,
                                textTransform: 'uppercase',
                                letterSpacing: '0.3px',
                              }}
                            >
                              {badgeText}
                            </span>
                            <strong style={{ color: isDrop ? '#34d399' : '#ffffff', fontSize: '0.86rem' }}>
                              {evt.monitorName || 'System Radar'}
                            </strong>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            <Clock size={12} />
                            <span>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>

                        <div
                          style={{
                            fontSize: '0.8rem',
                            color: isDrop ? '#e2e8f0' : 'var(--text-secondary)',
                            lineHeight: 1.45,
                            fontFamily: isDrop ? 'inherit' : 'var(--font-mono)',
                            paddingLeft: '2px',
                          }}
                        >
                          {evt.message}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

            {/* Sub-Tab 2: Recent Ticket Drops (Aggregated from all monitors) */}
            {radarSubTab === 'drops' && (
              <div
                style={{
                  minHeight: '420px',
                  maxHeight: '560px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {(() => {
                  const allAlerts = monitors.flatMap((m) =>
                    (m.alerts || []).map((al) => ({
                      ...al,
                      monitorName: m.name,
                      monitorCity: m.city,
                      monitorUrl: m.url,
                    }))
                  );
                  allAlerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

                  if (allAlerts.length === 0) {
                    return (
                      <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '60px 0' }}>
                        <Ticket size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
                        <div>No ticket drops recorded yet across your monitors.</div>
                        <div style={{ fontSize: '0.74rem', marginTop: '6px' }}>
                          When a theatre opens showtimes, detected drops will appear here immediately.
                        </div>
                      </div>
                    );
                  }

                  return (
                    <>
                      {allAlerts.map((al) => {
                        const openings = Array.isArray(al.openings) ? al.openings : [];
                        return (
                          <div
                            key={al.id}
                            style={{
                              background: 'rgba(16, 185, 129, 0.08)',
                              border: '1px solid rgba(16, 185, 129, 0.25)',
                              borderRadius: '8px',
                              padding: '12px 14px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <strong style={{ color: '#ffffff', fontSize: '0.9rem' }}>{al.monitorName}</strong>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>· {al.monitorCity}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                  {new Date(al.createdAt).toLocaleString()}
                                </span>
                                <a
                                  href={al.monitorUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-primary"
                                  style={{ padding: '3px 8px', fontSize: '0.72rem', borderRadius: '4px', textDecoration: 'none' }}
                                >
                                  Book ↗
                                </a>
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {openings.map((op: any, i: number) => (
                                <span
                                  key={i}
                                  style={{
                                    background: 'rgba(16, 185, 129, 0.15)',
                                    color: '#34d399',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    fontSize: '0.74rem',
                                    fontWeight: 600,
                                  }}
                                >
                                  🏛️ {op.theatre || 'Theatre'} {op.showtime ? `· ⏰ ${op.showtime}` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Account & Direct Alert Destination Card */}
          <div className="glass-card" style={{ padding: '24px', height: 'fit-content' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserIcon size={16} color="var(--accent-cyan)" /> Direct Alert Routing
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
        </div>
      )}

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
            {/* 3-Step Guided Wizard Stepper Header */}
            <div className="wizard-stepper">
              <button
                type="button"
                className="wizard-step-item"
                onClick={() => setWizardStep(1)}
              >
                <div className={`wizard-step-circle ${wizardStep === 1 ? 'active' : wizardStep > 1 ? 'completed' : ''}`}>
                  {wizardStep > 1 ? '✓' : '1'}
                </div>
                <div className={`wizard-step-title ${wizardStep === 1 ? 'active' : ''}`}>
                  Target URL
                </div>
              </button>

              <div className={`wizard-step-line ${wizardStep > 1 ? 'completed' : ''}`} />

              <button
                type="button"
                className="wizard-step-item"
                onClick={() => {
                  if (newUrl) setWizardStep(2);
                }}
              >
                <div className={`wizard-step-circle ${wizardStep === 2 ? 'active' : wizardStep > 2 ? 'completed' : ''}`}>
                  {wizardStep > 2 ? '✓' : '2'}
                </div>
                <div className={`wizard-step-title ${wizardStep === 2 ? 'active' : ''}`}>
                  Filters
                </div>
              </button>

              <div className={`wizard-step-line ${wizardStep > 2 ? 'completed' : ''}`} />

              <button
                type="button"
                className="wizard-step-item"
                onClick={() => {
                  if (newUrl) setWizardStep(3);
                }}
              >
                <div className={`wizard-step-circle ${wizardStep === 3 ? 'active' : ''}`}>
                  3
                </div>
                <div className={`wizard-step-title ${wizardStep === 3 ? 'active' : ''}`}>
                  Cadence & Alerts
                </div>
              </button>
            </div>

            <form onSubmit={handleCreateMonitor} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* STEP 1: BMS URL / Share text extraction & Movie Details */}
              {wizardStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!newUrl}
                      onClick={() => setWizardStep(2)}
                    >
                      Next: Choose Filters →
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Filters (Theatres, Dates, Times) */}
              {wizardStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* 🏢 Searchable Multi-Select Dropdown with Checkboxes (Option B) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🏢 Target Theatres ({selectedTheatres.length === 0 ? 'All Theatres' : `${selectedTheatres.length} Selected`})
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {nearestTheatre && (
                      <span style={{ fontSize: '0.7rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Home size={11} /> Nearest: <strong>{nearestTheatre.split(':')[0]}</strong>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTheatres.length === theatreSuggestions.length) {
                          setSelectedTheatres([]);
                        } else {
                          setSelectedTheatres([...theatreSuggestions]);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-cyan)',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      {selectedTheatres.length === theatreSuggestions.length ? 'Clear All' : 'Select All Suggestions'}
                    </button>
                  </div>
                </div>

                {/* Dropdown Search & Toggle Button */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => setIsTheatreDropdownOpen(!isTheatreDropdownOpen)}
                    className="input-field"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      textAlign: 'left',
                      cursor: 'pointer',
                      padding: '8px 12px',
                      fontSize: '0.82rem',
                    }}
                  >
                    <span style={{ color: selectedTheatres.length === 0 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                      {selectedTheatres.length === 0
                        ? 'Select specific theatres or leave blank for All...'
                        : `${selectedTheatres.length} theatre${selectedTheatres.length > 1 ? 's' : ''} selected`}
                    </span>
                    {isTheatreDropdownOpen ? <ChevronUp size={15} color="var(--text-muted)" /> : <ChevronDown size={15} color="var(--text-muted)" />}
                  </button>

                  {/* Dropdown Menu Panel */}
                  {isTheatreDropdownOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        zIndex: 40,
                        background: '#161624',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '10px',
                        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.75)',
                      }}
                    >
                      {/* Search Filter Inside Dropdown */}
                      <div style={{ position: 'relative', marginBottom: '8px' }}>
                        <Search size={13} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                        <input
                          type="text"
                          className="input-field"
                          placeholder="Search theatres in city..."
                          value={theatreSearchQuery}
                          onChange={(e) => setTheatreSearchQuery(e.target.value)}
                          style={{
                            paddingLeft: '30px',
                            paddingTop: '6px',
                            paddingBottom: '6px',
                            fontSize: '0.78rem',
                            background: 'rgba(0, 0, 0, 0.4)',
                          }}
                        />
                      </div>

                      {/* Scrollable Checkbox List */}
                      <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {theatreSuggestions
                          .filter((t) => t.toLowerCase().includes(theatreSearchQuery.toLowerCase()))
                          .map((theatre) => {
                            const isSelected = selectedTheatres.includes(theatre);
                            const isFav = favouriteTheatres.includes(theatre);
                            const isNearest = nearestTheatre === theatre;

                            return (
                              <label
                                key={theatre}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '6px 10px',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  background: isSelected ? 'rgba(6, 182, 212, 0.12)' : 'transparent',
                                  transition: 'background 0.1s ease',
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                                }}
                                onMouseLeave={(e) => {
                                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      if (isSelected) {
                                        setSelectedTheatres((prev) => prev.filter((t) => t !== theatre));
                                      } else {
                                        setSelectedTheatres((prev) => [...prev, theatre]);
                                      }
                                    }}
                                    style={{ accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                                  />
                                  <span
                                    style={{
                                      fontSize: '0.78rem',
                                      color: isSelected ? '#ffffff' : 'var(--text-primary)',
                                      fontWeight: isSelected ? 600 : 400,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {theatre}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    onClick={(e) => toggleFavouriteTheatre(theatre, e)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex' }}
                                    title={isFav ? 'Remove from favourites' : 'Mark favourite'}
                                  >
                                    <Heart size={12} color={isFav ? '#e50914' : 'var(--text-muted)'} fill={isFav ? '#e50914' : 'none'} />
                                  </button>
                                  {isNearest && (
                                    <span title="Nearest to Home" style={{ display: 'inline-flex' }}>
                                      <Home size={11} color="#38bdf8" />
                                    </span>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                      </div>

                      {/* Custom Theatre Add Row inside dropdown */}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                        <input
                          type="text"
                          className="input-field"
                          placeholder="+ Add unlisted theatre name..."
                          value={customTheatreInput}
                          onChange={(e) => setCustomTheatreInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addCustomTheatre();
                            }
                          }}
                          style={{ fontSize: '0.76rem', padding: '6px 10px' }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => addCustomTheatre()}
                          style={{ padding: '6px 12px', fontSize: '0.76rem', whiteSpace: 'nowrap' }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
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
                            background: 'rgba(6, 182, 212, 0.15)',
                            border: '1px solid rgba(6, 182, 212, 0.4)',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            color: '#38bdf8',
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

                {/* Multi-Week Mini Calendar Picker (Option B) */}
                {(() => {
                  const now = new Date();
                  const targetMonthDate = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1);
                  const year = targetMonthDate.getFullYear();
                  const month = targetMonthDate.getMonth();
                  const monthTitle = targetMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sun
                  const todayStr = now.toISOString().slice(0, 10);

                  return (
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        padding: '12px 14px',
                        marginBottom: '10px',
                      }}
                    >
                      {/* Month Header with Navigation */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {monthTitle}
                        </span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            type="button"
                            disabled={calendarMonthOffset <= 0}
                            onClick={() => setCalendarMonthOffset((prev) => Math.max(0, prev - 1))}
                            style={{
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '6px',
                              padding: '4px 6px',
                              color: calendarMonthOffset <= 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                              cursor: calendarMonthOffset <= 0 ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={calendarMonthOffset >= 3}
                            onClick={() => setCalendarMonthOffset((prev) => prev + 1)}
                            style={{
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '6px',
                              padding: '4px 6px',
                              color: calendarMonthOffset >= 3 ? 'var(--text-muted)' : 'var(--text-primary)',
                              cursor: calendarMonthOffset >= 3 ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Day of Week Headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '6px' }}>
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((dw) => (
                          <span key={dw} style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                            {dw}
                          </span>
                        ))}
                      </div>

                      {/* Calendar Day Grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                        {/* Leading Empty Cells */}
                        {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                          <div key={`empty-${idx}`} />
                        ))}

                        {/* Month Days */}
                        {Array.from({ length: daysInMonth }).map((_, idx) => {
                          const dayNum = idx + 1;
                          const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                          const isPast = dStr < todayStr;
                          const isToday = dStr === todayStr;
                          const isSelected = selectedDates.includes(dStr);

                          const isOutOfRange =
                            isPast ||
                            (movieFirstDate && dStr < movieFirstDate) ||
                            (movieLastDate && dStr > movieLastDate);

                          return (
                            <button
                              key={dStr}
                              type="button"
                              disabled={Boolean(isOutOfRange)}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedDates((prev) => prev.filter((item) => item !== dStr));
                                } else {
                                  setSelectedDates((prev) => [...prev, dStr].sort());
                                }
                                setDateOutOfRangeError(null);
                              }}
                              style={{
                                padding: '6px 2px',
                                borderRadius: '6px',
                                border: isSelected
                                  ? '1px solid var(--accent-cyan)'
                                  : isToday
                                  ? '1px solid var(--bms-red)'
                                  : '1px solid transparent',
                                background: isSelected
                                  ? 'rgba(6, 182, 212, 0.22)'
                                  : isToday
                                  ? 'rgba(229, 9, 20, 0.1)'
                                  : 'transparent',
                                color: isSelected
                                  ? '#38bdf8'
                                  : isToday
                                  ? 'var(--bms-red)'
                                  : isOutOfRange
                                  ? 'var(--text-muted)'
                                  : 'var(--text-primary)',
                                fontSize: '0.76rem',
                                fontWeight: isSelected || isToday ? 700 : 400,
                                cursor: isOutOfRange ? 'not-allowed' : 'pointer',
                                opacity: isOutOfRange ? 0.3 : 1,
                                transition: 'all 0.1s ease',
                              }}
                            >
                              {dayNum}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

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
                    style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}
                  >
                    + Add Other Date
                  </button>
                </div>

                {selectedDates.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
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
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                        }}
                        title="Click to remove"
                      >
                        📅 {d} ✕
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* ⏰ Dual Range Slider — Show Time Window */}
              <div className="time-range-section">
                <div className="time-range-header">
                  <span className="time-range-label">⏰ Show Time Window</span>
                  <span className="time-range-display">
                    {sliderFrom === 0 && sliderTo === 48
                      ? 'Any time'
                      : `${slotLabel(sliderFrom)} – ${slotLabel(sliderTo)}`}
                  </span>
                </div>

                {/* Dual-thumb slider track */}
                <div className="dual-slider-wrapper">
                  <div
                    className="dual-slider-track-fill"
                    style={{
                      left: `${(sliderFrom / 48) * 100}%`,
                      right: `${100 - (sliderTo / 48) * 100}%`,
                    }}
                  />
                  {/* FROM thumb */}
                  <input
                    type="range"
                    min={0}
                    max={48}
                    step={1}
                    value={sliderFrom}
                    className="dual-slider-input dual-slider-from"
                    onChange={(e) => {
                      const val = Math.min(Number(e.target.value), sliderTo - 1);
                      setSliderFrom(val);
                      setTimeFrom(slotToTime(val));
                      setActiveTimePreset(null);
                    }}
                  />
                  {/* TO thumb */}
                  <input
                    type="range"
                    min={0}
                    max={48}
                    step={1}
                    value={sliderTo}
                    className="dual-slider-input dual-slider-to"
                    onChange={(e) => {
                      const val = Math.max(Number(e.target.value), sliderFrom + 1);
                      setSliderTo(val);
                      setTimeTo(slotToTime(val));
                      setActiveTimePreset(null);
                    }}
                  />
                </div>

                {/* Hour tick marks */}
                <div className="dual-slider-ticks">
                  {[0, 6, 12, 18, 24].map((h) => (
                    <span key={h} className="dual-slider-tick">
                      {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
                    </span>
                  ))}
                </div>

                {/* Quick preset pills */}
                <div className="time-preset-pills">
                  {[
                    { label: '🌅 Morning', from: 0, to: 24, fromStr: '', toStr: '12:00' },
                    { label: '☀️ Matinee', from: 24, to: 32, fromStr: '12:00', toStr: '16:00' },
                    { label: '🌆 Evening', from: 32, to: 40, fromStr: '16:00', toStr: '20:00' },
                    { label: '🌙 Night', from: 40, to: 48, fromStr: '20:00', toStr: '' },
                    { label: '🕐 Any Time', from: 0, to: 48, fromStr: '', toStr: '' },
                  ].map(({ label, from, to, fromStr, toStr }) => (
                    <button
                      key={label}
                      type="button"
                      className={`time-preset-pill ${activeTimePreset === label ? 'active' : ''}`}
                      onClick={() => {
                        if (activeTimePreset === label) {
                          setSliderFrom(0); setSliderTo(48);
                          setTimeFrom(''); setTimeTo('');
                          setActiveTimePreset(null);
                        } else {
                          setSliderFrom(from); setSliderTo(to);
                          setTimeFrom(fromStr); setTimeTo(toStr);
                          setActiveTimePreset(label);
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(1)}>
                  ← Back: Target URL
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setWizardStep(3)}>
                  Next: Cadence & Alerts →
                </button>
              </div>
            </div>
          )}

            {/* STEP 3: Cadence & Alert Routing */}
            {wizardStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Summary banner of what is being monitored */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Configured Target Summary:
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {newName || 'Movie Target'} · <span style={{ color: 'var(--text-secondary)' }}>{newCity}</span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {selectedTheatres.length === 0 ? 'All Theatres' : `${selectedTheatres.length} Selected Theatres`} · {selectedDates.length === 0 ? 'All Dates' : `${selectedDates.length} Specific Dates`}
                  </div>
                </div>

                {/* Check Frequency (Option B: Interactive Stepper Slider) */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      🔄 Check Interval (Radar Cadence)
                    </label>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        color: newInterval === 15 ? '#f87171' : newInterval === 30 ? '#38bdf8' : '#34d399',
                        background: newInterval === 15 ? 'rgba(229, 9, 20, 0.15)' : 'rgba(6, 182, 212, 0.15)',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {newInterval === 15
                        ? '⚡ 15s (Lightning)'
                        : newInterval === 30
                        ? '🎯 30s (Balanced)'
                        : newInterval === 60
                        ? '⏱️ 60s (Standard)'
                        : '☕ 5m (Relaxed)'}
                    </span>
                  </div>

                  {(() => {
                    const cadenceSteps = [15, 30, 60, 300];
                    const currentIndex = cadenceSteps.indexOf(newInterval) !== -1 ? cadenceSteps.indexOf(newInterval) : 1;

                    return (
                      <div>
                        <input
                          type="range"
                          min={0}
                          max={3}
                          step={1}
                          value={currentIndex}
                          onChange={(e) => {
                            const idx = Number(e.target.value);
                            setNewInterval(cadenceSteps[idx]);
                          }}
                          style={{
                            width: '100%',
                            accentColor: 'var(--bms-red)',
                            cursor: 'pointer',
                            marginTop: '4px',
                          }}
                        />

                        {/* Step Tick Labels */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '8px', textAlign: 'center' }}>
                          {[
                            { label: '15s', tag: 'Fastest', val: 15 },
                            { label: '30s', tag: 'Balanced', val: 30 },
                            { label: '60s', tag: 'Standard', val: 60 },
                            { label: '5m', tag: 'Low Power', val: 300 },
                          ].map((step) => {
                            const isCurrent = newInterval === step.val;
                            return (
                              <button
                                key={step.val}
                                type="button"
                                onClick={() => setNewInterval(step.val)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  padding: 0,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '0.78rem',
                                    fontWeight: isCurrent ? 800 : 500,
                                    color: isCurrent ? 'var(--text-primary)' : 'var(--text-muted)',
                                  }}
                                >
                                  {step.label}
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.66rem',
                                    color: isCurrent ? 'var(--bms-red)' : 'var(--text-muted)',
                                  }}
                                >
                                  {step.tag}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
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

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(2)}>
                    ← Back: Filters
                  </button>
                  <button type="submit" className="btn btn-primary">
                    <ShieldCheck size={16} /> Start Monitoring
                  </button>
                </div>
              </div>
            )}
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
              <div
                style={{
                  position: 'relative',
                  paddingLeft: '28px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                }}
              >
                {/* Continuous vertical timeline connector bar */}
                <div
                  style={{
                    position: 'absolute',
                    left: '11px',
                    top: '12px',
                    bottom: '16px',
                    width: '2px',
                    background: 'linear-gradient(180deg, #10b981 0%, rgba(6, 182, 212, 0.4) 100%)',
                    borderRadius: '1px',
                  }}
                />

                {selectedMonitorForHistory.alerts.map((al, idx) => {
                  const openings = Array.isArray(al.openings) ? al.openings : [];
                  return (
                    <div key={al.id} style={{ position: 'relative' }}>
                      {/* Timeline Node Circle */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '-28px',
                          top: '14px',
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: idx === 0 ? '#10b981' : '#06b6d4',
                          border: '2px solid #0f0f1b',
                          boxShadow: idx === 0 ? '0 0 8px #10b981' : 'none',
                          zIndex: 2,
                        }}
                      />

                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          borderRadius: '12px',
                          padding: '16px',
                          border: '1px solid var(--border-subtle)',
                          borderLeft: `4px solid ${idx === 0 ? '#10b981' : '#06b6d4'}`,
                          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
                        }}
                      >
                        {/* Alert Card Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                color: idx === 0 ? '#34d399' : '#38bdf8',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <Ticket size={16} /> {openings.length} Ticket Drop{openings.length > 1 ? 's' : ''} Detected
                            </span>
                            {idx === 0 && (
                              <span
                                style={{
                                  fontSize: '0.66rem',
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: '8px',
                                  background: 'rgba(16, 185, 129, 0.2)',
                                  color: '#34d399',
                                  border: '1px solid rgba(16, 185, 129, 0.4)',
                                  textTransform: 'uppercase',
                                }}
                              >
                                Latest
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            {new Date(al.createdAt).toLocaleString()}
                          </span>
                        </div>

                        {/* Delivery Channel Badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Dispatched to:</span>
                          {al.channels.map((ch) => (
                            <span
                              key={ch}
                              style={{
                                background: 'rgba(6, 182, 212, 0.12)',
                                color: '#38bdf8',
                                border: '1px solid rgba(6, 182, 212, 0.3)',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              {ch === 'EMAIL' ? <Mail size={11} /> : <MessageSquare size={11} />}
                              {ch}
                            </span>
                          ))}
                        </div>

                        {/* Openings Listing with Theatre and Showtime Cards */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                          {openings.map((op: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                background: 'rgba(0, 0, 0, 0.3)',
                                padding: '10px 12px',
                                borderRadius: '8px',
                                border: '1px solid rgba(255, 255, 255, 0.05)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '12px',
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                                  🏛️ {op.theatre}
                                </div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                  📅 {op.date} · ⏰ {op.showtime}
                                </div>
                              </div>
                              <span
                                style={{
                                  background: 'rgba(16, 185, 129, 0.15)',
                                  color: '#34d399',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {op.change || 'AVAILABLE'}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Direct Booking CTA */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '6px' }}>
                          <a
                            href={selectedMonitorForHistory.url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-primary"
                            style={{
                              padding: '6px 14px',
                              fontSize: '0.78rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              textDecoration: 'none',
                            }}
                          >
                            Book Tickets on BookMyShow <ExternalLink size={12} />
                          </a>
                        </div>
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
              {/* Section 1: Gmail SMTP Alert Service */}
              <div
                style={{
                  background: 'linear-gradient(180deg, rgba(229, 9, 20, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)',
                  border: '1px solid rgba(229, 9, 20, 0.25)',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(229, 9, 20, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Mail size={16} color="var(--bms-red)" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Gmail SMTP Notification Service</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Delivers instant ticket alerts to your inbox</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.72rem', color: notifConfig.isEmailConfigured ? '#34d399' : '#f87171', fontWeight: 600 }}>
                      {notifConfig.isEmailConfigured ? '✓ Active & Ready' : '⚠ Missing Credentials'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '0.76rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Sender Gmail Address
                    </label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="youraccount@gmail.com"
                      value={cfgEmailFrom}
                      onChange={(e) => setCfgEmailFrom(e.target.value)}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '0.76rem', fontWeight: 600 }}>
                        Google App Password (16-characters)
                      </label>
                      <a
                        href="https://myaccount.google.com/apppasswords"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent-cyan)', fontSize: '0.72rem', textDecoration: 'underline' }}
                      >
                        Generate App Password ↗
                      </a>
                    </div>
                    <input
                      type="password"
                      className="input-field"
                      placeholder={notifConfig.hasAppPassword ? '•••••••••••••••• (Saved — leave blank to keep)' : 'xxxx xxxx xxxx xxxx'}
                      value={cfgEmailAppPassword}
                      onChange={(e) => setCfgEmailAppPassword(e.target.value)}
                    />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Requires 2-Step Verification enabled on your Google Account &rarr; Security &rarr; App Passwords.
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                      Default Recipient Email (Where ticket alerts are sent)
                    </label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="e.g. yourpersonal@gmail.com"
                      value={cfgDefaultEmailTo}
                      onChange={(e) => setCfgDefaultEmailTo(e.target.value)}
                    />
                  </div>

                  <div style={{ paddingTop: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: '100%', fontSize: '0.8rem', padding: '8px 12px', justifyContent: 'center' }}
                      onClick={() => handleSendTestAlert(cfgDefaultEmailTo || cfgEmailFrom || currentUser?.email)}
                    >
                      <Bell size={14} /> Send Test Email
                    </button>
                    {testStatus && (
                      <div
                        style={{
                          fontSize: '0.78rem',
                          textAlign: 'center',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          marginTop: '6px',
                          background: testStatus.startsWith('✅') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: testStatus.startsWith('✅') ? '#34d399' : '#fca5a5',
                        }}
                      >
                        {testStatus}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 2: Nearest Theatre to Home Preferences */}
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

            {/* Security Pill & Info Banner */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '12px',
                    background: 'rgba(16, 185, 129, 0.18)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    letterSpacing: '0.3px',
                  }}
                >
                  <ShieldCheck size={12} /> END-TO-END ISOLATED
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Zero multi-tenant cross-talk
              </span>
            </div>

            {/* Key Card Presentation */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(6, 182, 212, 0.05) 100%)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Key size={16} color="#34d399" />
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Active Device Vault Key
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    navigator.clipboard.writeText(vaultKey);
                    setVaultCopied(true);
                    setTimeout(() => setVaultCopied(false), 2000);
                  }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.74rem',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  {vaultCopied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{vaultCopied ? 'Copied!' : 'Copy Key'}</span>
                </button>
              </div>

              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.88rem',
                  color: '#34d399',
                  wordBreak: 'break-all',
                  letterSpacing: '0.5px',
                  userSelect: 'all',
                }}
              >
                {vaultKey}
              </div>

              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.4 }}>
                Monitors, credentials, and alerts configured in this session are safely encrypted and isolated under this unique vault.
              </div>
            </div>

            {/* Collapsible Sync Device Panel */}
            <div
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                overflow: 'hidden',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <button
                type="button"
                onClick={() => setShowVaultSyncAccordion(!showVaultSyncAccordion)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔄 Sync with another device (Laptop ↔ Phone)</span>
                </div>
                {showVaultSyncAccordion ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
              </button>

              {showVaultSyncAccordion && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: 1.4 }}>
                    To share the same monitors across your laptop and phone, copy the key from your other device and paste it below:
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Paste Vault Key (e.g. vlt_...)"
                      value={syncInputKey}
                      onChange={(e) => {
                        setSyncInputKey(e.target.value);
                        setVaultSyncFeedback(null);
                      }}
                      style={{
                        flex: 1,
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                        fontSize: '0.82rem',
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!syncInputKey.trim()}
                      onClick={async () => {
                        const cleaned = syncInputKey.trim();
                        if (cleaned) {
                          localStorage.setItem('bms_vault_key', cleaned);
                          setVaultKey(cleaned);
                          try {
                            const res = await fetch('/api/monitors', {
                              headers: { 'x-vault-key': cleaned },
                            });
                            if (res.ok) {
                              const data = await res.json();
                              const count = Array.isArray(data) ? data.length : 0;
                              setVaultSyncFeedback({
                                success: true,
                                message: `✓ Linked successfully! ${count} monitor${count === 1 ? '' : 's'} active in this vault.`,
                              });
                              setMonitors(data);
                            } else {
                              setVaultSyncFeedback({
                                success: true,
                                message: '✓ Key saved and linked to device.',
                              });
                            }
                          } catch {
                            setVaultSyncFeedback({
                              success: true,
                              message: '✓ Key saved and linked to device.',
                            });
                          }
                        }
                      }}
                      style={{ padding: '8px 14px', fontSize: '0.78rem' }}
                    >
                      Link &amp; Sync
                    </button>
                  </div>

                  {/* Option B: In-Modal Success / Count Feedback Badge */}
                  {vaultSyncFeedback && (
                    <div
                      style={{
                        marginTop: '10px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: vaultSyncFeedback.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        border: `1px solid ${vaultSyncFeedback.success ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
                        color: vaultSyncFeedback.success ? '#34d399' : '#f87171',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>{vaultSyncFeedback.message}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions: Reset Fresh Vault */}
            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                  color: 'var(--text-muted)',
                  fontSize: '0.76rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Reset / Generate New Key
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowVaultModal(false)}
                style={{ padding: '6px 16px', fontSize: '0.8rem' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Tab Navigation (Option B: FAB + 3-Tab Bar) */}
      <nav className="mobile-tab-bar" style={{ alignItems: 'center', justifyContent: 'space-around', padding: '0 12px' }}>
        {/* Tab 1: Monitors */}
        <button
          className={`mobile-tab-btn ${activeTab === 'monitors' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('monitors');
            fetchMonitors();
          }}
        >
          <Film size={18} />
          <span>Monitors</span>
        </button>

        {/* Central Floating Action Button (FAB) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <button
            className="mobile-fab-btn"
            onClick={() => setShowAddModal(true)}
            title="Create New Monitor"
            aria-label="Add Monitor"
          >
            <Plus size={24} />
          </button>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px', fontWeight: 600 }}>
            New
          </span>
        </div>

        {/* Tab 2: Radar Feed */}
        <button
          className={`mobile-tab-btn ${activeTab === 'radar' ? 'active' : ''}`}
          onClick={() => setActiveTab('radar')}
        >
          <Radio size={18} color={activeTab === 'radar' ? 'var(--bms-red)' : 'var(--accent-cyan)'} />
          <span>Radar</span>
        </button>

        {/* Tab 3: Settings */}
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
