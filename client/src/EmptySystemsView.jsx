import React from 'react';
import { RefreshCw, MapPin, Activity, Zap, Users, TrendingDown, TrendingUp, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';

const tooltipStyle = { backgroundColor: '#1a1a2e', border: '1px solid #444' };

function EmptySystemsView({
  filteredSystems, loading, selectedSystem, setSelectedSystem,
  fetchSystemHistory, systemHistory, trendingChanges,
  activeTab, setActiveTab, getSecurityClass, getActivityLevel
}) {
  const chartData = filteredSystems.slice(0, 10).map(s => ({
    name: s.name,
    jumps: s.jumps,
    kills: s.total_kills
  }));

  const securityDistribution = [
    { name: 'High Sec', value: filteredSystems.filter(s => s.security_status >= 0.5).length, color: '#4ade80' },
    { name: 'Low Sec', value: filteredSystems.filter(s => s.security_status >= 0 && s.security_status < 0.5).length, color: '#fbbf24' },
    { name: 'Null Sec', value: filteredSystems.filter(s => s.security_status < 0).length, color: '#ef4444' }
  ];

  return (
    <>
      <div className="tabs">
        <button className={`tab ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
          Live Data
        </button>
        <button className={`tab ${activeTab === 'historical' ? 'active' : ''}`} onClick={() => setActiveTab('historical')}>
          Historical Trends
        </button>
      </div>

      <div className="content-grid">
        {activeTab === 'live' ? (
          <>
            <div className="charts-section">
              <div className="chart-card">
                <h3>Lowest Activity Systems</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={70} stroke="#888" />
                    <YAxis stroke="#888" />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="jumps" fill="#8b5cf6" name="Jumps" />
                    <Bar dataKey="kills" fill="#ef4444" name="Kills" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <h3>Security Distribution</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={securityDistribution} cx="50%" cy="50%" outerRadius={80} dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}>
                      {securityDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="systems-section">
              <div className="section-header">
                <h2>Systems ({filteredSystems.length} results)</h2>
                <div className="legend">
                  <span className="legend-item high-sec">High Sec</span>
                  <span className="legend-item low-sec">Low Sec</span>
                  <span className="legend-item null-sec">Null Sec</span>
                </div>
              </div>

              {loading ? (
                <div className="loading">
                  <RefreshCw className="spinning" size={32} />
                  <p>Loading system data...</p>
                </div>
              ) : (
                <div className="systems-grid">
                  {filteredSystems.map(system => {
                    const activityLevel = getActivityLevel(system.activity_score);
                    return (
                      <div
                        key={system.system_id}
                        className={`system-card ${selectedSystem?.system_id === system.system_id ? 'selected' : ''}`}
                        onClick={() => { setSelectedSystem(system); fetchSystemHistory(system.system_id); }}
                      >
                        <div className="system-header">
                          <h3>{system.name}</h3>
                          <span className={`security-badge ${getSecurityClass(system.security_status)}`}>
                            {system.security_status.toFixed(1)}
                          </span>
                        </div>
                        <div className="system-info">
                          <div className="info-row"><MapPin size={14} /><span>{system.region} / {system.constellation}</span></div>
                          <div className="info-row"><Activity size={14} /><span>Jumps: {system.jumps}</span></div>
                          <div className="info-row"><Zap size={14} /><span>Kills: {system.total_kills} (NPC: {system.npc_kills})</span></div>
                        </div>
                        <div className={`activity-indicator ${activityLevel.class}`}>{activityLevel.label} Activity</div>
                        {system.sovereignty && system.sovereignty.length > 0 && (
                          <div className="sovereignty-info"><Users size={14} /><span>Sovereignty Claimed</span></div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="historical-section">
            {trendingChanges.length > 0 && (
              <div className="trending-card">
                <h3><TrendingUp size={20} /> Top Activity Changes (24h)</h3>
                <div className="trending-list">
                  {trendingChanges.slice(0, 10).map(change => (
                    <div key={change.system_id} className="trending-item">
                      <div className="trending-info">
                        <span className="system-name">{change.system_name}</span>
                        <span className={`change-percent ${change.change_percent > 0 ? 'increase' : 'decrease'}`}>
                          {change.change_percent > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          {Math.abs(change.change_percent).toFixed(1)}%
                        </span>
                      </div>
                      <div className="trending-values">
                        <span>Previous: {change.previous_avg?.toFixed(1) || 0}</span>
                        <span>Current: {change.recent_avg?.toFixed(1) || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {systemHistory && selectedSystem && (
              <div className="history-card">
                <h3><Clock size={20} /> 7-Day History: {selectedSystem.name}</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={systemHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="date" stroke="#888" />
                    <YAxis stroke="#888" />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="avg_jumps" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} name="Avg Jumps" />
                    <Area type="monotone" dataKey="avg_kills" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} name="Avg Kills" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="instructions-card">
              <h3>Historical Data Collection</h3>
              <p>The system automatically collects activity data every hour. Historical trends help identify:</p>
              <ul>
                <li>Systems with consistently low activity</li>
                <li>Activity patterns by time of day</li>
                <li>Sudden changes in system usage</li>
                <li>Long-term sovereignty changes</li>
              </ul>
              <p>Click on any system in the Live Data tab to view its historical activity.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default EmptySystemsView;
