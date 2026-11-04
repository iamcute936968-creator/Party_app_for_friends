import React from 'react';

const states = {
  connecting: {
    label: 'Connecting',
    detail: 'Connecting to live room updates...',
    color: 'text-amber-300',
  },
  connected: { label: 'Connected', color: 'text-green-400' },
  reconnecting: {
    label: 'Reconnecting',
    detail: 'Reconnecting automatically; room updates may be out of date.',
    color: 'text-amber-300',
  },
  unavailable: {
    label: 'Connection unavailable',
    detail: 'Refresh the page to try again.',
    color: 'text-red-300',
  },
};

export default function ConnectionStatus({ status }) {
  const current = Object.hasOwn(states, status) ? states[status] : states.connecting;

  return (
    <div role="status" aria-label="Live room connection" aria-live="polite" aria-atomic="true"
      className={`connection-status connection-status-${Object.hasOwn(states, status) ? status : 'connecting'}`}>
      <span className="connection-status-label">
        <span aria-hidden="true" className="connection-dot" />
        Live connection: {current.label}
      </span>
      {current.detail && <span className="connection-status-detail">{current.detail}</span>}
    </div>
  );
}
