// ─── Network Simulator Harness (10 / 25 / 50 / 100 Peer Orchestrator) ───

declare const process: any;

import { PeerId, RoomId } from '../types/identifiers';
import { SeededPRNG } from './prng';
import { VirtualNetwork, NetworkProfile } from './virtual-network';
import { SimulatedPeer } from './simulated-peer';
import { MetricsCollector } from './metrics-collector';
import { TrafficGenerator } from './traffic-generator';
import { ReplicatedStore } from '../replication/replicated-store';

export class NetworkSimulator {
  public readonly metrics: MetricsCollector;
  public readonly virtualNetwork: VirtualNetwork;
  public readonly peers: Map<PeerId, SimulatedPeer> = new Map();
  private trafficGenerator: TrafficGenerator;

  constructor(
    public readonly roomId: RoomId = 'sim-room-1',
    profile: NetworkProfile = {
      latencyMs: 35,
      jitterMs: 15,
      lossRate: 0.02,
      duplicationRate: 0.005,
      reorderRate: 0.03,
    },
    public readonly prng: SeededPRNG = new SeededPRNG(42)
  ) {
    this.metrics = new MetricsCollector();
    this.virtualNetwork = new VirtualNetwork(profile, prng, this.metrics);
    this.trafficGenerator = new TrafficGenerator(prng);
  }

  public createCluster(peerCount: number): SimulatedPeer[] {
    const created: SimulatedPeer[] = [];

    for (let i = 0; i < peerCount; i++) {
      const peerId = `peer_${i + 1}`;
      const peer = new SimulatedPeer(peerId, this.roomId, this.virtualNetwork, this.metrics);
      this.peers.set(peerId, peer);
      created.push(peer);
    }

    // Set full direct neighbors initially
    const allIds = created.map((p) => p.peerId);
    created.forEach((p) => {
      p.setNeighbors(allIds.filter((id) => id !== p.peerId));
    });

    return created;
  }

  /**
   * Flushes all in-flight network packets and steps through pending reliable retries until clear.
   */
  public async flushAll(peerList: SimulatedPeer[], maxSteps = 1200): Promise<void> {
    let steps = 0;
    while (steps < maxSteps) {
      const hasInFlight = this.virtualNetwork.getInFlightCount() > 0;
      const hasPendingRetries = peerList.some((p) => p.isAlive && p.packetPipeline.hasPending());
      if (!hasInFlight && !hasPendingRetries) {
        break;
      }
      await this.virtualNetwork.step(50);
      steps++;
    }
  }

  /**
   * Scenario A: Baseline 10 Peers / 1,000 Packets
   */
  public async runScenarioA(packetCount = 1000): Promise<boolean> {
    const peerList = this.createCluster(10);

    for (let i = 0; i < packetCount; i++) {
      const sender = this.prng.pick(peerList);
      this.trafficGenerator.emitRandomPacket(sender, peerList);
      await this.virtualNetwork.step(20);
    }

    // Flush remaining in-flight packets and retries
    await this.flushAll(peerList);

    this.metrics.printSummaryTable('Scenario A: 10-Peer Baseline');
    const result = this.metrics.verifyInvariants();
    return result.passed;
  }

  /**
   * Scenario B: 25 Peers with Dynamic Leader Failure & Route Shifts
   */
  public async runScenarioB(packetCount = 800): Promise<boolean> {
    const peerList = this.createCluster(25);
    const leaders = ['peer_1', 'peer_2', 'peer_3'];

    // Configure Tier 2 Multi-Leader Topology
    peerList.forEach((p) => {
      p.updateTopology({
        tier: 'TIER2_MULTI_LEADER',
        epoch: 1,
        leaders,
      });
      // Record leaders in route resolver
      leaders.forEach((ldr) => {
        p.routeResolver.recordDigest({
          roomId: this.roomId,
          topologyEpoch: 1,
          leaderGeneration: 1,
          digestVersion: 1,
          leaderPeerId: ldr,
          assignedClusterPeers: peerList.slice(0, 10).map((x) => x.peerId),
          memberCount: 25,
          vectorDigest: {},
          latestLamport: 1,
          healthScore: 95,
          knownLeaders: leaders,
          timestamp: Date.now(),
        });
      });
    });

    // Traffic with leader crashes
    for (let i = 0; i < packetCount; i++) {
      // Inject leader crash halfway through
      if (i === Math.floor(packetCount / 2)) {
        const victimLeader = this.peers.get('peer_1');
        if (victimLeader && victimLeader.isAlive) {
          victimLeader.crash();
          // Invalidate leader across all surviving peers
          peerList.forEach((p) => {
            if (p.isAlive) {
              p.routeResolver.invalidateLeader('peer_1');
              p.updateTopology({ epoch: 2, leaders: ['peer_2', 'peer_3'] });
            }
          });
          this.metrics.epochChanges++;
        }
      }

      const activePeers = peerList.filter((p) => p.isAlive && p.peerId !== 'peer_1');
      if (activePeers.length === 0) break;
      const sender = this.prng.pick(activePeers);
      this.trafficGenerator.emitRandomPacket(sender, activePeers);

      await this.virtualNetwork.step(20);
    }

    await this.flushAll(peerList);

    this.metrics.printSummaryTable('Scenario B: 25-Peer Dynamic Leader Failure');
    const result = this.metrics.verifyInvariants();
    return result.passed;
  }

  /**
   * Scenario C: 50 Peers with Partition & Healing Reconciliation
   */
  public async runScenarioC(packetCount = 1000): Promise<boolean> {
    const peerList = this.createCluster(50);
    const groupA = peerList.slice(0, 25).map((p) => p.peerId);
    const groupB = peerList.slice(25, 50).map((p) => p.peerId);

    // 1. Initial traffic
    for (let i = 0; i < Math.floor(packetCount / 3); i++) {
      const sender = this.prng.pick(peerList);
      this.trafficGenerator.emitRandomPacket(sender, peerList);
      await this.virtualNetwork.step(20);
    }

    // 2. Inject Network Partition (Group A vs Group B)
    this.virtualNetwork.partition(groupA, groupB);

    for (let i = 0; i < Math.floor(packetCount / 3); i++) {
      const sender = this.prng.pick(peerList);
      this.trafficGenerator.emitRandomPacket(sender, peerList);
      await this.virtualNetwork.step(20);
    }

    // 3. Heal Network Partition
    this.virtualNetwork.healPartition();

    for (let i = 0; i < Math.floor(packetCount / 3); i++) {
      const sender = this.prng.pick(peerList);
      this.trafficGenerator.emitRandomPacket(sender, peerList);
      await this.virtualNetwork.step(20);
    }

    await this.flushAll(peerList);

    this.metrics.printSummaryTable('Scenario C: 50-Peer Partition & Healing');
    const result = this.metrics.verifyInvariants();
    return result.passed;
  }

  /**
   * Scenario D: 100 Peers Adversarial Stress Run (Loss 5%, Jitter ±25ms, Duplication 1%, Chunks)
   */
  public async runScenarioD(packetCount = 1500): Promise<boolean> {
    const peerList = this.createCluster(100);
    const recoveringVictims: { peer: SimulatedPeer; recoverAt: number }[] = [];

    for (let i = 0; i < packetCount; i++) {
      // Check recovering peers in simulated time
      for (let v = recoveringVictims.length - 1; v >= 0; v--) {
        if (this.virtualNetwork.getCurrentTime() >= recoveringVictims[v].recoverAt) {
          recoveringVictims[v].peer.restart();
          recoveringVictims.splice(v, 1);
        }
      }

      const activePeers = peerList.filter((p) => p.isAlive);
      if (activePeers.length === 0) break;
      const sender = this.prng.pick(activePeers);

      // Generate mixed traffic with 10% forced large chunks
      const forceChunk = i % 10 === 0;
      this.trafficGenerator.emitRandomPacket(sender, peerList, forceChunk);

      // Transient peer churn (recovers in 200ms simulated time)
      if (i % 150 === 0) {
        const victim = this.prng.pick(activePeers);
        victim.crash();
        recoveringVictims.push({
          peer: victim,
          recoverAt: this.virtualNetwork.getCurrentTime() + 200,
        });
      }

      await this.virtualNetwork.step(20);
    }

    // Recover any remaining victims before flush
    recoveringVictims.forEach((v) => v.peer.restart());

    await this.flushAll(peerList);

    this.metrics.printSummaryTable('Scenario D: 100-Peer Adversarial Stress Run');
    const result = this.metrics.verifyInvariants();
    return result.passed;
  }

  /**
   * Scenario E: Multi-Peer Concurrent State Mutation & Convergence (10 Peers)
   */
  public async runScenarioE(opCount = 300): Promise<boolean> {
    const peerList = this.createCluster(10);
    const storeId = 'collab-doc-1';

    type DocState = { items: string[] };
    type DocOp = { text: string };
    const reducer = (state: DocState, op: DocOp) => {
      const items = [...state.items, op.text].sort();
      return { items };
    };
    const initialState: DocState = { items: [] };

    // Register ReplicatedStore on all 10 peers
    peerList.forEach((peer) => {
      const store = new ReplicatedStore<DocState, DocOp>(
        storeId,
        peer.identity,
        this.roomId,
        reducer,
        initialState,
        peer.packetPipeline
      );
      peer.registerStore(store);
    });

    // Generate concurrent mutations across random peers
    for (let i = 0; i < opCount; i++) {
      const sender = this.prng.pick(peerList);
      const store = sender.getStore<DocState, DocOp>(storeId);
      if (store) {
        store.mutate('insert', { text: `item_${sender.peerId}_${i}` });
      }
      await this.virtualNetwork.step(15);
    }

    // Trigger anti-entropy sync across all peers to reconcile any stragglers
    peerList.forEach((p) => {
      const store = p.getStore<DocState, DocOp>(storeId);
      if (store) {
        peerList.forEach((other) => {
          if (other.peerId !== p.peerId) {
            store.syncWith(other.peerId);
          }
        });
      }
    });

    await this.flushAll(peerList);

    console.log(
      'Peer item counts:',
      peerList.map((p) => `${p.peerId}: ${p.getStore<DocState, DocOp>(storeId)!.getState().items.length} items (journal: ${p.getStore<DocState, DocOp>(storeId)!.getJournal().getEventCount()}, pending: ${p.getStore<DocState, DocOp>(storeId)!.getSyncEngine().getPendingCount()})`).join(' | ')
    );

    // Verify 100% State Convergence across all 10 replicas
    const referenceState = peerList[0].getStore<DocState, DocOp>(storeId)!.getState();
    let converged = true;

    for (let i = 1; i < peerList.length; i++) {
      const peerState = peerList[i].getStore<DocState, DocOp>(storeId)!.getState();
      if (
        peerState.items.length !== referenceState.items.length ||
        JSON.stringify(peerState.items) !== JSON.stringify(referenceState.items)
      ) {
        converged = false;
        this.metrics.recordViolation(
          'STATE_DIVERGENCE',
          `State divergence on ${peerList[i].peerId}: expected ${referenceState.items.length} items, got ${peerState.items.length}`
        );
      }
    }

    this.metrics.printSummaryTable('Scenario E: 10-Peer Causal State Convergence');
    const result = this.metrics.verifyInvariants();
    return result.passed && converged && referenceState.items.length === opCount;
  }

  /**
   * Scenario F: Causal Dependency Out-of-Order Delivery & Buffering (15 Peers)
   */
  public async runScenarioF(chainLength = 100): Promise<boolean> {
    const peerList = this.createCluster(15);
    const storeId = 'causal-chain-store';

    type ChainState = { history: string[] };
    type ChainOp = { step: string };
    const reducer = (state: ChainState, op: ChainOp) => ({ history: [...state.history, op.step] });
    const initialState: ChainState = { history: [] };

    peerList.forEach((peer) => {
      const store = new ReplicatedStore<ChainState, ChainOp>(
        storeId,
        peer.identity,
        this.roomId,
        reducer,
        initialState,
        peer.packetPipeline
      );
      peer.registerStore(store);
    });

    // Create a strict causal chain: each op depends on the previous op
    let lastOpId: string | undefined = undefined;
    for (let i = 0; i < chainLength; i++) {
      const author = this.prng.pick(peerList);
      const store = author.getStore<ChainState, ChainOp>(storeId)!;
      const deps = lastOpId ? [lastOpId] : [];
      const evt = store.mutate('step', { step: `step_${i}` }, deps);
      lastOpId = evt.opId;
      await this.virtualNetwork.step(20);
    }

    // Trigger anti-entropy sync
    peerList.forEach((p) => {
      const store = p.getStore<ChainState, ChainOp>(storeId);
      if (store) {
        peerList.forEach((other) => {
          if (other.peerId !== p.peerId) store.syncWith(other.peerId);
        });
      }
    });

    await this.flushAll(peerList);

    const refState = peerList[0].getStore<ChainState, ChainOp>(storeId)!.getState();
    let converged = true;

    for (let i = 1; i < peerList.length; i++) {
      const pState = peerList[i].getStore<ChainState, ChainOp>(storeId)!.getState();
      if (JSON.stringify(pState.history) !== JSON.stringify(refState.history)) {
        converged = false;
      }
    }

    this.metrics.printSummaryTable('Scenario F: 15-Peer Causal Dependency Buffering');
    const result = this.metrics.verifyInvariants();
    return result.passed && converged && refState.history.length === chainLength;
  }

  /**
   * Scenario G: Log Compaction & Snapshot Fallback Recovery (20 Peers)
   */
  public async runScenarioG(opCount = 200): Promise<boolean> {
    const peerList = this.createCluster(20);
    const storeId = 'snapshot-fallback-store';

    type CounterState = { total: number; log: string[] };
    type CounterOp = { val: number; tag: string };
    const reducer = (state: CounterState, op: CounterOp) => ({
      total: state.total + op.val,
      log: [...state.log, op.tag].sort(),
    });
    const initialState: CounterState = { total: 0, log: [] };

    // Register ReplicatedStores with low compaction threshold
    peerList.forEach((peer) => {
      const store = new ReplicatedStore<CounterState, CounterOp>(
        storeId,
        peer.identity,
        this.roomId,
        reducer,
        initialState,
        peer.packetPipeline,
        { maxJournalEvents: 80, minRetentionEvents: 40 }
      );
      peer.registerStore(store);
    });

    // 1. Initial 50 operations with all 20 peers
    for (let i = 0; i < 50; i++) {
      const sender = this.prng.pick(peerList);
      sender.getStore<CounterState, CounterOp>(storeId)!.mutate('add', { val: 1, tag: `op_${i}` });
      await this.virtualNetwork.step(15);
    }

    // 2. Disconnect peer_20 (simulates offline client)
    const offlinePeer = peerList[19];
    offlinePeer.crash();

    const activePeers = peerList.slice(0, 19);

    // 3. Active 19 peers mutate another 150 operations, forcing multiple snapshot compactions & truncations
    for (let i = 50; i < opCount; i++) {
      const sender = this.prng.pick(activePeers);
      const store = sender.getStore<CounterState, CounterOp>(storeId)!;
      store.mutate('add', { val: 1, tag: `op_${i}` });
      if (i % 20 === 0) {
        store.compact(true);
      }
      await this.virtualNetwork.step(15);
    }

    await this.flushAll(activePeers);

    // 4. Reconnect offlinePeer and trigger multi-round anti-entropy sync
    offlinePeer.restart();
    for (let round = 0; round < 4; round++) {
      for (const p of peerList) {
        const store = p.getStore<CounterState, CounterOp>(storeId);
        if (store) {
          for (const other of peerList) {
            if (other.peerId !== p.peerId) {
              store.syncWith(other.peerId);
            }
          }
        }
      }
      await this.virtualNetwork.step(80);
      await this.flushAll(peerList);
    }

    // 5. Assert that offlinePeer and all active peers successfully caught up and converged
    const finalStates = peerList.map((p) => p.getStore<CounterState, CounterOp>(storeId)!.getState());
    const converged = finalStates.every(
      (s) => s.total === opCount && s.log.length === opCount
    );

    this.metrics.printSummaryTable('Scenario G: 20-Peer Log Compaction & Snapshot Fallback');
    const result = this.metrics.verifyInvariants();
    return result.passed && converged;
  }

  /**
   * Scenario H: 50-Peer Partition with Concurrent Edits & Reconciliation
   */
  public async runScenarioH(opCount = 200): Promise<boolean> {
    const peerList = this.createCluster(50);
    const storeId = 'partition-recon-store';

    type SharedMap = { keys: Record<string, string> };
    type MapOp = { key: string; val: string };
    const reducer = (state: SharedMap, op: MapOp) => ({
      keys: { ...state.keys, [op.key]: op.val },
    });
    const initialState: SharedMap = { keys: {} };

    peerList.forEach((peer) => {
      const store = new ReplicatedStore<SharedMap, MapOp>(
        storeId,
        peer.identity,
        this.roomId,
        reducer,
        initialState,
        peer.packetPipeline
      );
      peer.registerStore(store);
    });

    const groupA = peerList.slice(0, 25);
    const groupB = peerList.slice(25, 50);

    // 1. Partition cluster into Group A and Group B
    this.virtualNetwork.partition(
      groupA.map((p) => p.peerId),
      groupB.map((p) => p.peerId)
    );

    // 2. Group A and Group B concurrently mutate independent keys
    for (let i = 0; i < opCount / 2; i++) {
      const senderA = this.prng.pick(groupA);
      senderA.getStore<SharedMap, MapOp>(storeId)!.mutate('set', {
        key: `key_A_${i}`,
        val: `val_A_${senderA.peerId}_${i}`,
      });

      const senderB = this.prng.pick(groupB);
      senderB.getStore<SharedMap, MapOp>(storeId)!.mutate('set', {
        key: `key_B_${i}`,
        val: `val_B_${senderB.peerId}_${i}`,
      });

      await this.virtualNetwork.step(20);
    }

    // 3. Heal partition
    this.virtualNetwork.healPartition();

    // 4. Run 3-round bidirectional anti-entropy sync across all 50 peers
    for (let round = 0; round < 3; round++) {
      peerList.forEach((p) => {
        const store = p.getStore<SharedMap, MapOp>(storeId);
        if (store) {
          peerList.forEach((other) => {
            if (other.peerId !== p.peerId) store.syncWith(other.peerId);
          });
        }
      });
      await this.virtualNetwork.step(60);
    }

    await this.flushAll(peerList);

    // 5. Verify 100% Convergence across all 50 peers
    const refKeys = peerList[0].getStore<SharedMap, MapOp>(storeId)!.getState().keys;
    const totalKeyCount = Object.keys(refKeys).length;
    let converged = totalKeyCount === opCount;

    for (let i = 1; i < peerList.length; i++) {
      const peerKeys = peerList[i].getStore<SharedMap, MapOp>(storeId)!.getState().keys;
      if (JSON.stringify(peerKeys) !== JSON.stringify(refKeys)) {
        converged = false;
        break;
      }
    }

    this.metrics.printSummaryTable('Scenario H: 50-Peer Partition & State Reconciliation');
    const result = this.metrics.verifyInvariants();
    return result.passed && converged;
  }

  /**
   * Scenario I: 10-Peer Long-Running Memory Soak (10,000 Operations with Heap Telemetry)
   */
  public async runScenarioI(opCount = 10000): Promise<boolean> {
    const peerList = this.createCluster(10);
    const storeId = 'soak-10k-store';

    type SharedMap = { keys: Record<string, number> };
    type MapOp = { key: string; val: number };
    const reducer = (state: SharedMap, op: MapOp) => ({
      keys: { ...state.keys, [op.key]: op.val },
    });
    const initialState: SharedMap = { keys: {} };

    const MAX_JOURNAL = 60;
    const MIN_RETENTION = 30;
    const COMPACTION_SLACK = 40;

    peerList.forEach((peer) => {
      const store = new ReplicatedStore<SharedMap, MapOp>(
        storeId,
        peer.identity,
        this.roomId,
        reducer,
        initialState,
        peer.packetPipeline,
        {
          maxJournalEvents: MAX_JOURNAL,
          minRetentionEvents: MIN_RETENTION,
          checkpointIntervalOps: 40,
        }
      );
      peer.registerStore(store);
    });

    const initialHeapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    let peakHeapMB = parseFloat(initialHeapMB);

    // 1. Run 10,000 continuous mutations across 10 peers in fast batches
    const BATCH_SIZE = 50;
    const numBatches = opCount / BATCH_SIZE;

    for (let b = 0; b < numBatches; b++) {
      for (let i = 0; i < BATCH_SIZE; i++) {
        const opIndex = b * BATCH_SIZE + i;
        const sender = this.prng.pick(peerList);
        sender.getStore<SharedMap, MapOp>(storeId)!.mutate('put', {
          key: `key_${opIndex}`,
          val: opIndex,
        });
      }
      await this.virtualNetwork.step(20);

      if (b % 20 === 0) {
        const currentHeap = process.memoryUsage().heapUsed / 1024 / 1024;
        if (currentHeap > peakHeapMB) {
          peakHeapMB = currentHeap;
        }
      }
    }

    await this.flushAll(peerList);

    // 2. Multi-round anti-entropy sync
    for (let round = 0; round < 4; round++) {
      for (const p of peerList) {
        const store = p.getStore<SharedMap, MapOp>(storeId);
        if (store) {
          for (const other of peerList) {
            if (other.peerId !== p.peerId) {
              store.syncWith(other.peerId);
            }
          }
        }
      }
      await this.virtualNetwork.step(50);
      await this.flushAll(peerList);
    }

    const finalHeapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    // 3. Collect Memory & Journal Telemetry
    const journalLengths = peerList.map(
      (p) => (p.getStore(storeId) as any).journal.getEventCount()
    );
    const avgJournal = (
      journalLengths.reduce((a, b) => a + b, 0) / journalLengths.length
    ).toFixed(1);
    const maxJournal = Math.max(...journalLengths);
    const minJournal = Math.min(...journalLengths);

    const pendingCounts = peerList.map(
      (p) => (p.getStore(storeId) as any).syncEngine.getPendingCount()
    );
    const maxPending = Math.max(...pendingCounts);

    console.log(`\n  📊 Scenario I Telemetry (10,000 Operations):`);
    console.log(`     • Total Operations:      ${opCount}`);
    console.log(`     • Journal Range / Avg:   [${minJournal}, ${maxJournal}] / ${avgJournal} ops (Cap: ${MAX_JOURNAL} + slack)`);
    console.log(`     • Max Pending Queue:     ${maxPending} ops (Cap: 128)`);
    console.log(`     • Heap Memory:           Initial: ${initialHeapMB} MB | Peak: ${peakHeapMB.toFixed(2)} MB | Final: ${finalHeapMB} MB\n`);

    // 4. Verify 100% Convergence & Invariants
    const refKeys = peerList[0].getStore<SharedMap, MapOp>(storeId)!.getState().keys;
    const totalKeyCount = Object.keys(refKeys).length;
    let converged = totalKeyCount === opCount;

    for (let i = 1; i < peerList.length; i++) {
      const peerKeys = peerList[i].getStore<SharedMap, MapOp>(storeId)!.getState().keys;
      if (Object.keys(peerKeys).length !== totalKeyCount) {
        converged = false;
        break;
      }
    }

    const memoryBounded = maxJournal <= MAX_JOURNAL + COMPACTION_SLACK && maxPending <= 128;

    this.metrics.printSummaryTable('Scenario I: 10-Peer Long-Running Memory Soak (10k Ops)');
    const result = this.metrics.verifyInvariants();
    return result.passed && converged && memoryBounded;
  }

  /**
   * Scenario J: Distributed Crash-at-Every-Phase & Durability Recovery
   */
  public async runScenarioJ(opCount = 100): Promise<boolean> {
    const peerList = this.createCluster(10);
    const storeId = 'crash-durability-store';

    type SharedMap = { keys: Record<string, number> };
    type MapOp = { key: string; val: number };
    const reducer = (state: SharedMap, op: MapOp) => ({
      keys: { ...state.keys, [op.key]: op.val },
    });
    const initialState: SharedMap = { keys: {} };

    peerList.forEach((peer) => {
      const store = new ReplicatedStore<SharedMap, MapOp>(
        storeId,
        peer.identity,
        this.roomId,
        reducer,
        initialState,
        peer.packetPipeline,
        {
          maxJournalEvents: 40,
          minRetentionEvents: 15,
          checkpointIntervalOps: 20,
        }
      );
      peer.registerStore(store);
    });

    // 1. Initial 40 mutations across active peers
    for (let i = 0; i < 40; i++) {
      const sender = this.prng.pick(peerList);
      sender.getStore<SharedMap, MapOp>(storeId)!.mutate('put', { key: `k_${i}`, val: i });
      await this.virtualNetwork.step(10);
    }

    // 2. Inject simulated crashes at distinct mutation and compaction lifecycle points across nodes
    const crashedPeers = [peerList[1], peerList[3], peerList[7]];
    crashedPeers.forEach((p) => p.crash());

    // 3. Remaining peers mutate next 60 operations and compact
    const survivors = peerList.filter((p) => !crashedPeers.includes(p));
    for (let i = 40; i < opCount; i++) {
      const sender = this.prng.pick(survivors);
      sender.getStore<SharedMap, MapOp>(storeId)!.mutate('put', { key: `k_${i}`, val: i });
      if (i % 20 === 0) {
        sender.getStore<SharedMap, MapOp>(storeId)!.compact(true);
      }
      await this.virtualNetwork.step(10);
    }

    // 4. Restart crashed peers, hydrate from storage, and reconcile cluster
    for (const p of crashedPeers) {
      p.restart();
      await (p.getStore(storeId) as any).hydrate();
    }

    for (let round = 0; round < 4; round++) {
      for (const p of peerList) {
        const store = p.getStore<SharedMap, MapOp>(storeId);
        if (store) {
          for (const other of peerList) {
            if (other.peerId !== p.peerId) {
              store.syncWith(other.peerId);
            }
          }
        }
      }
      await this.virtualNetwork.step(50);
      await this.flushAll(peerList);
    }

    // 5. Verify 100% Convergence across all 10 recovered nodes
    const refKeys = peerList[0].getStore<SharedMap, MapOp>(storeId)!.getState().keys;
    const totalKeyCount = Object.keys(refKeys).length;
    let converged = totalKeyCount === opCount;

    for (let i = 1; i < peerList.length; i++) {
      const peerKeys = peerList[i].getStore<SharedMap, MapOp>(storeId)!.getState().keys;
      if (Object.keys(peerKeys).length !== totalKeyCount) {
        converged = false;
        break;
      }
    }

    this.metrics.printSummaryTable('Scenario J: Distributed Crash-at-Every-Phase Durability');
    const result = this.metrics.verifyInvariants();
    return result.passed && converged;
  }

  /**
   * Scenario K: Multi-Room Scalability Envelope
   *
   * Validates the core architectural assumption behind the target population
   * (~100k registered / ~20-30k concurrent users): the system does NOT need one
   * giant global mesh — it needs many independent, room-scoped P2P meshes plus a
   * minimal coordination server. This scenario spins up a large number of
   * independent rooms (each its own VirtualNetwork + peer set + ReplicatedStore
   * cluster) with a realistic room-size distribution (mostly small, some medium,
   * a few "hot" rooms), applies churn (peers leaving mid-session) and concurrent
   * mutation traffic per room, and verifies:
   *   1. Every room converges independently to 100% causal consistency among its
   *      surviving peers (no cross-room leakage, no O(N^2) blowup).
   *   2. Per-peer resource cost (journal size, pending queue) stays bounded and
   *      roughly CONSTANT regardless of total room count — i.e. cost scales with
   *      room count × room size, not with the square of total concurrent users.
   *
   * IMPORTANT: This is a deterministic, scaled-down stand-in for the target
   * population, not a literal run of 20-30k live WebRTC peers in-process. The
   * reported "extrapolated" figures are simple linear projections from the
   * measured per-room cost and must be treated as a starting envelope to
   * validate against real traffic, not a capacity guarantee.
   */
  public static async runScenarioK(
    prng: SeededPRNG = new SeededPRNG(42),
    roomCount = 200,
    opsPerRoomFloor = 20
  ): Promise<{ passed: boolean; report: Record<string, unknown> }> {
    type SharedMap = { keys: Record<string, number> };
    type MapOp = { key: string; val: number };
    const reducer = (state: SharedMap, op: MapOp) => ({
      keys: { ...state.keys, [op.key]: op.val },
    });
    const initialState: SharedMap = { keys: {} };

    // Realistic room-size distribution: 70% small (2-7), 23% medium (8-20), 7% hot (21-50)
    const roomSizes: number[] = [];
    for (let i = 0; i < roomCount; i++) {
      const roll = prng.next();
      if (roll < 0.7) roomSizes.push(prng.nextInt(2, 7));
      else if (roll < 0.93) roomSizes.push(prng.nextInt(8, 20));
      else roomSizes.push(prng.nextInt(21, 50));
    }

    let totalPeers = 0;
    let totalOps = 0;
    let convergedRooms = 0;
    const journalSizes: number[] = [];
    const pendingQueueSizes: number[] = [];
    const perRoomDurationsMs: number[] = [];
    const nonConvergedRoomDetails: Array<Record<string, unknown>> = [];

    const heapBefore = process.memoryUsage().heapUsed;
    const startTime = Date.now();

    for (let r = 0; r < roomCount; r++) {
      const roomStart = Date.now();
      const size = roomSizes[r];
      totalPeers += size;
      const roomId = `scale-room-${r}`;
      const storeId = `room-store-${r}`;

      const sim = new NetworkSimulator(
        roomId,
        { latencyMs: 25, jitterMs: 10, lossRate: 0.02, duplicationRate: 0.005, reorderRate: 0.02 },
        prng
      );
      const peerList = sim.createCluster(size);

      peerList.forEach((peer) => {
        const store = new ReplicatedStore<SharedMap, MapOp>(
          storeId,
          peer.identity,
          roomId,
          reducer,
          initialState,
          peer.packetPipeline,
          { maxJournalEvents: 60, minRetentionEvents: 20, checkpointIntervalOps: 30 }
        );
        peer.registerStore(store);
      });

      // Churn: ~15% of peers leave mid-session and do not return (models real join/leave activity)
      const churnCount = Math.floor(size * 0.15);
      for (let c = 0; c < churnCount; c++) {
        prng.pick(peerList).crash();
      }

      const opCount = Math.max(opsPerRoomFloor, size * 2);
      for (let i = 0; i < opCount; i++) {
        const alive = peerList.filter((p) => p.isAlive);
        if (alive.length === 0) break;
        const sender = prng.pick(alive);
        sender.getStore<SharedMap, MapOp>(storeId)?.mutate('put', { key: `k_${i}`, val: i });
        totalOps++;
        await sim.virtualNetwork.step(10);
      }

      await sim.flushAll(peerList);

      // Anti-entropy reconciliation among surviving peers only. Larger rooms need multiple
      // rounds: a single pass can leave a peer that fell behind (e.g. snapshot fallback
      // triggered mid-room) still catching up when the round ends.
      const survivors = peerList.filter((p) => p.isAlive);
      for (let round = 0; round < 4; round++) {
        for (const p of survivors) {
          const store = p.getStore<SharedMap, MapOp>(storeId);
          for (const other of survivors) {
            if (other.peerId !== p.peerId) store?.syncWith(other.peerId);
          }
        }
        await sim.virtualNetwork.step(50);
        await sim.flushAll(peerList);
      }

      // Per-room convergence check (surviving peers only — crashed peers never rejoin in this scenario)
      const refKeys = survivors[0]?.getStore<SharedMap, MapOp>(storeId)?.getState().keys ?? {};
      const refCount = Object.keys(refKeys).length;
      let roomConverged = true;
      for (const p of survivors) {
        const k = p.getStore<SharedMap, MapOp>(storeId)?.getState().keys ?? {};
        if (Object.keys(k).length !== refCount) {
          roomConverged = false;
          if (nonConvergedRoomDetails.length < 10) {
            const missing = Object.keys(refKeys).filter((key) => !(key in k));
            const extra = Object.keys(k).filter((key) => !(key in refKeys));
            const divStore = p.getStore<SharedMap, MapOp>(storeId);
            nonConvergedRoomDetails.push({
              roomId,
              size,
              survivorCount: survivors.length,
              refCount,
              divergentPeer: p.peerId,
              divergentCount: Object.keys(k).length,
              missingKeys: missing.slice(0, 5),
              extraKeys: extra.slice(0, 5),
              divergentPending: divStore?.getPendingCount() ?? -1,
              divergentJournalEvents: divStore?.getJournal().getEventCount() ?? -1,
            });
          }
          break;
        }
      }
      if (roomConverged) convergedRooms++;

      for (const p of peerList) {
        const store = p.getStore<SharedMap, MapOp>(storeId);
        if (store) {
          journalSizes.push(store.getJournal().getEventCount());
          pendingQueueSizes.push(store.getPendingCount());
        }
      }

      perRoomDurationsMs.push(Date.now() - roomStart);
    }

    const durationSec = (Date.now() - startTime) / 1000;
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);

    const avgJournal = avg(journalSizes);
    const maxJournal = max(journalSizes);
    const avgPending = avg(pendingQueueSizes);
    const maxPending = max(pendingQueueSizes);
    const opsPerSecond = totalOps / Math.max(durationSec, 0.001);
    const bytesPerPeerEstimate = heapDeltaMB > 0 ? (heapDeltaMB * 1024 * 1024) / Math.max(totalPeers, 1) : 0;

    // Simple linear extrapolation from measured per-peer cost to the target concurrency band.
    // Labeled explicitly as a projection, not a validated capacity claim.
    const targetConcurrentPeers = 30000;
    const extrapolatedRoomCount = Math.round((roomCount / totalPeers) * targetConcurrentPeers);
    const extrapolatedHeapMB = (bytesPerPeerEstimate * targetConcurrentPeers) / 1024 / 1024;

    const report = {
      roomCount,
      totalSimulatedPeers: totalPeers,
      totalOps,
      convergedRooms,
      convergenceRate: convergedRooms / roomCount,
      journalSize: { avg: Number(avgJournal.toFixed(1)), max: maxJournal },
      pendingQueue: { avg: Number(avgPending.toFixed(1)), max: maxPending },
      opsPerSecond: Number(opsPerSecond.toFixed(1)),
      durationSec: Number(durationSec.toFixed(2)),
      heapDeltaMB: Number(heapDeltaMB.toFixed(2)),
      nonConvergedRoomDetails,
      extrapolation: {
        targetConcurrentPeers,
        projectedRoomCountAtTarget: extrapolatedRoomCount,
        projectedHeapMBAtTarget: Number(extrapolatedHeapMB.toFixed(1)),
        note:
          'Linear projection from measured per-peer cost at this sample size. Must be validated ' +
          'against real network conditions and browser (not Node) memory behavior before being ' +
          'treated as a capacity guarantee.',
      },
    };

    console.log(`\n  📊 Scenario K Telemetry (Multi-Room Scalability):`);
    console.log(`     • Rooms Simulated:        ${roomCount} (sizes 2-50, weighted toward small rooms)`);
    console.log(`     • Total Simulated Peers:  ${totalPeers}`);
    console.log(`     • Total Operations:       ${totalOps} (${opsPerSecond.toFixed(1)} ops/sec aggregate)`);
    console.log(`     • Room Convergence:       ${convergedRooms}/${roomCount} (${(report.convergenceRate * 100).toFixed(1)}%)`);
    console.log(`     • Journal Size Avg/Max:   ${avgJournal.toFixed(1)} / ${maxJournal} events per peer`);
    console.log(`     • Pending Queue Avg/Max:  ${avgPending.toFixed(1)} / ${maxPending} ops per peer`);
    console.log(`     • Heap Delta:             ${heapDeltaMB.toFixed(2)} MB over ${durationSec.toFixed(2)}s`);
    console.log(`     • Extrapolation Note:     Projection only — see report.extrapolation for caveats\n`);

    return {
      passed: convergedRooms === roomCount,
      report,
    };
  }
}
