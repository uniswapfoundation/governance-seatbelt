# Issue #92: Decision Header Visual Mockup

## Current Layout (Before)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ Simulated Execution                                                              │
│     This is a simulation of a new proposal that has not been submitted on-chain     │
│     yet. Placeholder addresses are being used for the proposer/executor.            │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  ## Increase UNI Community Allocation                                              │
│  Status: [✓ Passed]                                                                │
│  Simulation completed successfully for proposal: "Increase UNI Community..."       │
│                                                                                     │
│  ┌─ Overview ─┐┌─ Checks ─┐┌─ State Changes ─┐                                     │
│  │            ││          ││                 │                                     │
│  │ 📋 Proposal Details                       │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ # Increase UNI Community Allocation     │ │                                     │
│  │ │ This proposal increases...              │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │                                            │                                     │
│  │ 🔧 Calldata Decoded                        │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ 0x1a9c... calls sendMessage()          │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │                                            │                                     │
│  │ 📊 Metadata                                │                                     │
│  │ ┌─────────────────┐ ┌─────────────────────┐ │                                     │
│  │ │ Block Number    │ │ Timestamp           │ │                                     │
│  │ │ 12345678 ↗      │ │ 2 hours ago         │ │                                     │
│  │ └─────────────────┘ └─────────────────────┘ │                                     │
│  │ ┌─────────────────┐ ┌─────────────────────┐ │                                     │
│  │ │ Proposal ID     │ │ Network             │ │                                     │
│  │ │ 92              │ │ Ethereum            │ │                                     │
│  │ └─────────────────┘ └─────────────────────┘ │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ Proposer                                │ │                                     │
│  │ │ 0x0000...1234 ↗ [Simulation Placeholder]│ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ Executor                                │ │                                     │
│  │ │ 0x1a9c...82c3 ↗                        │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ Governor                                │ │                                     │
│  │ │ 0x408e...4c3 ↗                          │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  └────────────────────────────────────────────┘                                     │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## New Layout (After)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [PASS] Increase UNI Community Allocation                                     #92 │
│  Ran 10/10 checks • 2 hours ago • Block 12345678 ↗ • Ethereum                     │
│  Repo abc1234 • Tenderly ↗                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ Simulated Execution                                                              │
│     This is a simulation of a new proposal that has not been submitted on-chain     │
│     yet. Placeholder addresses are being used for the proposer/executor.            │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  ┌─ Overview ─┐┌─ Checks ─┐┌─ State Changes ─┐                                     │
│  │            ││          ││                 │                                     │
│  │ 📋 Proposal Details                       │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ # Increase UNI Community Allocation     │ │                                     │
│  │ │ This proposal increases...              │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │                                            │                                     │
│  │ 🔧 Calldata Decoded                        │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ 0x1a9c... calls sendMessage()          │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │                                            │                                     │
│  │ 📊 Metadata                                │ ← KEPT - All address info preserved │
│  │ ┌─────────────────┐ ┌─────────────────────┐ │                                     │
│  │ │ Block Number    │ │ Timestamp           │ │                                     │
│  │ │ 12345678 ↗      │ │ 2 hours ago         │ │                                     │
│  │ └─────────────────┘ └─────────────────────┘ │                                     │
│  │ ┌─────────────────┐ ┌─────────────────────┐ │                                     │
│  │ │ Proposal ID     │ │ Network             │ │                                     │
│  │ │ 92              │ │ Ethereum            │ │                                     │
│  │ └─────────────────┘ └─────────────────────┘ │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ Proposer                                │ │                                     │
│  │ │ 0x0000...1234 ↗ [Simulation Placeholder]│ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ Executor                                │ │                                     │
│  │ │ 0x1a9c...82c3 ↗                        │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  │ ┌─────────────────────────────────────────┐ │                                     │
│  │ │ Governor                                │ │                                     │
│  │ │ 0x408e...4c3 ↗                          │ │                                     │
│  │ └─────────────────────────────────────────┘ │                                     │
│  └────────────────────────────────────────────┘                                     │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Component Structure

### Before
```
<div className="w-full border border-muted rounded-md p-6">
  <SimulationWarningBanner />
  
  <div className="mb-6">
    <h2>Proposal Title</h2>
    <div>Status: [Badge]</div>
    <p>Summary text...</p>
  </div>
  
  <Tabs>
    <TabsContent value="overview">
      <ProposalDetails />
      <CalldataDecoded />
      <MetadataPanel />  ← Has all the address info
    </TabsContent>
    <TabsContent value="checks">...</TabsContent>
    <TabsContent value="state-changes">...</TabsContent>
  </Tabs>
</div>
```

### After
```
<div className="w-full">
  <DecisionHeader report={report} />  ← NEW: Compact header with key metrics
  <p className="text-muted-foreground">{report.summary}</p>
  
  <div className="border border-muted rounded-md p-6">
    <SimulationWarningBanner />  ← KEPT: Detailed warnings
    
    <Tabs>
      <TabsContent value="overview">
        <ProposalDetails />
        <CalldataDecoded />
        <MetadataPanel />  ← KEPT: All address info preserved
      </TabsContent>
      <TabsContent value="checks">...</TabsContent>
      <TabsContent value="state-changes">...</TabsContent>
    </Tabs>
  </div>
</div>
```

## Markdown Executive Summary (New)

```
# Increase UNI Community Allocation

## Executive Summary
- Status: PASS
- Checks: Ran 10/10 checks
- Simulation: 2 hours ago • Block 12345678 (Ethereum)
- Repo: abc1234
- Tenderly: https://dashboard.tenderly.co/.../sim

## Table of contents
```

## Decision Header Variants

### Success State
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [PASS] Increase UNI Community Allocation                                     #92 │
│  Ran 15/15 checks • 3 hours ago • Block 12345678 ↗ • Ethereum                     │
│  Repo abc1234 • Tenderly ↗                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Warning State
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [WARN] Update Treasury Management                                           #93 │
│  Ran 15/15 checks • Warnings: 3 • 1 hour ago • Block 12345679 ↗ • Arbitrum One    │
│  Repo abc1234 • Tenderly ↗                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Error State
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [FAIL] Malicious Proposal Example                                          #94 │
│  Ran 15/15 checks • Failures: 2 • 30 minutes ago • Block 12345680 ↗ • Optimism    │
│  Repo abc1234 • Tenderly ↗                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Inconclusive State
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [INCONCLUSIVE] Cross-chain Preview Timeout                                 #95 │
│  Ran 9/15 checks • 2 hours ago • Block 12345681 ↗ • Base                         │
│  Repo abc1234 • Tenderly ↗                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Edge Cases

#### Long Title
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [PASS] This is a Very Long Proposal Title That Might Wrap to Multiple...     #95 │
│  Ran 8/8 checks • 5 minutes ago • Block 12345681 ↗ • Base                         │
│  Repo abc1234 • Tenderly ↗                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

#### Missing Block (Legacy Report)
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  [PASS] Legacy Report Example                                               #96 │
│  Ran 10/10 checks • Unknown time • Ethereum                                      │
│  Repo abc1234 • Tenderly ↗                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

#### Mobile/Responsive (Stacked)
```
┌─────────────────────────────────────────────┐
│  [PASS] Increase UNI Community            │
│  Allocation                           #92 │
│  Ran 10/10 checks • 2 hours ago            │
│  Block 12345678 ↗ • Ethereum               │
│  Repo abc1234 • Tenderly ↗                 │
└─────────────────────────────────────────────┘
```

## Key Benefits Visualized

1. **Immediate Status Recognition**: Status icon and badge at top-left
2. **Quick Metrics**: Ran N/N, warnings/failures (if any), age, and block info
3. **No Information Loss**: Metadata panel preserved with all addresses
4. **Clean Hierarchy**: Header → Warning → Content
5. **Responsive Design**: Info wraps nicely on smaller screens
6. **Contextual Links**: Block, repo commit, and Tenderly links appear when valid

## What Users See at a Glance
- ✅ Overall status (PASS/WARN/INCONCLUSIVE/FAIL)
- 📊 Coverage (Ran N/N checks)
- ⏰ How recent (2 hours ago)
- 🔗 Block verification link
- 🧾 Repo commit + Tenderly links
- 🌐 Which chain (Ethereum)
- ⚠️ Any simulation warnings
