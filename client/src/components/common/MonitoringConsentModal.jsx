import React from 'react';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(2, 6, 23, 0.76)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  zIndex: 1200,
};

const cardStyle = {
  width: 'min(100%, 540px)',
  borderRadius: 24,
  border: '1px solid rgba(71, 85, 105, 0.9)',
  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.96))',
  boxShadow: '0 32px 80px rgba(2, 6, 23, 0.45)',
  padding: '1.5rem',
  color: '#e2e8f0',
};

const buttonRowStyle = {
  display: 'flex',
  gap: '0.75rem',
  flexWrap: 'wrap',
  marginTop: '1.25rem',
};

export default function MonitoringConsentModal({
  open,
  loading,
  error,
  sessionLabel = 'practice session',
  warningLimit = 3,
  onAccept,
  onDecline,
  onFallback,
}) {
  if (!open) return null;

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="monitoring-consent-title">
      <div style={cardStyle}>
        <p style={{ margin: 0, color: '#60a5fa', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.78rem' }}>
          Camera Monitoring
        </p>
        <h2 id="monitoring-consent-title" style={{ margin: '0.45rem 0 0', color: '#f8fafc', fontSize: '1.7rem' }}>
          Camera access is required for this {sessionLabel}.
        </h2>
        <p style={{ margin: '0.85rem 0 0', color: '#cbd5e1', lineHeight: 1.7 }}>
          We use your webcam only while this session is active to monitor suspicious behavior such as looking away,
          missing faces, or multiple faces. Raw video is not stored by default. Alerts and metadata may be logged for review.
        </p>
        <div
          style={{
            marginTop: '1rem',
            padding: '0.95rem 1rem',
            borderRadius: 18,
            background: 'rgba(30, 41, 59, 0.82)',
            border: '1px solid rgba(96, 165, 250, 0.22)',
            color: '#bfdbfe',
            lineHeight: 1.65,
          }}
        >
          <strong style={{ color: '#eff6ff' }}>Live warning policy:</strong> this session can continue, but it will be flagged after {warningLimit} warning{warningLimit === 1 ? '' : 's'}.
        </div>
        {error ? (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.85rem 0.95rem',
              borderRadius: 16,
              background: 'rgba(127, 29, 29, 0.38)',
              border: '1px solid rgba(248, 113, 113, 0.34)',
              color: '#fecaca',
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        ) : null}
        <div style={buttonRowStyle}>
          <button
            onClick={onAccept}
            disabled={loading}
            style={{
              border: 'none',
              borderRadius: 14,
              padding: '0.9rem 1.15rem',
              background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: '#fff',
              fontWeight: 800,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Requesting Camera...' : 'Allow Camera and Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
