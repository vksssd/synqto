// ─── P2P Topology & Network Sync Card ───

import React, { useState, useEffect } from 'react';
import { Network } from 'lucide-react';
import { TopologyService, TopologyState } from '@/core/network/topology.service';
import { SignalingService } from '@/core/network/signaling.service';

export const SyncCard: React.FC = () => {
  const topology = TopologyService.getInstance();
  const signaling = SignalingService.getInstance();
  const [state, setState] = useState<TopologyState>(topology.getState());
  const [isSignalingConnected, setIsSignalingConnected] = useState(signaling.getIsConnected());

  useEffect(() => {
    const unsubTopo = topology.onStateChange((s) => setState(s));
    const unsubSig = signaling.on('connection:change', (data: any) => {
      setIsSignalingConnected(data.connected);
    });

    return () => {
      unsubTopo();
      unsubSig();
    };
  }, []);

  return (
    <div className="glass-card">
      <div className="glass-card-header">
        <div className="glass-card-title">
          <Network size={15} color="var(--primary)" />
          <span>P2P Topology Mesh</span>
        </div>
        <span
          className="badge"
          style={{
            background: isSignalingConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: isSignalingConnected ? '#10b981' : '#ef4444',
          }}
        >
          {isSignalingConnected ? 'Signaling Live' : 'Reconnecting'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px' }}>
        {/* Node Role */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '8px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Assigned Role</div>
          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', color: '#f8fafc', marginTop: '2px' }}>
            {state.isLeader ? '👑 Cluster Leader' : '⚡ Regular Peer'}
          </div>
        </div>

        {/* Assigned Leader or Cluster Size */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '8px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            {state.isLeader ? 'Cluster Peers' : 'Upstream Leader'}
          </div>
          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', color: '#f8fafc', marginTop: '2px' }}>
            {state.isLeader
              ? `${state.clusterPeers.length} Peers Connected`
              : state.assignedLeader
              ? state.assignedLeader.slice(0, 10)
              : 'Direct Mesh'}
          </div>
        </div>
      </div>

      {/* Backbone info if leader */}
      {state.isLeader && state.backboneLeaders.length > 0 && (
        <div
          style={{
            marginTop: '8px',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
            background: 'rgba(139, 92, 246, 0.1)',
            padding: '6px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(139, 92, 246, 0.25)',
          }}
        >
          <div style={{ fontWeight: 600, color: '#c4b5fd' }}>Backbone Mesh:</div>
          <div>Connected to {state.backboneLeaders.length} other cluster leaders</div>
        </div>
      )}
    </div>
  );
};
