// ─── Unified Transport Router & Delegation Engine ───

import { PeerId, RoomId } from '../types/identifiers';
import { NetworkPacket } from '../network/packet';
import { ITransport, TransportHealth } from './transport.types';
import { TopologyView } from '../topology/topology-view';
import { RelayTransport } from './relay-transport';

export class TransportRouter {
  private activeView: TopologyView | null = null;
  private relayTransport: RelayTransport;
  private p2pSenderFn: ((packet: NetworkPacket, targetPeerId?: PeerId) => boolean) | null = null;
  private packetListeners: Set<(packet: NetworkPacket) => void> = new Set();

  private seenPacketIds: Set<string> = new Set();
  private packetOrder: string[] = [];
  private readonly MAX_SEEN = 1500;

  constructor(relayTransport: RelayTransport = new RelayTransport()) {
    this.relayTransport = relayTransport;

    this.relayTransport.onPacket((packet) => {
      this.routeIncoming(packet);
    });
  }

  public bindP2PSender(sender: (packet: NetworkPacket, targetPeerId?: PeerId) => boolean): void {
    this.p2pSenderFn = sender;
  }

  public updateView(view: TopologyView): void {
    this.activeView = view;
  }

  public broadcast(packet: NetworkPacket): boolean {
    this.markSeen(packet.id);
    this.deliverLocally(packet);

    if (!this.activeView) {
      return this.relayTransport.broadcast(packet);
    }

    // 1. Tier 3 Relay Transport
    if (this.activeView.tier === 'TIER3_SERVER_RELAY') {
      return this.relayTransport.broadcast(packet);
    }

    // 2. Dual-Path Migration: If transitionId is active or preparing/demoting Tier 3
    if (this.activeView.transitionId?.startsWith('tx_t3')) {
      this.relayTransport.broadcast(packet);
    }

    // 3. P2P Transport (Tier 1 Full Mesh or Tier 2 Multi-Leader)
    if (this.p2pSenderFn) {
      return this.p2pSenderFn(packet);
    }

    return false;
  }

  public sendTo(targetPeerId: PeerId, packet: NetworkPacket): boolean {
    this.markSeen(packet.id);

    if (!this.activeView || this.activeView.tier === 'TIER3_SERVER_RELAY') {
      return this.relayTransport.sendTo(targetPeerId, packet);
    }

    if (this.p2pSenderFn) {
      return this.p2pSenderFn(packet, targetPeerId);
    }

    return false;
  }

  public routeIncoming(packet: NetworkPacket): void {
    if (this.seenPacketIds.has(packet.id)) {
      return; // Deduplicate
    }
    this.markSeen(packet.id);
    this.deliverLocally(packet);
  }

  private markSeen(id: string): void {
    this.seenPacketIds.add(id);
    this.packetOrder.push(id);
    if (this.packetOrder.length > this.MAX_SEEN) {
      const oldest = this.packetOrder.shift();
      if (oldest) this.seenPacketIds.delete(oldest);
    }
  }

  private deliverLocally(packet: NetworkPacket): void {
    this.packetListeners.forEach((fn) => {
      try {
        fn(packet);
      } catch (err) {
        console.error('[TransportRouter] Error in packet listener:', err);
      }
    });
  }

  public onPacket(handler: (packet: NetworkPacket) => void): () => void {
    this.packetListeners.add(handler);
    return () => {
      this.packetListeners.delete(handler);
    };
  }

  public getRelayHealth(): TransportHealth {
    return this.relayTransport.getHealth();
  }
}
