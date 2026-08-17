// ─── Status & Rich Presence Management Service ───

import { PeerStatus } from '@/core/network/packet';
import { DiscoveryService } from '@/features/discovery/discovery.service';

export interface StatusConfig {
  status: PeerStatus;
  label: string;
  emoji: string;
  color: string;
  description: string;
}

export const STATUS_PRESETS: Record<PeerStatus, StatusConfig> = {
  solving: {
    status: 'solving',
    label: 'Solving',
    emoji: '🟢',
    color: '#10b981',
    description: 'Actively solving the problem',
  },
  reading: {
    status: 'reading',
    label: 'Reading',
    emoji: '🟡',
    color: '#f59e0b',
    description: 'Reading description or editorial',
  },
  watching: {
    status: 'watching',
    label: 'Watching',
    emoji: '🔵',
    color: '#3b82f6',
    description: 'Watching video solution/lecture',
  },
  discussing: {
    status: 'discussing',
    label: 'Discussing',
    emoji: '🟣',
    color: '#8b5cf6',
    description: 'Chatting or debugging in voice',
  },
  stuck: {
    status: 'stuck',
    label: 'Stuck',
    emoji: '🆘',
    color: '#ef4444',
    description: 'Need hint or alternative approach',
  },
  submitted: {
    status: 'submitted',
    label: 'Submitted',
    emoji: '🎯',
    color: '#06b6d4',
    description: 'Accepted & reviewing complexity',
  },
  idle: {
    status: 'idle',
    label: 'Idle',
    emoji: '☕',
    color: '#6b7280',
    description: 'Taking a quick break',
  },
};

export class StatusService {
  private static instance: StatusService | null = null;
  private discovery: DiscoveryService;
  private currentStatus: PeerStatus = 'solving';
  private sessionStartedAt = Date.now();
  private listeners: Set<(status: PeerStatus) => void> = new Set();

  private constructor() {
    this.discovery = DiscoveryService.getInstance();
  }

  public static getInstance(): StatusService {
    if (!StatusService.instance) {
      StatusService.instance = new StatusService();
    }
    return StatusService.instance;
  }

  public setStatus(status: PeerStatus) {
    this.currentStatus = status;
    this.discovery.updateContext(status);
    this.listeners.forEach((fn) => fn(status));
  }

  public getStatus(): PeerStatus {
    return this.currentStatus;
  }

  public getStartedAt(): number {
    return this.sessionStartedAt;
  }

  public resetTimer() {
    this.sessionStartedAt = Date.now();
    this.discovery.updateContext(this.currentStatus);
  }

  public onChange(listener: (status: PeerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
