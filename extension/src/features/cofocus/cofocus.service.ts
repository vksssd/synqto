// ─── CoFocus Session Service (Matchmaking → Room → Countdown) ───
//
// Orchestrates a CoFocus session end to end:
//   launcher → LobbyService queue → match → RoomService.joinCoFocusRoom → countdown
//
// It owns session lifecycle only. It does not touch topology (RoomService applies
// DIRECT_ONLY_POLICY), does not manage media (Watcher's camera comes from TutorService, and
// Together reuses the existing room surface untouched), and is never in the data path.

import {
  LobbyService,
  LobbyMatchedData,
  LobbyWaitingData,
  LobbyErrorData,
  CoFocusMode,
} from '@/core/network/lobby.service';
import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomService } from '@/features/room/room.service';
import {
  CoFocusSessionState,
  INITIAL_COFOCUS_STATE,
  PARTNER_ARRIVAL_TIMEOUT_MS,
} from './cofocus.types';

export class CoFocusService {
  private static instance: CoFocusService | null = null;

  private lobby: LobbyService;
  private identityService: IdentityService;
  private roomService: RoomService;
  private network: NetworkService;

  private state: CoFocusSessionState = { ...INITIAL_COFOCUS_STATE };
  private listeners: Set<(state: CoFocusSessionState) => void> = new Set();

  private countdownTimer: any = null;
  private partnerArrivalTimer: any = null;
  private unsubscribeLobby: Array<() => void> = [];
  private unsubscribeTopology: (() => void) | null = null;

  /** Retained so an auto-requeue after a vanished partner can repeat the original request. */
  private lastRequest: { mode: CoFocusMode; subjectTag?: string; sessionLengthSec?: number } | null = null;

  private constructor() {
    this.lobby = LobbyService.getInstance();
    this.identityService = IdentityService.getInstance();
    this.roomService = RoomService.getInstance();
    this.network = NetworkService.getInstance();
    this.bindLobbyListeners();
    this.bindRoomReconciliation();
  }

  /**
   * Keeps session state honest when the room changes underneath us.
   *
   * CoFocusService is not the only thing that can move the user between rooms — joining a
   * group, opening a problem page, or any future entry point all call RoomService directly.
   * Without this, leaving a CoFocus room by any of those paths left this service still
   * reporting phase 'active' with a stale roomId: the countdown kept ticking, isInCoFocusSession()
   * kept returning true, and the partner-arrival watch kept running against a room the user
   * had already left.
   */
  private bindRoomReconciliation(): void {
    this.roomService.onChange((room) => {
      // Only an ESTABLISHED session can be displaced.
      //
      // Restricting to active/completed is deliberate and load-bearing, not conservatism:
      //   - 'queued'  has no room yet, so any room change is unrelated to it.
      //   - 'matched' is mid-join, and joinCoFocusRoom() calls leaveCurrentRoom() first —
      //     which emits a transient null. Reacting to that would reset the very session we
      //     are in the middle of starting, killing every match before it began.
      if (this.state.phase !== 'active' && this.state.phase !== 'completed') return;

      // Still in our own session room — nothing to reconcile.
      if (room && this.state.roomId && room.roomId === this.state.roomId) return;

      this.clearTimers();
      this.detachTopologyWatch();
      this.setState({ ...INITIAL_COFOCUS_STATE });
    });
  }

  public static getInstance(): CoFocusService {
    if (!CoFocusService.instance) {
      CoFocusService.instance = new CoFocusService();
    }
    return CoFocusService.instance;
  }

  // ── Public API ──

  /** Queue for a silent, camera-only Watcher session against anyone else waiting. */
  public async startWatcher(sessionLengthSec: number): Promise<void> {
    return this.enqueue('WATCHER', undefined, sessionLengthSec);
  }

  /** Queue for a full-collaboration Together session on a subject. */
  public async startTogetherRandom(subjectTag: string, sessionLengthSec: number): Promise<void> {
    return this.enqueue('TOGETHER', subjectTag, sessionLengthSec);
  }

  /**
   * Start a Together session with a known peer, bypassing matchmaking entirely.
   *
   * No queue and no server matchmaking: both sides agree on a room ID out of band (an invite
   * code) and join it directly. It still runs under DIRECT_ONLY_POLICY, so an invited session
   * has exactly the same topology guarantees as a matched one.
   */
  public async startTogetherInvite(inviteCode: string, sessionLengthSec: number): Promise<void> {
    const roomId = this.roomIdFromInviteCode(inviteCode);
    this.lastRequest = { mode: 'TOGETHER', sessionLengthSec };

    this.setState({
      ...INITIAL_COFOCUS_STATE,
      phase: 'matched',
      mode: 'TOGETHER',
      roomId,
      sessionLengthSec,
    });

    await this.roomService.joinCoFocusRoom(roomId, {
      mode: 'TOGETHER',
      sessionLengthSec,
    });

    // An invite carries no matchmaking guarantee that anyone is on the other side, so the same
    // partner-arrival watch applies — it just surfaces "nobody joined" instead of requeueing.
    this.watchForPartner({ autoRequeueOnTimeout: false });
  }

  /** Generates a shareable invite code for a Together session. */
  public createInviteCode(): string {
    const raw =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return raw.slice(0, 10).toUpperCase();
  }

  private roomIdFromInviteCode(code: string): string {
    // Deterministic on both sides: same code ⇒ same room. Namespaced to match the server's
    // matched-room convention so all CoFocus rooms are identifiable by ID alone.
    return `cofocus:invite-${code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  /**
   * Cancels matchmaking.
   *
   * Also tears down the room if one was already joined. By the time a user sees "Match found —
   * connecting…" the room HAS been entered and (for Watcher) the camera is live, so cancelling
   * at that moment previously reset session state while leaving the user sitting in the room
   * with an active camera and a UI that no longer believed a session existed. Cancelling must
   * undo everything it started, not just the queue.
   */
  public cancelQueue(): void {
    this.lobby.leaveQueue();
    this.clearTimers();
    this.detachTopologyWatch();
    if (this.state.roomId) {
      this.roomService.leaveCurrentRoom();
    }
    this.setState({ ...INITIAL_COFOCUS_STATE });
  }

  /** Ends the session, leaving the room and returning to idle. */
  public endSession(): void {
    this.clearTimers();
    this.detachTopologyWatch();
    this.lobby.leaveQueue();
    if (this.state.roomId) {
      this.roomService.leaveCurrentRoom();
    }
    this.setState({ ...INITIAL_COFOCUS_STATE });
  }

  /** Adds time to a running session (used by the "keep going" action at completion). */
  public extendSession(additionalSec: number): void {
    if (this.state.phase !== 'active' && this.state.phase !== 'completed') return;
    this.setState({
      ...this.state,
      phase: 'active',
      remainingSec: Math.max(0, this.state.remainingSec) + additionalSec,
    });
    this.startCountdown();
  }

  public getState(): CoFocusSessionState {
    return { ...this.state };
  }

  public isInCoFocusSession(): boolean {
    return this.state.phase !== 'idle';
  }

  public onChange(listener: (state: CoFocusSessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Internals ──

  /**
   * @param carryError Message to keep visible on the queued screen. Needed because this
   * resets state to INITIAL: the auto-requeue path used to set "your match did not join"
   * and then call enqueue(), which wiped it a moment later, so the user was silently
   * re-queued with no explanation for why their match evaporated.
   */
  private async enqueue(
    mode: CoFocusMode,
    subjectTag: string | undefined,
    sessionLengthSec: number,
    carryError?: string
  ): Promise<void> {
    const identity = await this.identityService.getOrCreateIdentity();
    this.lastRequest = { mode, subjectTag, sessionLengthSec };

    this.setState({
      ...INITIAL_COFOCUS_STATE,
      phase: 'queued',
      mode,
      subjectTag,
      sessionLengthSec,
      error: carryError,
    });

    this.lobby.joinQueue({
      peerId: identity.peerId,
      nickname: identity.nickname,
      mode,
      subjectTag,
      sessionLengthSec,
    });
  }

  private bindLobbyListeners(): void {
    this.unsubscribeLobby.push(
      this.lobby.on('waiting', (data: LobbyWaitingData) => {
        if (this.state.phase !== 'queued') return;
        this.setState({
          ...this.state,
          queuePosition: data.queuePosition,
          queueTimeoutSec: data.timeoutSec,
        });
      })
    );

    this.unsubscribeLobby.push(
      this.lobby.on('matched', (data: LobbyMatchedData) => {
        void this.handleMatched(data);
      })
    );

    this.unsubscribeLobby.push(
      this.lobby.on('timeout', () => {
        this.setState({
          ...INITIAL_COFOCUS_STATE,
          error: 'No study partner found right now. Try again, or pick a broader subject.',
        });
      })
    );

    this.unsubscribeLobby.push(
      this.lobby.on('error', (data: LobbyErrorData) => {
        this.setState({
          ...INITIAL_COFOCUS_STATE,
          error: data.message || `Matchmaking failed (${data.reason}).`,
        });
      })
    );

    this.unsubscribeLobby.push(
      this.lobby.on('closed', () => {
        // Only meaningful while queued: a close after matching is the normal end of the lobby
        // connection, and LobbyService already suppresses that case.
        if (this.state.phase === 'queued') {
          this.setState({
            ...INITIAL_COFOCUS_STATE,
            error: 'Lost connection to the matchmaking server.',
          });
        }
      })
    );
  }

  private async handleMatched(data: LobbyMatchedData): Promise<void> {
    this.setState({
      ...this.state,
      phase: 'matched',
      mode: data.mode,
      roomId: data.roomId,
      subjectTag: data.subjectTag || this.state.subjectTag,
      sessionLengthSec: data.sessionLengthSec || this.state.sessionLengthSec,
      partnerPeerId: data.partnerPeerId,
      partnerNickname: data.partnerNickname,
      partnerPresent: false,
      queuePosition: undefined,
      queueTimeoutSec: undefined,
      error: undefined,
    });

    await this.roomService.joinCoFocusRoom(data.roomId, {
      mode: data.mode,
      sessionLengthSec: data.sessionLengthSec,
      subjectTag: data.subjectTag,
      partnerPeerId: data.partnerPeerId,
    });

    this.watchForPartner({ autoRequeueOnTimeout: true });
  }

  /**
   * Waits for the partner to actually appear in the room, then starts the session.
   *
   * Guards the "matched but vanished" failure: the lobby pairs two peers, but nothing
   * guarantees both actually complete the room join. Without this, a matched user would sit
   * alone in a room forever with no explanation.
   */
  private watchForPartner(opts: { autoRequeueOnTimeout: boolean }): void {
    this.detachTopologyWatch();
    this.clearPartnerArrivalTimer();

    this.unsubscribeTopology = this.network.onTopologyChange((topology) => {
      const me = this.currentPeerId();

      // Prefer an exact identity check. For a matched session the lobby told us precisely who
      // the partner is, so testing for THAT peer is strictly safer than "any peer that isn't
      // me" — the latter would accept a stale roster entry left over from a previous room
      // (TopologyService clears allPeers in leave(), not in init(), so a stale set is
      // reachable) and start the session against a peer who is not actually here.
      // Invite sessions have no known partner ID, so they fall back to the loose check.
      const expected = this.state.partnerPeerId;
      const partnerHere = expected
        ? topology.allPeers.includes(expected)
        : topology.allPeers.some((p) => p !== me);

      if (partnerHere && !this.state.partnerPresent) {
        this.clearPartnerArrivalTimer();

        // Distinguish the partner ARRIVING for the first time from them REJOINING after a
        // drop. Only the first arrival starts the clock. Treating a rejoin as a fresh start
        // would reset remainingSec to the full session length — so a partner who reloads at
        // minute 20 of a 25-minute session would silently hand both peers a brand new 25
        // minutes — and would stack a second countdown interval on top of the running one.
        const isFirstArrival = this.state.phase === 'matched';

        this.setState({
          ...this.state,
          // A rejoin must not resurrect a session that already reached its checkpoint.
          phase: isFirstArrival ? 'active' : this.state.phase,
          partnerPresent: true,
          remainingSec: isFirstArrival ? this.state.sessionLengthSec || 0 : this.state.remainingSec,
        });

        if (isFirstArrival) {
          this.startCountdown();
        }
        return;
      }

      // Partner left an already-running session. Surface it instead of leaving the UI
      // asserting they are still present: the countdown keeps running (they may be
      // reloading), but the view can now show that they are gone, and the re-announce path
      // re-fires if they come back.
      if (!partnerHere && this.state.partnerPresent) {
        this.setState({ ...this.state, partnerPresent: false });
      }
    });

    this.partnerArrivalTimer = setTimeout(() => {
      if (this.state.partnerPresent) return;

      this.detachTopologyWatch();
      this.roomService.leaveCurrentRoom();

      if (opts.autoRequeueOnTimeout && this.lastRequest) {
        // Re-enter the queue rather than dumping the user back to the launcher: they asked to
        // be matched, and the first attempt failing is not a reason to make them start over.
        // The message is passed THROUGH enqueue rather than set before it, because enqueue
        // resets to INITIAL and would otherwise erase it.
        const { mode, subjectTag, sessionLengthSec } = this.lastRequest;
        void this.enqueue(
          mode,
          subjectTag,
          sessionLengthSec || 0,
          'Your match did not join — finding someone else.'
        );
      } else {
        this.setState({
          ...INITIAL_COFOCUS_STATE,
          error: 'Nobody joined this session.',
        });
      }
    }, PARTNER_ARRIVAL_TIMEOUT_MS);
  }

  private currentPeerId(): string {
    return this.network.getMyIdentity()?.peerId || '';
  }

  /**
   * Session countdown.
   *
   * Deliberately NOT reusing TimerService: Pomodoro auto-cycles into break modes and persists
   * to chrome.storage as the user's global timer state. Driving a CoFocus session through it
   * would mutate a user's unrelated Pomodoro state and fight its auto-start-breaks behaviour.
   * A one-shot session countdown is a few lines and stays isolated.
   *
   * Wall-clock based rather than tick-counting so a throttled background tab (Chrome heavily
   * throttles timers in inactive tabs) cannot make the countdown drift behind real time.
   */
  private startCountdown(): void {
    this.clearCountdown();
    if (!this.state.remainingSec || this.state.remainingSec <= 0) return;

    const endsAt = Date.now() + this.state.remainingSec * 1000;

    this.countdownTimer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));

      if (remaining <= 0) {
        this.clearCountdown();
        // Soft checkpoint: the room stays open and the peers stay connected. Force-closing
        // mid-conversation would be hostile, and "time's up" is information, not a command.
        this.setState({ ...this.state, phase: 'completed', remainingSec: 0 });
        this.playCompletionChime();
        return;
      }

      this.setState({ ...this.state, remainingSec: remaining });
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private clearPartnerArrivalTimer(): void {
    if (this.partnerArrivalTimer) {
      clearTimeout(this.partnerArrivalTimer);
      this.partnerArrivalTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearCountdown();
    this.clearPartnerArrivalTimer();
  }

  private detachTopologyWatch(): void {
    if (this.unsubscribeTopology) {
      this.unsubscribeTopology();
      this.unsubscribeTopology = null;
    }
  }

  private setState(next: CoFocusSessionState): void {
    this.state = next;
    const snapshot = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (err) {
        console.error('[CoFocusService] listener error:', err);
      }
    });
  }

  /** Gentle chime at session end. Mirrors TimerService's tone so the app sounds consistent. */
  private playCompletionChime(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };

      playTone(523.25, 0, 1.2);
      playTone(659.25, 0.15, 1.2);
      playTone(783.99, 0.3, 1.5);
      playTone(1046.5, 0.45, 2.0);
    } catch {
      /* Web Audio unavailable — the visual state change is enough. */
    }
  }

  public destroy(): void {
    this.clearTimers();
    this.detachTopologyWatch();
    this.unsubscribeLobby.forEach((fn) => fn());
    this.unsubscribeLobby = [];
    this.listeners.clear();
  }
}
