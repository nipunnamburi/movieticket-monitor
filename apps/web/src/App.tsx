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
} from 'lucide-react';
import { LiveEventPayload } from '@bms/shared';

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
  telegramChatId?: string | null;
  discordWebhookUrl?: string | null;
  alerts: Array<{
    id: string;
    openings: any;
    channels: string[];
    createdAt: string;
  }>;
}

export default function App() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<LiveEventPayload[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // New Monitor Form state
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newInterval, setNewInterval] = useState(30);
  const [newTheatres, setNewTheatres] = useState('');
  const [newDates, setNewDates] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [isParsing, setIsParsing] = useState(false);

  // Notification Test state
  const [testChannel, setTestChannel] = useState<'TELEGRAM' | 'DISCORD'>('TELEGRAM');
  const [testTarget, setTestTarget] = useState('');
  const [testStatus, setTestStatus] = useState<string | null>(null);

  // Fetch Monitors
  const fetchMonitors = async () => {
    try {
      const res = await fetch('/api/monitors');
      if (res.ok) {
        const data = await res.json();
        setMonitors(data);
      }
    } catch (err) {
      console.error('Error loading monitors:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitors();

    // SSE Stream
    const eventSource = new EventSource('/api/events');
    eventSource.onopen = () => setIsConnected(true);
    eventSource.onerror = () => setIsConnected(false);

    eventSource.onmessage = (e) => {
      try {
        const payload: LiveEventPayload = JSON.parse(e.data);
        setLiveEvents((prev) => [payload, ...prev.slice(0, 49)]);

        // Refresh monitor stats on check completion or ticket drops
        if (payload.type === 'CHECK_COMPLETED' || payload.type === 'TICKET_DROP') {
          fetchMonitors();
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    return () => eventSource.close();
  }, []);

  const handleUrlBlur = async () => {
    if (!newUrl || newName) return;
    setIsParsing(true);
    try {
      const res = await fetch('/api/clean-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewUrl(data.url);
        setNewName(data.name);
        setNewCity(data.city);
      }
    } catch (err) {
      console.warn('URL auto-detect failed:', err);
    } finally {
      setIsParsing(false);
    }
  };

  const handleCreateMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        url: newUrl,
        name: newName,
        city: newCity,
        checkIntervalSec: Number(newInterval),
        filterTheatres: newTheatres
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        filterDates: newDates
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean),
        telegramChatId: telegramChatId || undefined,
        discordWebhookUrl: discordWebhookUrl || undefined,
      };

      const res = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setShowAddModal(false);
        setNewUrl('');
        setNewName('');
        setNewCity('');
        setNewTheatres('');
        setNewDates('');
        fetchMonitors();
      }
    } catch (err) {
      console.error('Error creating monitor:', err);
    }
  };

  const handleTrigger = async (id: string) => {
    await fetch(`/api/monitors/${id}/trigger`, { method: 'POST' });
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'paused' : 'active';
    await fetch(`/api/monitors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    fetchMonitors();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this monitor?')) return;
    await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
    fetchMonitors();
  };

  const handleSendTestAlert = async () => {
    if (!testTarget) return;
    setTestStatus('Dispatching test...');
    try {
      const res = await fetch('/api/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: testChannel, target: testTarget }),
      });
      const data = await res.json();
      setTestStatus(res.ok ? '✅ Sent successfully!' : `❌ Error: ${data.message || 'Failed'}`);
    } catch (err: any) {
      setTestStatus(`❌ ${err.message}`);
    }
    setTimeout(() => setTestStatus(null), 5000);
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 20px' }}>
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
              Real-time ticket opening radar with BullMQ & instant multi-channel alerts
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className={`badge ${isConnected ? 'badge-active' : 'badge-alert'}`}>
            <span className="pulse-dot" />
            {isConnected ? 'SSE STREAM ACTIVE' : 'DISCONNECTED'}
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> New Monitor
          </button>
        </div>
      </header>

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
                      {m.filterTheatres.map((t) => (
                        <span
                          key={t}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          🏛️ {t}
                        </span>
                      ))}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                      <Bell size={14} color="var(--accent-green)" />
                      <span>{m.alerts.length} ticket alerts dispatched</span>
                    </div>
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

          {/* Quick Notification Dispatch Tester */}
          <div className="glass-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Send size={16} color="var(--bms-red)" /> Test Notification Channels
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`btn ${testChannel === 'TELEGRAM' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '6px' }}
                  onClick={() => setTestChannel('TELEGRAM')}
                >
                  Telegram
                </button>
                <button
                  type="button"
                  className={`btn ${testChannel === 'DISCORD' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, padding: '6px' }}
                  onClick={() => setTestChannel('DISCORD')}
                >
                  Discord
                </button>
              </div>

              <input
                className="input-field"
                placeholder={testChannel === 'TELEGRAM' ? 'Telegram Chat ID (e.g. 12345678)' : 'Discord Webhook URL'}
                value={testTarget}
                onChange={(e) => setTestTarget(e.target.value)}
              />

              <button className="btn btn-secondary" onClick={handleSendTestAlert} style={{ width: '100%' }}>
                <Send size={14} /> Send Sample Alert
              </button>

              {testStatus && (
                <div style={{ fontSize: '0.8rem', textAlign: 'center', marginTop: '4px' }}>{testStatus}</div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Add Monitor Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px',
          }}
        >
          <div className="glass-card" style={{ maxWidth: '540px', width: '100%', padding: '28px' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '6px' }}>Add Target Monitor</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Paste any BookMyShow movie or event URL. We will auto-extract title and venue details.
            </p>

            <form onSubmit={handleCreateMonitor} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  BookMyShow URL *
                </label>
                <input
                  className="input-field"
                  placeholder="https://in.bookmyshow.com/movies/hyderabad/..."
                  required
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onBlur={handleUrlBlur}
                />
                {isParsing && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginTop: '4px', display: 'block' }}>
                    Auto-detecting details...
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Movie / Event Title
                  </label>
                  <input
                    className="input-field"
                    placeholder="e.g. Dune: Part Two"
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
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Frequency (seconds)
                  </label>
                  <input
                    type="number"
                    min={10}
                    className="input-field"
                    value={newInterval}
                    onChange={(e) => setNewInterval(Number(e.target.value))}
                  />
                </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Telegram Chat ID (optional)
                  </label>
                  <input
                    className="input-field"
                    placeholder="e.g. 192837465"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Discord Webhook URL (optional)
                  </label>
                  <input
                    className="input-field"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={discordWebhookUrl}
                    onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Filter Specific Theatres (comma-separated, optional)
                </label>
                <input
                  className="input-field"
                  placeholder="e.g. Prasads IMAX, Forum Sujana Mall"
                  value={newTheatres}
                  onChange={(e) => setNewTheatres(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Filter Dates (comma-separated, optional)
                </label>
                <input
                  className="input-field"
                  placeholder="e.g. Fri, 12 Sep, Sat, 13 Sep"
                  value={newDates}
                  onChange={(e) => setNewDates(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
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
    </div>
  );
}
