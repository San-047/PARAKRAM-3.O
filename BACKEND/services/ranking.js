const { INFRA_BASELINE, WARDS } = require("../data");

function normalize(value, min, max) {
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// Infra Deficit Gap: blends the ward-level baseline (schools/roads/water
// coverage) with THIS SPECIFIC proposal's average travel distance, so two
// proposals in the same ward - one serving people 15km away, one right next
// door - no longer get an identical gap score just because they share a ward.
function infraGapScore(proposal, allProposals) {
  const baseline = INFRA_BASELINE[proposal.wardId];
  let wardComponent = 0.5;
  if (baseline) {
    const roadDeficit = 1 - baseline.roadConditionIndex;
    const waterDeficit = 1 - baseline.waterCoverage;
    const facilityDeficit = 1 - normalize(baseline.schools + baseline.healthCenters, 0, 8);
    wardComponent = (roadDeficit + waterDeficit + facilityDeficit) / 3;
  }

  const maxTravel = Math.max(...allProposals.map((p) => p.avgTravelDistanceKm || 0), 1);
  const travelComponent = normalize(proposal.avgTravelDistanceKm || 0, 0, maxTravel);

  // 70% ward-level baseline conditions, 30% this proposal's own travel-
  // distance burden on the people it serves.
  return Number((wardComponent * 0.7 + travelComponent * 0.3).toFixed(3));
}

// Projects that only report ENROLMENT (Education) aren't measuring the same
// thing as projects that report POPULATION SERVED (Healthcare/Water/etc) -
// directly comparing raw enrolment (hundreds) against population served
// (tens of thousands) unfairly tanks every education proposal's reach score
// purely due to scale, not real impact. We convert enrolment to a rough
// population-equivalent using an assumed average household size so students'
// families are counted too - a documented assumption, not exact census data.
const ASSUMED_HOUSEHOLD_SIZE = 4.5;
function effectiveReach(proposal) {
  if (proposal.populationServed) return proposal.populationServed;
  if (proposal.enrolment) return proposal.enrolment * ASSUMED_HOUSEHOLD_SIZE;
  return 0;
}

// Demographic Reach: effective population reached, relative to the
// constituency-wide max (now on a comparable scale across project types).
function demographicReachScore(proposal, allProposals) {
  const served = effectiveReach(proposal);
  const maxServed = Math.max(...allProposals.map((p) => effectiveReach(p)), 1);
  return Number(normalize(served, 0, maxServed).toFixed(3));
}

// Cost Efficiency: lower cost per (effective) beneficiary = higher efficiency
function costEfficiencyScore(proposal, allProposals) {
  const served = effectiveReach(proposal) || 1;
  const costPerHead = proposal.costLakhs / served;
  const allCostPerHead = allProposals.map((p) => {
    const s = effectiveReach(p) || 1;
    return p.costLakhs / s;
  });
  const min = Math.min(...allCostPerHead);
  const max = Math.max(...allCostPerHead);
  // invert: cheaper per head -> closer to 1
  const norm = normalize(costPerHead, min, max);
  return Number((1 - norm).toFixed(3));
}

// Demand Volume normalized against the max demand across all proposals
function demandScore(proposal, allProposals) {
  const max = Math.max(...allProposals.map((p) => p.demandVolume), 1);
  return Number(normalize(proposal.demandVolume, 0, max).toFixed(3));
}

const DEFAULT_WEIGHTS = {
  w1: 0.35, // citizen demand
  w2: 0.3,  // infra gap
  w3: 0.2,  // demographic reach
  w4: 0.15, // cost efficiency
};

function rankProposals(proposals, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const sumW = w.w1 + w.w2 + w.w3 + w.w4;
  // auto-normalize weights so they always sum to 1, however the client sends them
  const norm = {
    w1: w.w1 / sumW,
    w2: w.w2 / sumW,
    w3: w.w3 / sumW,
    w4: w.w4 / sumW,
  };

  const scored = proposals.map((p) => {
    const demand = demandScore(p, proposals);
    const infra = infraGapScore(p, proposals);
    const reach = demographicReachScore(p, proposals);
    const cost = costEfficiencyScore(p, proposals);

    const priorityScore = Number(
      (
        norm.w1 * demand +
        norm.w2 * infra +
        norm.w3 * reach +
        norm.w4 * cost
      ).toFixed(4)
    );

    return {
      ...p,
      scoreBreakdown: {
        demandScore: demand,
        infraGapScore: infra,
        demographicReachScore: reach,
        costEfficiencyScore: cost,
        weightsUsed: norm,
      },
      priorityScore,
    };
  });

  scored.sort((a, b) => b.priorityScore - a.priorityScore);
  scored.forEach((p, i) => (p.rank = i + 1));
  return scored;
}

module.exports = {
  rankProposals,
  infraGapScore,
  DEFAULT_WEIGHTS,
};
