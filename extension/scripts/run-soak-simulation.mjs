#!/usr/bin/env node
// ─── P2.5 Large-Scale Soak & Fault-Injection Simulation Runner ───

import { NetworkSimulator } from '../src/core/simulation/network-simulator.ts';
import { SeededPRNG } from '../src/core/simulation/prng.ts';

// Parse CLI flags
const args = process.argv.slice(2);
let targetScenario = 'ALL';
let seed = 42;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scenario' && args[i + 1]) {
    targetScenario = args[i + 1].toUpperCase();
    i++;
  } else if (args[i] === '--seed' && args[i + 1]) {
    seed = parseInt(args[i + 1], 10);
    i++;
  }
}

console.log(`\n🚀 Starting Synqto P2.5 Large-Scale Network Validation Harness`);
console.log(`   Config: Scenario=${targetScenario} | Seed=${seed}\n`);

let totalPassed = 0;
let totalScenarios = 0;

async function executeScenario(name, runner) {
  totalScenarios++;
  console.log(`\n⏳ Running ${name} (Seed: ${seed})...`);
  const startTime = Date.now();

  try {
    const passed = await runner();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (passed) {
      console.log(`✅ ${name} PASSED in ${duration}s (All Invariants Verified)\n`);
      totalPassed++;
    } else {
      console.error(`❌ ${name} FAILED in ${duration}s (Invariant Violations Detected)\n`);
    }
  } catch (err) {
    console.error(`❌ ${name} ERRORED:`, err);
  }
}

async function runAll() {
  if (targetScenario === 'A' || targetScenario === 'ALL') {
    await executeScenario('Scenario A: 10-Peer Baseline Soak (1,000 Packets)', async () => {
      const sim = new NetworkSimulator('room-soak-a', {
        latencyMs: 30,
        jitterMs: 10,
        lossRate: 0.02,
        duplicationRate: 0.005,
        reorderRate: 0.02,
      }, new SeededPRNG(seed));
      return await sim.runScenarioA(1000);
    });
  }

  if (targetScenario === 'B' || targetScenario === 'ALL') {
    await executeScenario('Scenario B: 25-Peer Dynamic Leader Failure & Route Shift', async () => {
      const sim = new NetworkSimulator('room-soak-b', {
        latencyMs: 35,
        jitterMs: 15,
        lossRate: 0.03,
        duplicationRate: 0.01,
        reorderRate: 0.03,
      }, new SeededPRNG(seed));
      return await sim.runScenarioB(800);
    });
  }

  if (targetScenario === 'C' || targetScenario === 'ALL') {
    await executeScenario('Scenario C: 50-Peer Partition & Healing Reconciliation', async () => {
      const sim = new NetworkSimulator('room-soak-c', {
        latencyMs: 40,
        jitterMs: 20,
        lossRate: 0.03,
        duplicationRate: 0.005,
        reorderRate: 0.04,
      }, new SeededPRNG(seed));
      return await sim.runScenarioC(900);
    });
  }

  if (targetScenario === 'D' || targetScenario === 'ALL') {
    await executeScenario('Scenario D: 100-Peer Adversarial Stress & Chunking Run', async () => {
      const sim = new NetworkSimulator('room-soak-d', {
        latencyMs: 50,
        jitterMs: 25,
        lossRate: 0.05,
        duplicationRate: 0.01,
        reorderRate: 0.05,
      }, new SeededPRNG(seed));
      return await sim.runScenarioD(1200);
    });
  }

  if (targetScenario === 'E' || targetScenario === 'ALL') {
    await executeScenario('Scenario E: 10-Peer Causal State Convergence (300 Ops)', async () => {
      const sim = new NetworkSimulator('room-soak-e', {
        latencyMs: 30,
        jitterMs: 15,
        lossRate: 0.02,
        duplicationRate: 0.005,
        reorderRate: 0.03,
      }, new SeededPRNG(seed));
      return await sim.runScenarioE(300);
    });
  }

  if (targetScenario === 'F' || targetScenario === 'ALL') {
    await executeScenario('Scenario F: 15-Peer Causal Dependency Buffering', async () => {
      const sim = new NetworkSimulator('room-soak-f', {
        latencyMs: 35,
        jitterMs: 20,
        lossRate: 0.03,
        duplicationRate: 0.01,
        reorderRate: 0.05,
      }, new SeededPRNG(seed));
      return await sim.runScenarioF(100);
    });
  }

  if (targetScenario === 'G' || targetScenario === 'ALL') {
    await executeScenario('Scenario G: 20-Peer Log Compaction & Snapshot Fallback', async () => {
      const sim = new NetworkSimulator('room-soak-g', {
        latencyMs: 30,
        jitterMs: 15,
        lossRate: 0.02,
        duplicationRate: 0.005,
        reorderRate: 0.03,
      }, new SeededPRNG(seed));
      return await sim.runScenarioG(200);
    });
  }

  if (targetScenario === 'H' || targetScenario === 'ALL') {
    await executeScenario('Scenario H: 50-Peer Partition & State Reconciliation', async () => {
      const sim = new NetworkSimulator('room-soak-h', {
        latencyMs: 40,
        jitterMs: 20,
        lossRate: 0.03,
        duplicationRate: 0.01,
        reorderRate: 0.04,
      }, new SeededPRNG(seed));
      return await sim.runScenarioH(200);
    });
  }

  if (targetScenario === 'I' || targetScenario === 'ALL') {
    await executeScenario('Scenario I: 10-Peer Long-Running Memory Soak (10k Ops)', async () => {
      const sim = new NetworkSimulator('room-soak-i', {
        latencyMs: 15,
        jitterMs: 5,
        lossRate: 0.01,
        duplicationRate: 0.005,
        reorderRate: 0.02,
      }, new SeededPRNG(seed));
      return await sim.runScenarioI(10000);
    });
  }

  if (targetScenario === 'J' || targetScenario === 'ALL') {
    await executeScenario('Scenario J: Distributed Crash-at-Every-Phase Durability', async () => {
      const sim = new NetworkSimulator('room-soak-j', {
        latencyMs: 20,
        jitterMs: 10,
        lossRate: 0.02,
        duplicationRate: 0.005,
        reorderRate: 0.02,
      }, new SeededPRNG(seed));
      return await sim.runScenarioJ(100);
    });
  }

  console.log(`\n============================================================`);
  console.log(`🏁 Soak & Replication Simulation Summary: ${totalPassed}/${totalScenarios} Scenarios Passed (${Math.round((totalPassed / totalScenarios) * 100)}%)`);
  console.log(`============================================================\n`);

  if (totalPassed !== totalScenarios) {
    process.exit(1);
  }
}

runAll();
