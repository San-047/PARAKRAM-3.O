const { WARDS } = require("../data");

// Turns the raw submission log into geographically + thematically
// clustered "demand hotspots", filtering out low-signal noise.
function buildHotspots(submissions) {
  const clusters = {}; // key: wardId|theme

  for (const sub of submissions) {
    if (sub.flaggedSpam) continue; // anomalous / duplicate-amplified requests excluded
    const key = `${sub.wardId}|${sub.theme}`;
    if (!clusters[key]) {
      clusters[key] = {
        wardId: sub.wardId,
        theme: sub.theme,
        count: 0,
        uniqueCitizens: new Set(),
      };
    }
    clusters[key].count += 1;
    clusters[key].uniqueCitizens.add(sub.citizenId || sub.id);
  }

  const wardNameById = Object.fromEntries(WARDS.map((w) => [w.id, w.name]));

  const hotspots = Object.values(clusters).map((c) => {
    let level = "Low";
    if (c.count > 5) level = "Critical";   // demo-scale: >5 submissions = critical hotspot
    else if (c.count >= 3) level = "Moderate"; // 3-5 submissions = moderate cluster

    return {
      wardId: c.wardId,
      wardName: wardNameById[c.wardId] || c.wardId,
      theme: c.theme,
      requestCount: c.count,
      uniqueCitizens: c.uniqueCitizens.size,
      hotspotLevel: level,
    };
  });

  hotspots.sort((a, b) => b.requestCount - a.requestCount);
  return hotspots;
}

module.exports = { buildHotspots };
