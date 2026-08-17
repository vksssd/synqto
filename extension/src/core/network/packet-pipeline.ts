// ─── Unified Packet Pipeline ───
// Orchestrates Outgoing (Sequence -> Chunker -> Reliability -> TransportRouter)
// and Incoming (TransportRouter -> Dedup -> Reassembly -> Reliability ACKs -> OrderingBuffer -> Application)

import { PeerId, RoomId } from '../types/identifiers';
import { NetworkPacket, PacketType, PeerIdentity, AckPayload, NackPayload, GapRepairPayload, createPacket } from './packet';
import { TransportRouter } from '../transport/transport-router';
import { ReliableTransport, DeliveryReceipt } from './reliable-transport';
import { OrderingBuffer } from './ordering-buffer';
import { PayloadChunker, PayloadReassembler } from './chunker';

export class PacketPipeline {
  private reliableTransport: ReliableTransport;
  private orderingBuffer: OrderingBuffer;
  private reassembler: PayloadReassembler;
  private transportRouter: TransportRouter;

  private myIdentity: PeerIdentity | null = null;
  private currentRoomId: RoomId = '';
  private localStreamSeq: Map<string, number> = new Map();

  private onDeliverToAppFn: ((packet: NetworkPacket) => void) | null = null;

  constructor(
    transportRouter: TransportRouter,
    reliableTransport: ReliableTransport = new ReliableTransport()
  ) {
    this.transportRouter = transportRouter;
    this.reliableTransport = reliableTransport;
    this.orderingBuffer = new OrderingBuffer();
    this.reassembler = new PayloadReassembler();

    // Bind reliable transport sender to TransportRouter
    this.reliableTransport.bindSender((packet: NetworkPacket, targetPeerId?: PeerId) => {
      if (targetPeerId) {
        return this.transportRouter.sendTo(targetPeerId, packet);
      } else {
        return this.transportRouter.broadcast(packet);
      }
    });

    // Ingest packets from physical TransportRouter
    this.transportRouter.onPacket((packet: NetworkPacket) => {
      this.handleIncoming(packet);
    });
  }

  public init(identity: PeerIdentity, roomId: RoomId): void {
    this.myIdentity = identity;
    this.currentRoomId = roomId;
    this.localStreamSeq.clear();
    this.reliableTransport.clear();
    this.orderingBuffer.clear();
    this.reassembler.clear();
  }

  public onDeliver(handler: (packet: NetworkPacket) => void): void {
    this.onDeliverToAppFn = handler;
  }

  /**
   * Outgoing transmission entry point.
   */
  public async sendPacket(
    packet: NetworkPacket,
    targetPeerId?: PeerId,
    options?: { isReliable?: boolean; maxAttempts?: number }
  ): Promise<DeliveryReceipt | null> {
    if (!this.myIdentity) return null;

    // 1. Assign monotonic sequence counter once per stream (scoped per-destination for unicast)
    if (packet.streamId && typeof packet.seq !== 'number') {
      const streamScope = targetPeerId ? `${packet.streamId}:${targetPeerId}` : packet.streamId;
      const currentSeq = this.localStreamSeq.get(streamScope) ?? 1;
      packet.seq = currentSeq;
      this.localStreamSeq.set(streamScope, currentSeq + 1);
    }

    // 2. Fragment large payloads if needed
    const fragments = PayloadChunker.chunkPacket(packet);

    // 3. Reliable vs Best-Effort Transmission
    const isReliable = options?.isReliable ?? this.reliableTransport.isAckable(packet);

    if (isReliable) {
      const receipts = await Promise.all(
        fragments.map((fragment) =>
          this.reliableTransport.sendReliable(fragment, targetPeerId, options?.maxAttempts)
        )
      );
      return receipts[receipts.length - 1] ?? null;
    } else {
      // Best-effort transmission
      for (const fragment of fragments) {
        if (targetPeerId) {
          this.transportRouter.sendTo(targetPeerId, fragment);
        } else {
          this.transportRouter.broadcast(fragment);
        }
      }
      return null;
    }
  }

  /**
   * Incoming packet processing pipeline.
   */
  private handleIncoming(incomingPacket: NetworkPacket): void {
    // 1. Process Protocol Control Envelopes
    if (incomingPacket.type === 'transport:ack') {
      this.reliableTransport.handleAck(incomingPacket.payload as AckPayload);
      return;
    }

    if (incomingPacket.type === 'transport:nack') {
      this.reliableTransport.handleNack(incomingPacket.payload as NackPayload);
      return;
    }

    if (incomingPacket.type === 'transport:gap_repair') {
      return;
    }

    // 2. ACK individual chunk packets immediately so sender resolves chunk transmission
    if (this.myIdentity && incomingPacket.type === 'chunk:data' && this.reliableTransport.isAckable(incomingPacket)) {
      const ackPayload: AckPayload = {
        ackId: `ack:${incomingPacket.id}`,
        ackFor: incomingPacket.id,
        fromPeerId: this.myIdentity.peerId,
        streamId: incomingPacket.streamId,
        seq: incomingPacket.seq,
        timestamp: Date.now(),
      };
      const ackPacket = createPacket(
        'transport:ack',
        this.myIdentity,
        incomingPacket.roomId,
        ackPayload,
        incomingPacket.from.peerId,
        { priority: 'CONTROL', channelPriority: 'control', topologyEpoch: incomingPacket.topologyEpoch }
      );
      this.transportRouter.sendTo(incomingPacket.from.peerId, ackPacket);
    }

    // 3. Reassemble chunks
    const packet = this.reassembler.ingestChunk(incomingPacket);
    if (!packet) {
      return; // Incomplete chunk transfer or duplicate chunk dropped
    }

    // 4. Deduplicate reassembled logical application packets
    if (!this.reliableTransport.filterDuplicate(packet.id)) {
      // Re-send ACK for duplicate packet so sender clears pending retry!
      if (this.myIdentity && packet.type !== 'chunk:data' && this.reliableTransport.isAckable(packet)) {
        const ackPayload: AckPayload = {
          ackId: `ack:${packet.id}`,
          ackFor: packet.id,
          fromPeerId: this.myIdentity.peerId,
          streamId: packet.streamId,
          seq: packet.seq,
          timestamp: Date.now(),
        };
        const ackPacket = createPacket(
          'transport:ack',
          this.myIdentity,
          packet.roomId,
          ackPayload,
          packet.from.peerId,
          { priority: 'CONTROL', channelPriority: 'control', topologyEpoch: packet.topologyEpoch }
        );
        this.transportRouter.sendTo(packet.from.peerId, ackPacket);
      }
      return; // Drop duplicate logical delivery to application
    }

    // 5. Automated ACK generation for ackable non-chunk application packets
    // INVARIANT: Never ACK an ACK or presence/ephemeral packet
    if (this.myIdentity && packet.type !== 'chunk:data' && this.reliableTransport.isAckable(packet)) {
      const ackPayload: AckPayload = {
        ackId: `ack:${packet.id}`,
        ackFor: packet.id,
        fromPeerId: this.myIdentity.peerId,
        streamId: packet.streamId,
        seq: packet.seq,
        timestamp: Date.now(),
      };
      const ackPacket = createPacket(
        'transport:ack',
        this.myIdentity,
        packet.roomId,
        ackPayload,
        packet.from.peerId,
        { priority: 'CONTROL', channelPriority: 'control', topologyEpoch: packet.topologyEpoch }
      );
      this.transportRouter.sendTo(packet.from.peerId, ackPacket);
    }

    // 4. Stream-Scoped Sequence Ordering
    this.orderingBuffer.inflow(
      packet,
      (orderedPacket) => {
        if (this.onDeliverToAppFn) {
          this.onDeliverToAppFn(orderedPacket);
        }
      },
      (gapRepair) => {
        // Emit gap repair request to sender
        if (this.myIdentity) {
          const repairPacket = createPacket(
            'transport:gap_repair',
            this.myIdentity,
            packet.roomId,
            gapRepair,
            packet.from.peerId
          );
          this.transportRouter.sendTo(packet.from.peerId, repairPacket);
        }
      }
    );
  }

  public step(simulatedNow: number): void {
    this.reliableTransport.step(simulatedNow);
    this.orderingBuffer.step(simulatedNow, (orderedPacket) => {
      if (this.onDeliverToAppFn) {
        this.onDeliverToAppFn(orderedPacket);
      }
    });
  }

  public hasPending(): boolean {
    return this.reliableTransport.hasPending() || this.orderingBuffer.hasPending();
  }

  public getReliableTransport(): ReliableTransport {
    return this.reliableTransport;
  }

  public clear(): void {
    this.reliableTransport.clear();
    this.orderingBuffer.clear();
    this.reassembler.clear();
    this.localStreamSeq.clear();
  }
}
