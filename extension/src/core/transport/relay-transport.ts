// ─── Dedicated Relay Transport Adapter ───

import { PeerId, RoomId } from '../types/identifiers';
import { NetworkPacket } from '../network/packet';
import { ITransport, RelayEnvelope, TransportHealth } from './transport.types';
import { SignalingService } from '../network/signaling.service';

export class RelayTransport implements ITransport {
  public readonly name = 'RelayTransport';
  private signaling: SignalingService;
  private currentRoomId: RoomId = '';
  private myPeerId: PeerId = '';
  private listeners: Set<(packet: NetworkPacket) => void> = new Set();

  private bytesSent = 0;
  private bytesReceived = 0;
  private lastSeen = 0;

  constructor(signalingService: SignalingService = SignalingService.getInstance()) {
    this.signaling = signalingService;

    // Listen for incoming relay packets
    this.signaling.on('relay:packet', (packet: NetworkPacket) => {
      this.lastSeen = Date.now();
      this.bytesReceived += JSON.stringify(packet).length;
      this.listeners.forEach((fn) => {
        try {
          fn(packet);
        } catch (e) {
          console.error('[RelayTransport] Error in listener:', e);
        }
      });
    });
  }

  public init(myPeerId: PeerId) {
    this.myPeerId = myPeerId;
  }

  public async connect(roomId: RoomId): Promise<void> {
    this.currentRoomId = roomId;
  }

  public async disconnect(): Promise<void> {
    this.currentRoomId = '';
  }

  public isConnected(): boolean {
    return this.signaling.getIsConnected();
  }

  public broadcast(packet: NetworkPacket): boolean {
    if (!this.isConnected()) return false;

    const envelope: RelayEnvelope = {
      packetId: packet.id,
      roomId: packet.roomId,
      sourcePeerId: packet.from.peerId,
      topologyEpoch: 1,
      topologyGeneration: 1,
      ttl: packet.ttl,
      hopCount: 1,
      timestamp: Date.now(),
      packet,
    };

    this.bytesSent += JSON.stringify(envelope).length;
    return this.signaling.sendRelayPacket(packet);
  }

  public sendTo(targetPeerId: PeerId, packet: NetworkPacket): boolean {
    if (!this.isConnected()) return false;

    const envelope: RelayEnvelope = {
      packetId: packet.id,
      roomId: packet.roomId,
      sourcePeerId: packet.from.peerId,
      destinationPeerId: targetPeerId,
      topologyEpoch: 1,
      topologyGeneration: 1,
      ttl: packet.ttl,
      hopCount: 1,
      timestamp: Date.now(),
      packet: { ...packet, to: targetPeerId },
    };

    this.bytesSent += JSON.stringify(envelope).length;
    return this.signaling.sendRelayPacket(envelope.packet);
  }

  public onPacket(handler: (packet: NetworkPacket) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  public getHealth(): TransportHealth {
    return {
      connected: this.isConnected(),
      rttMs: 40,
      packetLossRate: 0.001,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      lastSeen: this.lastSeen || Date.now(),
    };
  }

  public getCapabilities(): import('./transport.types').TransportCapabilities {
    return {
      directPeer: false,
      broadcast: true,
      ordered: true,
      reliable: true,
      maxPayloadSize: 16 * 1024 * 1024, // 16MB
    };
  }
}
