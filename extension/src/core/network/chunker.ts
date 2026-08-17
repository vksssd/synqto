// ─── Large Payload Fragmentation & CRC32 Reassembly Engine ───
// Slices payloads > 7KB into wire-bounded chunks (< 9.5KB wire size) with CRC32 integrity verification.

import { NetworkPacket, PacketType, PeerIdentity, ChunkPayload, createPacket } from './packet';

// ─── IEEE 802.3 CRC32 Table & Checksum Engine ───

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

export function computeCRC32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Support utf-8 byte stream representation
    if (code < 128) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ code) & 0xff];
    } else {
      const bytes = new TextEncoder().encode(str[i]);
      for (const b of bytes) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ b) & 0xff];
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Payload Chunker ───

export class PayloadChunker {
  public static readonly CHUNK_RAW_SIZE = 7168; // 7 KiB raw segment budget (wire size < 9.5 KiB)
  public static readonly MAX_CHUNKS = 512;      // ~3.5 MiB maximum payload object limit

  public static calculateCRC32(str: string): number {
    return computeCRC32(str);
  }

  /**
   * Evaluates if a packet needs fragmentation. If smaller than threshold, returns [packet].
   * If large, splits serialized payload into bounded chunk:data packets.
   */
  public static chunkPacket(packet: NetworkPacket): NetworkPacket[] {
    if (packet.type === 'chunk:data') {
      return [packet]; // Already a chunk
    }

    const serialized = JSON.stringify(packet.payload);
    if (serialized.length <= PayloadChunker.CHUNK_RAW_SIZE) {
      return [packet]; // Bypass chunking for normal-sized packets
    }

    const totalChunks = Math.ceil(serialized.length / PayloadChunker.CHUNK_RAW_SIZE);
    if (totalChunks > PayloadChunker.MAX_CHUNKS) {
      throw new Error(
        `[PayloadChunker] Payload of size ${serialized.length}B exceeds max allowed chunks (${PayloadChunker.MAX_CHUNKS})`
      );
    }

    const checksum = computeCRC32(serialized);
    const transferId = `${packet.id}:tfr`;
    const chunkPackets: NetworkPacket[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * PayloadChunker.CHUNK_RAW_SIZE;
      const end = Math.min(serialized.length, start + PayloadChunker.CHUNK_RAW_SIZE);
      const segment = serialized.substring(start, end);

      const chunkPayload: ChunkPayload = {
        transferId,
        chunkIndex: i,
        totalChunks,
        data: segment,
        checksum,
        originalType: packet.type,
        byteLength: serialized.length,
      };

      const chunkPkt = createPacket(
        'chunk:data',
        packet.from,
        packet.roomId,
        chunkPayload,
        packet.to,
        {
          channelPriority: 'bulk',
          streamId: packet.streamId,
          seq: packet.seq,
          lamportTime: packet.lamportTime,
          topologyEpoch: packet.topologyEpoch,
        }
      );
      // Give each chunk a distinct deterministic ID to survive dedup filters
      chunkPkt.id = `${packet.id}:c${i}`;
      chunkPkt.timestamp = packet.timestamp;

      chunkPackets.push(chunkPkt);
    }

    return chunkPackets;
  }
}

// ─── Payload Reassembler ───

interface ActiveTransfer {
  transferId: string;
  originalType: PacketType;
  totalChunks: number;
  checksum: number;
  totalByteLength: number;
  chunks: Map<number, string>;
  from: PeerIdentity;
  roomId: string;
  streamId?: string;
  seq?: number;
  lamportTime?: number;
  topologyEpoch?: number;
  createdAt: number;
  timer: any;
}

export class PayloadReassembler {
  private activeTransfers: Map<string, ActiveTransfer> = new Map();
  private seenChunkKeys: Set<string> = new Set();
  private completedTransfers: Set<string> = new Set();
  private completedOrder: string[] = [];

  public static readonly MAX_CONCURRENT_TRANSFERS = 256;
  public static readonly TRANSFER_TIMEOUT_MS = 30000;
  public static readonly MAX_COMPLETED_HISTORY = 2000;

  /**
   * Ingests an incoming chunk:data packet.
   * Enforces resource limits before allocation, deduplicates chunks, validates CRC32 on completion,
   * and returns reconstructed NetworkPacket when all chunks are collected (or null if incomplete/duplicate).
   */
  public ingestChunk(chunkPacket: NetworkPacket): NetworkPacket | null {
    if (chunkPacket.type !== 'chunk:data') {
      return chunkPacket; // Non-chunk packet passes straight through
    }

    const payload = chunkPacket.payload as ChunkPayload;
    if (!payload || !payload.transferId || typeof payload.chunkIndex !== 'number') {
      return null;
    }

    // 1. Check if transfer is already completed
    if (this.completedTransfers.has(payload.transferId)) {
      return null;
    }

    // 2. Chunk-level deduplication
    const chunkKey = `${payload.transferId}:${payload.chunkIndex}`;
    if (this.seenChunkKeys.has(chunkKey)) {
      return null; // Drop duplicate chunk
    }
    this.seenChunkKeys.add(chunkKey);

    // 3. Check transfer capacity bounds
    if (!this.activeTransfers.has(payload.transferId)) {
      if (this.activeTransfers.size >= PayloadReassembler.MAX_CONCURRENT_TRANSFERS) {
        console.warn(`[PayloadReassembler] Max concurrent transfers (${PayloadReassembler.MAX_CONCURRENT_TRANSFERS}) reached. Dropping chunk.`);
        return null;
      }
      if (payload.totalChunks > PayloadChunker.MAX_CHUNKS) {
        console.warn(`[PayloadReassembler] Transfer ${payload.transferId} exceeds max chunk limit. Dropping.`);
        return null;
      }

      const timer = setTimeout(() => {
        this.activeTransfers.delete(payload.transferId);
      }, PayloadReassembler.TRANSFER_TIMEOUT_MS);

      this.activeTransfers.set(payload.transferId, {
        transferId: payload.transferId,
        originalType: payload.originalType,
        totalChunks: payload.totalChunks,
        checksum: payload.checksum,
        totalByteLength: payload.byteLength,
        chunks: new Map(),
        from: chunkPacket.from,
        roomId: chunkPacket.roomId,
        streamId: chunkPacket.streamId,
        seq: chunkPacket.seq,
        lamportTime: chunkPacket.lamportTime,
        topologyEpoch: chunkPacket.topologyEpoch,
        createdAt: Date.now(),
        timer,
      });
    }

    const active = this.activeTransfers.get(payload.transferId)!;
    active.chunks.set(payload.chunkIndex, payload.data);

    // 4. Check if all chunks have arrived
    if (active.chunks.size === active.totalChunks) {
      clearTimeout(active.timer);
      this.activeTransfers.delete(payload.transferId);

      // Assemble chunks in numerical order
      let assembled = '';
      for (let i = 0; i < active.totalChunks; i++) {
        const seg = active.chunks.get(i);
        if (seg === undefined) {
          console.error(`[PayloadReassembler] Missing chunk ${i} during reassembly of ${payload.transferId}`);
          return null;
        }
        assembled += seg;
      }

      // Validate CRC32 Integrity
      const actualChecksum = computeCRC32(assembled);
      if (actualChecksum !== active.checksum) {
        console.error(
          `[PayloadReassembler] CRC32 Checksum mismatch for ${payload.transferId}: expected ${active.checksum}, got ${actualChecksum}`
        );
        return null;
      }

      // Record transfer completion for deduplication
      this.completedTransfers.add(payload.transferId);
      this.completedOrder.push(payload.transferId);
      if (this.completedOrder.length > PayloadReassembler.MAX_COMPLETED_HISTORY) {
        const oldest = this.completedOrder.shift();
        if (oldest) this.completedTransfers.delete(oldest);
      }

      // Reconstruct original packet
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(assembled);
      } catch (err) {
        console.error(`[PayloadReassembler] JSON parse failed on reassembled payload for ${payload.transferId}`, err);
        return null;
      }

      // Extract original packet ID from transfer ID (transferId is packetId:tfr)
      const originalPacketId = payload.transferId.replace(/:tfr$/, '');

      const reconstructed: NetworkPacket = {
        id: originalPacketId,
        type: active.originalType,
        from: active.from,
        roomId: active.roomId,
        payload: parsedPayload,
        timestamp: active.createdAt,
        ttl: 3,
        streamId: active.streamId,
        seq: active.seq,
        lamportTime: active.lamportTime,
        topologyEpoch: active.topologyEpoch,
      };

      return reconstructed;
    }

    return null; // Incomplete transfer
  }

  public clear(): void {
    this.activeTransfers.forEach((t) => clearTimeout(t.timer));
    this.activeTransfers.clear();
    this.seenChunkKeys.clear();
    this.completedTransfers.clear();
    this.completedOrder = [];
  }
}
