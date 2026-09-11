// Predictive Social & Economic Impact Estimation
// Runs a lightweight Monte Carlo simulation to produce impact estimates
// with confidence bounds instead of a single opaque number.

function randomNormal(mean, stdDev) {
  // Box-Muller transform
  let u1 = Math.random() || Number.EPSILON; // prevent log(0) = -Infinity → NaN
  let u2 = Math.random() || Number.EPSILON;
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z0;
}

function estimateImpact(proposal, iterations = 10000) {
  const beneficiaries = proposal.populationServed || proposal.enrolment || 1000;

  // Assumptions (would be calibrated against historical project data in production)
  const socialUpliftMean = 0.12; // 12% avg improvement in relevant welfare indicator
  const socialUpliftStd = 0.035;

  const costPerBeneficiary = (proposal.costLakhs * 100000) / beneficiaries; // INR
  const economicReturnMultiplierMean = 1.6; // benefit-cost ratio
  const economicReturnMultiplierStd = 0.4;

  const socialSamples = [];
  const economicSamples = [];

  for (let i = 0; i < iterations; i++) {
    const social = Math.max(0, randomNormal(socialUpliftMean, socialUpliftStd));
    const econMultiplier = Math.max(0.1, randomNormal(economicReturnMultiplierMean, economicReturnMultiplierStd));
    socialSamples.push(social);
    economicSamples.push(econMultiplier);
  }

  socialSamples.sort((a, b) => a - b);
  economicSamples.sort((a, b) => a - b);

  const pct = (arr, p) => arr[Math.floor(arr.length * p)];

  const socialMean = socialSamples.reduce((a, b) => a + b, 0) / iterations;
  const econMean = economicSamples.reduce((a, b) => a + b, 0) / iterations;

  return {
    proposalId: proposal.id,
    iterations,
    beneficiariesReached: beneficiaries,
    costPerBeneficiaryINR: Number(costPerBeneficiary.toFixed(2)),
    socialImpact: {
      meanUpliftPct: Number((socialMean * 100).toFixed(2)),
      confidenceInterval94: [
        Number((pct(socialSamples, 0.03) * 100).toFixed(2)),
        Number((pct(socialSamples, 0.97) * 100).toFixed(2)),
      ],
    },
    economicImpact: {
      meanBenefitCostRatio: Number(econMean.toFixed(2)),
      confidenceInterval94: [
        Number(pct(economicSamples, 0.03).toFixed(2)),
        Number(pct(economicSamples, 0.97).toFixed(2)),
      ],
      estimatedNetBenefitLakhs: Number(
        (proposal.costLakhs * (econMean - 1)).toFixed(2)
      ),
    },
    confidenceFraming:
      "94% confidence interval derived from 10,000-iteration Monte Carlo simulation. Wider intervals indicate higher outcome uncertainty; treat as directional, not exact.",
  };
}

module.exports = { estimateImpact };
