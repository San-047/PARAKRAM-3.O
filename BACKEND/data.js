// In-memory data store for JanDrishti AI backend
// Everything here resets when the server restarts (hackathon-demo friendly)

// Wards - IDs are the SAME descriptive strings used across the whole app
// (frontend dashboard, citizen chat GPS matching, ward-fixer dropdown) so
// there is exactly one canonical set of ward identifiers everywhere. This
// replaces the old "W1".."W5" backend-only codes that didn't match anything
// the frontend used, which caused ward data to silently fail to line up.
const WARDS = [
  { id: "Ward 4 (Gohiria)", name: "Gohiria", population: 15800, distanceToHQkm: 5 },
  { id: "Ward 8 (Tamando)", name: "Tamando", population: 28000, distanceToHQkm: 11 },
  { id: "Ward 2 (Master Canteen)", name: "Master Canteen", population: 45000, distanceToHQkm: 2 },
  { id: "Ward 12 (Jatni Link)", name: "Jatni Link", population: 19500, distanceToHQkm: 15 },
  { id: "Ward 7 (Dumduma)", name: "Dumduma", population: 31000, distanceToHQkm: 6 },
  { id: "Ward 5 (Khandagiri)", name: "Khandagiri", population: 26500, distanceToHQkm: 3 },
  { id: "Ward 10 (Patia)", name: "Patia", population: 35000, distanceToHQkm: 7 },
  { id: "Ward 3 (Saheed Nagar)", name: "Saheed Nagar", population: 38000, distanceToHQkm: 4 },
  { id: "Ward 14 (Sundarpada)", name: "Sundarpada", population: 11000, distanceToHQkm: 9 },
  { id: "Janla", name: "Janla", population: 19700, distanceToHQkm: 6 },
];

// Static "public dataset" context used for Multi-Source Data Fusion (module 3)
// Keyed by the same ward ID strings as WARDS above.
const INFRA_BASELINE = {
  "Ward 4 (Gohiria)": { schools: 2, healthCenters: 1, roadConditionIndex: 0.40, waterCoverage: 0.55 },
  "Ward 8 (Tamando)": { schools: 1, healthCenters: 0, roadConditionIndex: 0.30, waterCoverage: 0.45 },
  "Ward 2 (Master Canteen)": { schools: 2, healthCenters: 1, roadConditionIndex: 0.35, waterCoverage: 0.50 },
  "Ward 12 (Jatni Link)": { schools: 3, healthCenters: 1, roadConditionIndex: 0.45, waterCoverage: 0.60 },
  "Ward 7 (Dumduma)": { schools: 1, healthCenters: 0, roadConditionIndex: 0.28, waterCoverage: 0.40 },
  "Ward 5 (Khandagiri)": { schools: 4, healthCenters: 2, roadConditionIndex: 0.60, waterCoverage: 0.70 },
  "Ward 10 (Patia)": { schools: 6, healthCenters: 2, roadConditionIndex: 0.72, waterCoverage: 0.80 },
  "Ward 3 (Saheed Nagar)": { schools: 3, healthCenters: 1, roadConditionIndex: 0.42, waterCoverage: 0.55 },
  "Ward 14 (Sundarpada)": { schools: 3, healthCenters: 1, roadConditionIndex: 0.48, waterCoverage: 0.62 },
  "Janla": { schools: 2, healthCenters: 1, roadConditionIndex: 0.47, waterCoverage: 0.58 },
};

// Development proposals (module 4/5/6 operate on this list).
// IMPORTANT: these 10 projects (id, title, category, ward, cost) are
// IDENTICAL to the frontend's projectsData array. Previously the backend
// had its own different set of titles/categories under the SAME PROJ-101..
// PROJ-110 IDs, so ranking/portfolio numbers shown to users didn't actually
// correspond to the same real-world project the citizen/employee saw.
let PROPOSALS = [
  {
    id: "PROJ-101",
    title: "Primary School Infrastructure & Smart Lab",
    category: "Education",
    wardId: "Ward 4 (Gohiria)",
    costLakhs: 28,
    demandVolume: 342,
    enrolment: 580,
    avgTravelDistanceKm: 4.8,
    description: "Upgrade science + computer lab, add furniture and safe drinking water point.",
  },
  {
    id: "PROJ-102",
    title: "Youth Skill & Vocational Training Hub",
    category: "Employment",
    wardId: "Ward 4 (Gohiria)",
    costLakhs: 45,
    demandVolume: 185,
    enrolment: 1400,
    avgTravelDistanceKm: 8.2,
    description: "New skill-development and vocational training hub for local youth.",
  },
  {
    id: "PROJ-103",
    title: "24/7 Community Healthcare & Diagnostic Lab",
    category: "Healthcare",
    wardId: "Ward 8 (Tamando)",
    costLakhs: 60,
    demandVolume: 410,
    populationServed: 28000,
    avgTravelDistanceKm: 11.2,
    description: "Round-the-clock community healthcare centre with diagnostic lab.",
  },
  {
    id: "PROJ-104",
    title: "Main Market Drainage Overhaul & Flood Wall",
    category: "Sanitation",
    wardId: "Ward 2 (Master Canteen)",
    costLakhs: 35,
    demandVolume: 520,
    populationServed: 45000,
    avgTravelDistanceKm: 1.0,
    description: "Fix chronic monsoon waterlogging with drainage overhaul and flood wall.",
  },
  {
    id: "PROJ-105",
    title: "All-Weather Rural-Urban Connector Highway",
    category: "Roads",
    wardId: "Ward 12 (Jatni Link)",
    costLakhs: 75,
    demandVolume: 290,
    populationServed: 19500,
    avgTravelDistanceKm: 14.5,
    description: "All-weather connector highway linking rural and urban sectors.",
  },
  {
    id: "PROJ-106",
    title: "Solar Water Kiosks & Filtration Grid",
    category: "Water",
    wardId: "Ward 7 (Dumduma)",
    costLakhs: 18,
    demandVolume: 480,
    populationServed: 31000,
    avgTravelDistanceKm: 0.5,
    description: "Solar-powered water kiosks and filtration grid for clean drinking water.",
  },
  {
    id: "PROJ-107",
    title: "Women SHG Empowerment & Micro-Market Complex",
    category: "Employment",
    wardId: "Ward 5 (Khandagiri)",
    costLakhs: 22,
    demandVolume: 210,
    enrolment: 850,
    avgTravelDistanceKm: 2.2,
    description: "Micro-market complex supporting women's self-help group livelihoods.",
  },
  {
    id: "PROJ-108",
    title: "Public E-Library & Student Study Center",
    category: "Education",
    wardId: "Ward 10 (Patia)",
    costLakhs: 30,
    demandVolume: 195,
    enrolment: 2100,
    avgTravelDistanceKm: 3.0,
    description: "Public e-library and quiet study center for students.",
  },
  {
    id: "PROJ-109",
    title: "Smart Streetlighting & Safe Corridor",
    category: "Safety",
    wardId: "Ward 3 (Saheed Nagar)",
    costLakhs: 15,
    demandVolume: 380,
    populationServed: 38000,
    avgTravelDistanceKm: 1.2,
    description: "Smart streetlighting along a high-footfall safety corridor.",
  },
  {
    id: "PROJ-110",
    title: "Canal Desalting & Agri Water Channel",
    category: "Water",
    wardId: "Ward 14 (Sundarpada)",
    costLakhs: 40,
    demandVolume: 265,
    populationServed: 11000,
    avgTravelDistanceKm: 6.0,
    description: "Canal desalting and agricultural water channel restoration.",
  },
];

// Citizen submissions knowledge stream (module 1/2)
let SUBMISSIONS = [];
let submissionCounter = 1000;

function nextSubmissionId() {
  submissionCounter += 1;
  return `SUB-${submissionCounter}`;
}

// ---------------------------------------------------------------------
// AUTHENTICATION DATA
// ---------------------------------------------------------------------
// Citizens self-register with just email + password.
let CITIZENS = []; // { id, name, email, passwordSalt, passwordHash, createdAt }
let citizenCounter = 0;
function nextCitizenId() {
  citizenCounter += 1;
  return `CIT-${citizenCounter}`;
}

// Government employees are pre-provisioned (not self-registered) and must
// supply their Employee ID in addition to email + password. Passwords below
// are hashed once at server startup in server.js - never stored in plaintext.
const EMPLOYEES = [
  {
    employeeId: "EMP-001",
    name: "R. Panda (Planning Officer)",
    email: "planning.officer@gita.gov.in",
    passwordSalt: null,
    passwordHash: null,
    seedPassword: "Parakram@123"
  },
  {
    employeeId: "EMP-002",
    name: "S. Mohanty (Collector Office)",
    email: "collector.office@gita.gov.in",
    passwordSalt: null,
    passwordHash: null,
    seedPassword: "Parakram@123"
  }
];

// token -> { role, id, name, email, employeeId? }
let SESSIONS = {};

// ---------------------------------------------------------------------
// PROJECT ASSIGNMENT TRACKING (module 6 follow-through)
// ---------------------------------------------------------------------
// projectId -> { assignedTo, assignedDate, deadlineDate, status, completedDate }
let PROJECT_ASSIGNMENTS = {};

module.exports = {
  WARDS,
  INFRA_BASELINE,
  PROPOSALS,
  SUBMISSIONS,
  nextSubmissionId,
  CITIZENS,
  nextCitizenId,
  EMPLOYEES,
  SESSIONS,
  PROJECT_ASSIGNMENTS,
  // Exposed so the persistence layer can save/restore these counters too -
  // otherwise restoring old submissions/citizens from disk but resetting
  // the counters to 0 could generate duplicate IDs.
  getSubmissionCounter: () => submissionCounter,
  setSubmissionCounter: (n) => { submissionCounter = n; },
  getCitizenCounter: () => citizenCounter,
  setCitizenCounter: (n) => { citizenCounter = n; },
};
