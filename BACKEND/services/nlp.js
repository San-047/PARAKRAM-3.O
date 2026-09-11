// Simulated multilingual NLP + Vision layer.
// In a production build this would call a real translation/STT/vision model.
// Here we use deterministic keyword-based logic so the demo behaves
// consistently and needs no paid API keys.

const THEME_KEYWORDS = {
  Water: ["water", "pipeline", "supply", "tap", "drink", "ପାଣି", "पानी"],
  Roads: ["road", "drain", "drainage", "pothole", "waterlog", "resurfac", "sadak", "ରାସ୍ତା"],
  Education: ["school", "lab", "classroom", "teacher", "student", "vocational", "training", "ବିଦ୍ୟାଳୟ"],
  Healthcare: ["health", "hospital", "clinic", "doctor", "medicine", "phc", "स्वास्थ्य"],
  Sanitation: ["toilet", "sanitation", "sewage", "garbage", "waste"],
  Safety: ["light", "streetlight", "electricity", "power", "unsafe", "dark", "crime"],
  Employment: ["job", "employment", "skill", "livelihood", "shg", "self help", "market", "vocational"],
};

// Ward keyword map - MUST use the exact same ward ID strings as data.js /
// WARDS (and the frontend's WARD_CENTROIDS), so a ward detected from raw
// citizen text actually matches the same ward everywhere else in the app.
const WARD_NAME_TO_ID = {
  jatni: "Ward 12 (Jatni Link)",
  khandagiri: "Ward 5 (Khandagiri)",
  dumduma: "Ward 7 (Dumduma)",
  gohiria: "Ward 4 (Gohiria)",
  janla: "Janla",
  tamando: "Ward 8 (Tamando)",
  patia: "Ward 10 (Patia)",
  "saheed nagar": "Ward 3 (Saheed Nagar)",
  sundarpada: "Ward 14 (Sundarpada)",
  "master canteen": "Ward 2 (Master Canteen)",
};

const VISION_TAGS = [
  { tag: "Pothole & Road Waterlogging", confidence: 0.94, theme: "Roads" },
  { tag: "Cracked School Building", confidence: 0.91, theme: "Education" },
  { tag: "Broken Water Pipe", confidence: 0.89, theme: "Water" },
  { tag: "Overflowing Garbage Point", confidence: 0.87, theme: "Sanitation" },
  { tag: "No Streetlight (Low-Light Image)", confidence: 0.83, theme: "Safety" },
];

function detectTheme(text) {
  const lower = text.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
      return theme;
    }
  }
  return "General";
}

function detectWard(text) {
  const lower = text.toLowerCase();
  for (const [name, id] of Object.entries(WARD_NAME_TO_ID)) {
    if (lower.includes(name)) return id;
  }
  return null;
}

// Fake but stable "translation": in a real system this hits a translation API.
// We just tag the string with detected source language and pass it through,
// since our seed content is already authored in English for the demo.
function translateToEnglish(text, language) {
  return {
    normalizedText: text.trim(),
    sourceLanguage: language || "auto-detected",
    confidence: 0.9 + Math.random() * 0.08,
  };
}

function simulateVisionTag() {
  return VISION_TAGS[Math.floor(Math.random() * VISION_TAGS.length)];
}

// A deterministic, reasoned pseudo-confidence instead of a pure random
// number - still not a real ML model's confidence, but at least reflects
// something real about the input (did keyword matching actually find a
// theme/ward, and how much text was there to go on) rather than noise.
function computeConfidence(text, themeMatched, wardMatched) {
  let score = 0.55;
  if (themeMatched) score += 0.18;
  if (wardMatched) score += 0.17;
  const lengthBonus = Math.min((text || "").trim().length / 200, 1) * 0.08;
  score += lengthBonus;
  return Number(Math.min(score, 0.98).toFixed(3));
}

function extractIntent(text, wardHint, channel) {
  const theme = detectTheme(text);
  const detectedWard = wardHint || detectWard(text);
  // Previously an undetected ward silently defaulted to "Ward 4 (Gohiria)" -
  // that's actively misleading (a Dumduma complaint could get filed under
  // Gohiria with nobody noticing). Now it's honestly marked "Unclassified"
  // so downstream review can catch and correct it.
  const ward = detectedWard || "Unclassified";
  return {
    theme,
    wardId: ward,
    channel: channel || "text",
    confidence: computeConfidence(text, theme !== "General", !!detectedWard),
  };
}

module.exports = {
  translateToEnglish,
  simulateVisionTag,
  extractIntent,
  detectTheme,
  detectWard,
};
