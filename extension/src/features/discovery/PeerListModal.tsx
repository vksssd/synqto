// ─── Online Peer Roster Modal Component ───

import React from 'react';
import { X, Hand, Sparkles, Crown } from 'lucide-react';
import { OnlinePeer, DiscoveryService } from './discovery.service';
import { RichPresenceBadge } from '@/features/status/RichPresenceBadge';
import { PeerIdentity } from '@/core/network/packet';

interface PeerListModalProps {
  isOpen: boolean;
  onClose: () => void;
  peers: OnlinePeer[];
  myPeerId: string;
  myIdentity?: PeerIdentity | null;
  leaderId: string | null;
}

export const PeerListModal: React.FC<PeerListModalProps> = ({
  isOpen,
  onClose,
  peers,
  myPeerId,
  myIdentity,
  leaderId,
}) => {
  const discovery = DiscoveryService.getInstance();

  if (!isOpen) return null;

  const isSelfLeader = myPeerId === leaderId;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', color: '#f8fafc' }}>
            Room Members ({peers.length + 1})
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Global actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1 }}
            onClick={() => discovery.sendWave()}
          >
            <Hand size={13} color="#f59e0b" />
            <span>Wave All 👋</span>
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1 }}
            onClick={() => discovery.sendPoke()}
          >
            <Sparkles size={13} color="#8b5cf6" />
            <span>Poke Room 👉</span>
          </button>
        </div>

        {/* Peer list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          {/* 1. Self Entry (You) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.12))',
              border: '1px solid rgba(99, 102, 241, 0.45)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: myIdentity?.color || '#6366f1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                }}
              >
                {myIdentity?.avatar || '⚡'}
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 700, fontSize: '12px', color: '#ffffff' }}>
                    {myIdentity?.nickname || 'You'}
                  </span>
                  <span
                    style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      color: '#34d399',
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: '4px',
                    }}
                  >
                    You
                  </span>
                  {isSelfLeader && (
                    <span title="Cluster Leader" style={{ color: '#fbbf24' }}>
                      <Crown size={12} />
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Status: Active • You
                </div>
              </div>
            </div>

            <span style={{ fontSize: '11px', color: '#a5b4fc', fontWeight: 600 }}>
              (Self)
            </span>
          </div>

          {peers.length === 0 ? null : (
            peers.map((peer) => {
              const isPeerLeader = peer.identity.peerId === leaderId;
              return (
                <div
                  key={peer.identity.peerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: '50%',
                        background: peer.identity.color || '#6366f1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '16px',
                      }}
                    >
                      {peer.identity.avatar}
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '12px', color: '#f8fafc' }}>
                          {peer.identity.nickname}
                        </span>
                        {isPeerLeader && (
                          <span title="Cluster Leader" style={{ color: '#c4b5fd' }}>
                            <Crown size={12} />
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: '2px' }}>
                        <RichPresenceBadge
                          status={peer.status}
                          startedAt={peer.startedAt}
                          problemTitle={peer.problemTitle}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Individual actions */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="btn btn-ghost btn-icon"
                      style={{ width: '26px', height: '26px' }}
                      onClick={() => discovery.sendWave(peer.identity.peerId)}
                      title={`Wave at ${peer.identity.nickname}`}
                    >
                      👋
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      style={{ width: '26px', height: '26px' }}
                      onClick={() => discovery.sendPoke(peer.identity.peerId)}
                      title={`Poke ${peer.identity.nickname}`}
                    >
                      👉
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
