// ─── Transport Abstraction & Relay Envelope Types ───

import { MessageId, PeerId, RoomId, TopologyEpoch } from '../types/identifiers';
import { NetworkPacket } from '../network/packet';

export interface TransportHealth {
  connected: boolean;
  rttMs: number;
  packetLossRate: number;
  bytesSent: number;
  bytesReceived: number;
  lastSeen: number;
}

export interface RelayEnvelope {
  packetId: MessageId;
  roomId: RoomId;
  sourcePeerId: PeerId;
  destinationPeerId?: PeerId;
  topologyEpoch: TopologyEpoch;
  topologyGeneration: number;
  ttl: number;
  hopCount: number;
  timestamp: number;
  packet: NetworkPacket;
}

export interface ITransport {
  readonly name: string;
  connect(roomId: RoomId): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  broadcast(packet: NetworkPacket): boolean;
  sendTo(targetPeerId: PeerId, packet: NetworkPacket): boolean;
  onPacket(handler: (packet: NetworkPacket) => void): () => void;
  getHealth(): TransportHealth;
}
