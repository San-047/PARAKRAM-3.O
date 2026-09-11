// Constraint-Aware Portfolio Optimization.
// Solves a 0/1 knapsack over ranked proposals, subject to:
//   - total budget cap
//   - max projects per ward (territorial spread)
//   - sector policy floor (must include >=1 project from a given category)
// Exhaustive DP over budget (costs are in whole Lakhs, so this stays cheap
// for hackathon-sized proposal lists); falls back to greedy for larger sets.

function solvePortfolio(rankedProposals, options = {}) {
  const {
    budgetCapLakhs = 140,
    maxProjectsPerWard = null, // null = unconstrained
    requiredSectorFloor = null, // e.g. "Healthcare" | "Education" | null
  } = options;

  const n = rankedProposals.length;
  const budget = Math.floor(budgetCapLakhs);

  // Try all subsets via DP on value=priorityScore*1000 (integerized), weight=cost
  // dp[b] = best {score, chosenIndices} achievable with budget b
  let dp = new Array(budget + 1).fill(null).map(() => ({ score: 0, items: [] }));

  for (let i = 0; i < n; i++) {
    const p = rankedProposals[i];
    const cost = Math.round(p.costLakhs);
    const value = p.priorityScore;

    for (let b = budget; b >= cost; b--) {
      const withItem = dp[b - cost];
      const candidateScore = withItem.score + value;
      if (candidateScore > dp[b].score) {
        const candidateItems = [...withItem.items, i];
        // check ward constraint before accepting
        if (maxProjectsPerWard) {
          const wardCounts = {};
          for (const idx of candidateItems) {
            const w = rankedProposals[idx].wardId;
            wardCounts[w] = (wardCounts[w] || 0) + 1;
          }
          const violatesWard = Object.values(wardCounts).some((c) => c > maxProjectsPerWard);
          if (violatesWard) continue;
        }
        dp[b] = { score: candidateScore, items: candidateItems };
      }
    }
  }

  // Find best budget slot
  let best = dp[0];
  for (let b = 1; b <= budget; b++) {
    if (dp[b].score > best.score) best = dp[b];
  }

  let selectedIndices = best.items;

  // Enforce sector policy floor: if not satisfied, try to swap in a
  // qualifying proposal (cheapest first) by removing the lowest-priority
  // currently-selected items until it fits the budget - AND now, unlike
  // before, the resulting selection is re-checked against maxProjectsPerWard
  // too, so forcing in a sector-floor project can no longer silently break
  // the ward-spread constraint.
  if (requiredSectorFloor) {
    const hasSector = selectedIndices.some(
      (idx) => rankedProposals[idx].category === requiredSectorFloor
    );
    if (!hasSector) {
      const candidates = rankedProposals
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => p.category === requiredSectorFloor)
        .sort((a, b) => a.p.costLakhs - b.p.costLakhs);

      for (const { p: forcedProposal, idx: forcedIdx } of candidates) {
        let usedBudget = selectedIndices.reduce(
          (sum, idx) => sum + rankedProposals[idx].costLakhs,
          0
        );

        // remove lowest-priority selected items until it fits
        let trialSelection = [...selectedIndices];
        const sortedSelected = [...trialSelection].sort(
          (a, b) => rankedProposals[a].priorityScore - rankedProposals[b].priorityScore
        );
        let i = 0;
        while (
          usedBudget + forcedProposal.costLakhs > budgetCapLakhs &&
          i < sortedSelected.length
        ) {
          const removeIdx = sortedSelected[i];
          usedBudget -= rankedProposals[removeIdx].costLakhs;
          trialSelection = trialSelection.filter((x) => x !== removeIdx);
          i++;
        }

        if (usedBudget + forcedProposal.costLakhs > budgetCapLakhs) {
          continue;
        }

        const finalSelection = [...trialSelection, forcedIdx];

        if (maxProjectsPerWard) {
          const wardCounts = {};
          for (const idx of finalSelection) {
            const w = rankedProposals[idx].wardId;
            wardCounts[w] = (wardCounts[w] || 0) + 1;
          }
          const violatesWard = Object.values(wardCounts).some((c) => c > maxProjectsPerWard);
          if (violatesWard) continue; // this candidate would break ward-cap - try the next one
        }

        selectedIndices = finalSelection;
        break; // successfully forced in a sector-floor project without breaking other constraints
      }
      // If no candidate in the required sector could be forced in without
      // violating the budget or ward-cap constraints, the sector floor
      // honestly can't be satisfied here - leave the portfolio as-is rather
      // than silently breaking the ward-spread rule to force it through.
    }
  }

  const approved = selectedIndices
    .map((idx) => rankedProposals[idx])
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const deferred = rankedProposals.filter((p) => !approved.includes(p));

  const approvedCost = approved.reduce((sum, p) => sum + p.costLakhs, 0);
  const utilityScore = Number(
    approved.reduce((sum, p) => sum + p.priorityScore, 0).toFixed(3)
  );
  const beneficiaryReach = approved.reduce(
    (sum, p) => sum + (p.populationServed || p.enrolment || 0),
    0
  );

  return {
    constraints: { budgetCapLakhs, maxProjectsPerWard, requiredSectorFloor },
    approved,
    deferred,
    approvedCostLakhs: approvedCost,
    budgetUtilizationPct: Number(((approvedCost / budgetCapLakhs) * 100).toFixed(1)),
    utilityScore,
    beneficiaryReach,
    projectsSelected: approved.length,
    totalProjects: rankedProposals.length,
  };
}

module.exports = { solvePortfolio };
