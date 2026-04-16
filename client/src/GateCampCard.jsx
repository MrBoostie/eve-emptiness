import React from 'react';
import { MapPin, Activity, Zap, ArrowRight } from 'lucide-react';

const TOPOLOGY_COLORS = {
  'dead-end': '#4ade80',
  'pipe': '#fbbf24',
  'junction': '#f97316',
  'hub': '#ef4444'
};

const SEC_CLASS_LABELS = {
  highsec: 'Hi',
  lowsec: 'Lo',
  nullsec: 'Null'
};

function GateCampCard({ system, selected, onClick, getSecurityClass }) {
  const topoColor = TOPOLOGY_COLORS[system.topology_type] || '#888';
  const transitions = system.security_transitions || [];
  const connected = system.connected_systems || [];

  return (
    <div className={`system-card gate-camp-card ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="system-header">
        <h3>{system.system_name}</h3>
        <span className={`security-badge ${getSecurityClass(system.security_status)}`}>
          {system.security_status.toFixed(1)}
        </span>
      </div>

      <div className="gate-camp-badges">
        <span className="topology-badge" style={{ borderColor: topoColor, color: topoColor }}>
          {system.topology_type}
        </span>
        {transitions.length > 0 && transitions.slice(0, 2).map((t, i) => (
          <span key={i} className="sec-transition-badge">
            {SEC_CLASS_LABELS[t.from_sec_class] || t.from_sec_class}
            <ArrowRight size={10} />
            {SEC_CLASS_LABELS[t.to_sec_class] || t.to_sec_class}
          </span>
        ))}
      </div>

      <div className="bottleneck-row">
        <span className="bottleneck-label">Bottleneck</span>
        <div className="bottleneck-bar-track">
          <div className="bottleneck-bar-fill" style={{ width: `${Math.min(system.bottleneck_score * 10000, 100)}%` }} />
        </div>
        <span className="bottleneck-value">{(system.bottleneck_score * 100).toFixed(3)}%</span>
      </div>

      <div className="gate-camp-score-row">
        <span>Camp Score</span>
        <span className="gate-camp-score">{system.gate_camp_score?.toFixed(1) || '0.0'}</span>
      </div>

      <div className="system-info">
        <div className="info-row"><MapPin size={14} /><span>{system.region} / {system.constellation}</span></div>
        <div className="info-row"><Activity size={14} /><span>Jumps: {system.jumps} | Gates: {system.gate_count}</span></div>
        <div className="info-row"><Zap size={14} /><span>Ship Kills: {system.ship_kills} | Pod: {system.pod_kills}</span></div>
      </div>

      {connected.length > 0 && (
        <div className="connected-systems-list">
          <span className="connected-label">Connected:</span>
          {connected.map(c => (
            <span key={c.system_id} className={`connected-system ${getSecurityClass(c.security_status)}`}>
              {c.system_name} ({c.security_status.toFixed(1)})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default GateCampCard;
