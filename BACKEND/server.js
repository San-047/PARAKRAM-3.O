const express = require("express");
const cors = require("cors");

const { WARDS, INFRA_BASELINE, PROPOSALS, SUBMISSIONS, nextSubmissionId, CITIZENS, nextCitizenId, EMPLOYEES, SESSIONS, PROJECT_ASSIGNMENTS, CHAT_SESSIONS } = require("./data");
const dataModule = require("./data"); // whole-module reference for the persistence layer
const { loadPersistedState, schedulePersist } = require("./services/persistence");
const nlp = require("./services/nlp");
const { buildHotspots } = require("./services/hotspots");
const { rankProposals, DEFAULT_WEIGHTS } = require("./services/ranking");
const { estimateImpact } = require("./services/montecarlo");
const { solvePortfolio } = require("./services/knapsack");
const { hashPassword, verifyPassword, generateToken } = require("./services/auth");
const { chatWithGemini, hasApiKey } = require("./services/gemini");

const app = express();

// ---------------------------------------------------------------------
// CORS: restricted, not wide open. By default this allows any localhost/
// 127.0.0.1 origin (normal for local dev with Live Server, etc). When you
// deploy the frontend somewhere real (Netlify, etc), add that URL to
// ALLOWED_ORIGINS in config.local.js so only your own frontend can call
// this API - not literally anyone on the internet.
let allowedOrigins = null;
let localConfig = null;
try {
  localConfig = require("./config.local.js");
  if (Array.isArray(localConfig?.ALLOWED_ORIGINS)) allowedOrigins = localConfig.ALLOWED_ORIGINS;
} catch (e) { /* config.local.js not created - dev defaults below still apply */ }

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // curl/Postman/server-to-server, no browser origin
    if (allowedOrigins) return callback(null, allowedOrigins.includes(origin));
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked request from unrecognized origin: ${origin}. Add it to ALLOWED_ORIGINS in config.local.js if this is expected.`);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "8mb" })); // generous enough for a photo as base64, not unlimited

// ---------------------------------------------------------------------
// RATE LIMITING: simple in-memory limiter, no extra dependency needed.
// Protects against brute-force login attempts and basic abuse. Resets on
// server restart, which is fine for a demo-scale deployment.
// ---------------------------------------------------------------------
function createRateLimiter(maxRequests, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (recent.length > maxRequests) {
      return res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
    }
    next();
  };
}
const generalLimiter = createRateLimiter(180, 60 * 1000); // 180 req/min per IP overall
const authLimiter = createRateLimiter(15, 60 * 1000); // stricter on login/register to slow brute-forcing
app.use(generalLimiter);

const PORT = process.env.PORT || 4000;

// Hash the seeded employee passwords once at boot (never store plaintext).
// The default "Parakram@123" is intentionally shown right on the login
// screen for judges/demo purposes - that's a deliberate demo convenience,
// not a leak. Before any real deployment, override it via config.local.js
// (EMPLOYEE_SEED_PASSWORD) so a real secret isn't sitting in source control.
const employeePassword = localConfig?.EMPLOYEE_SEED_PASSWORD || null;
EMPLOYEES.forEach((emp) => {
  const { salt, hash } = hashPassword(employeePassword || emp.seedPassword);
  emp.passwordSalt = salt;
  emp.passwordHash = hash;
});

// Ranking weights are kept PER SESSION TOKEN now, not one global shared
// value - previously if one employee adjusted the sliders, it silently
// changed what every other employee/browser saw too.
const WEIGHTS_BY_SESSION = {};

function getSessionWeights(token) {
  return WEIGHTS_BY_SESSION[token] || DEFAULT_WEIGHTS;
}

// Rejects garbage/negative/out-of-range weight values instead of silently
// accepting anything the client sends.
function isValidWeight(v) {
  return v === undefined || (typeof v === "number" && isFinite(v) && v >= 0 && v <= 1);
}

// ---------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "JanDrishti AI Backend", ps: "PK01PS002" });
});

// ---------------------------------------------------------------------
// AUTHENTICATION: Citizen self-registration/login + Employee login
// ---------------------------------------------------------------------

// Basic server-side email format check (defense in depth - the frontend
// already validates this, but never trust the client alone).
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post("/api/auth/citizen/register", authLimiter, (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (CITIZENS.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: "An account with this email already exists. Please log in instead." });
  }
  const { salt, hash } = hashPassword(password);
  const citizen = {
    id: nextCitizenId(),
    name,
    email,
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };
  CITIZENS.push(citizen);
  schedulePersist(dataModule);

  const token = generateToken();
  createSession(token, { role: "citizen", id: citizen.id, name: citizen.name, email: citizen.email });
  res.status(201).json({ token, role: "citizen", name: citizen.name, email: citizen.email });
});

app.post("/api/auth/citizen/login", authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  const citizen = CITIZENS.find((c) => c.email.toLowerCase() === (email || "").toLowerCase());
  if (!citizen || !verifyPassword(password, citizen.passwordSalt, citizen.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const token = generateToken();
  createSession(token, { role: "citizen", id: citizen.id, name: citizen.name, email: citizen.email });
  res.json({ token, role: "citizen", name: citizen.name, email: citizen.email });
});

// Password reset - simplified for the hackathon demo (no real email/OTP
// service configured). In production this would require an email or SMS
// verification step before allowing the reset; here we verify the account
// exists by email and let them set a new password directly.
app.post("/api/auth/citizen/reset-password", authLimiter, (req, res) => {
  const { email, newPassword } = req.body || {};
  if (!email || !newPassword) {
    return res.status(400).json({ error: "Email and new password are required." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }
  const citizen = CITIZENS.find((c) => c.email.toLowerCase() === email.toLowerCase());
  if (!citizen) {
    return res.status(404).json({ error: "No account found with that email." });
  }
  const { salt, hash } = hashPassword(newPassword);
  citizen.passwordSalt = salt;
  citizen.passwordHash = hash;
  schedulePersist(dataModule);
  res.json({ ok: true, message: "Password updated. You can now log in with your new password." });
});

app.post("/api/auth/employee/login", authLimiter, (req, res) => {
  const { email, password, employeeId } = req.body || {};
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (!email || !password || !employeeId) {
    return res.status(400).json({ error: "Email, password, and Employee ID are all required for staff login." });
  }
  const employee = EMPLOYEES.find(
    (e) => e.email.toLowerCase() === email.toLowerCase() && e.employeeId.toUpperCase() === employeeId.toUpperCase()
  );
  if (!employee || !verifyPassword(password, employee.passwordSalt, employee.passwordHash)) {
    return res.status(401).json({ error: "Invalid email, password, or Employee ID." });
  }
  const token = generateToken();
  createSession(token, {
    role: "employee",
    id: employee.employeeId,
    name: employee.name,
    email: employee.email,
    employeeId: employee.employeeId,
  });
  res.json({ token, role: "employee", name: employee.name, email: employee.email, employeeId: employee.employeeId });
});

// Sessions expire after this long, so a stolen/leaked token doesn't work
// forever. Login again once expired - same as any real app.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function createSession(token, sessionData) {
  SESSIONS[token] = { ...sessionData, expiresAt: Date.now() + SESSION_TTL_MS };
}

// Looks up a session and transparently rejects/cleans up expired ones.
function getValidSession(token) {
  const session = SESSIONS[token];
  if (!session) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) {
    delete SESSIONS[token];
    return null;
  }
  return session;
}

app.get("/api/auth/me", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const session = getValidSession(token);
  if (!session) return res.status(401).json({ error: "Invalid or expired session." });
  res.json(session);
});

app.post("/api/auth/logout", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  delete SESSIONS[token];
  res.json({ ok: true });
});

// Middleware: require any logged-in user (citizen or employee)
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const session = getValidSession(token);
  if (!session) return res.status(401).json({ error: "Please log in to access this." });
  req.session = session;
  next();
}

// Middleware: require an employee session specifically
function requireEmployee(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const session = getValidSession(token);
  if (!session || session.role !== "employee") {
    return res.status(403).json({ error: "Only government employees can perform this action." });
  }
  req.session = session;
  next();
}

// ---------------------------------------------------------------------
// MODULE 1: Multilingual, Multi-Modal Citizen Submission Interface
// ---------------------------------------------------------------------
app.post("/api/submissions", requireAuth, (req, res) => {
  const { text, language, channel, wardId, hasPhoto, projectId, photoDataUrl } = req.body;
  // citizenId is NEVER trusted from the request body - it's always derived
  // from the authenticated session, so one citizen can't submit reports
  // under another citizen's identity by editing the request.
  const citizenId = req.session.email;
  // Tracks whether this came from a citizen self-reporting vs an employee
  // testing the intake form on someone's behalf - previously both cases
  // just wrote to "citizenId", conflating citizen and staff-originated data.
  const submitterRole = req.session.role;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "text is required (voice/whatsapp/photo captions all normalize to text)" });
  }

  const translation = nlp.translateToEnglish(text, language);
  const intent = nlp.extractIntent(translation.normalizedText, wardId, channel);
  const visionTag = hasPhoto ? nlp.simulateVisionTag() : null;

  // Duplicate/spam heuristic: same citizen + near-identical text (ignoring
  // case, extra spaces, and punctuation). This still won't catch a genuinely
  // paraphrased or translated re-statement of the same complaint - that
  // would need real semantic/embedding-based comparison, which is beyond
  // what this keyword-based demo layer does - but it's meaningfully less
  // brittle than requiring an exact character-for-character match.
  const normalizeForCompare = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  const comparableText = normalizeForCompare(translation.normalizedText);
  const isDuplicate = SUBMISSIONS.some(
    (s) => s.citizenId === citizenId && normalizeForCompare(s.normalizedText) === comparableText
  );

  const submission = {
    id: nextSubmissionId(),
    citizenId,
    submitterRole,
    channel: intent.channel,
    language: translation.sourceLanguage,
    rawText: text,
    normalizedText: translation.normalizedText,
    theme: intent.theme,
    wardId: intent.wardId,
    intentConfidence: intent.confidence,
    visionTag,
    // Actual uploaded photo, stored as a base64 data URL (in-memory demo
    // storage - fine at hackathon scale; a real deployment would upload
    // this to cloud storage and store just the URL instead).
    photoDataUrl: hasPhoto && photoDataUrl ? photoDataUrl : null,
    flaggedSpam: isDuplicate,
    linkedProjectId: projectId || null, // ties the complaint to a specific dev project, if known
    createdAt: new Date().toISOString(),
  };

  SUBMISSIONS.push(submission);

  // This is the key fix: bump the REAL backend demand count for the linked
  // project (not just a local browser variable), so every client - citizen
  // or employee, in any browser/session - sees the updated number when they
  // next fetch /api/proposals or /api/proposals/weights.
  if (!isDuplicate && projectId) {
    const linkedProposal = PROPOSALS.find((p) => p.id === projectId);
    if (linkedProposal) {
      linkedProposal.demandVolume = (linkedProposal.demandVolume || 0) + 1;
    }
  }

  schedulePersist(dataModule);
  res.status(201).json(submission);
});

// Full complaint list with citizen identities is government-facing data
// (per the problem statement itself), not something any anonymous visitor
// should be able to pull - so this now requires an employee login.
app.get("/api/submissions", requireEmployee, (req, res) => {
  const { theme, wardId } = req.query;
  let results = SUBMISSIONS;
  if (theme) results = results.filter((s) => s.theme === theme);
  if (wardId) results = results.filter((s) => s.wardId === wardId);
  res.json({ count: results.length, submissions: results });
});

// A citizen's own complaint history, with live status derived from
// whatever assignment/completion progress the linked project has made.
// ---------------------------------------------------------------------
// AI CHAT: real conversational understanding for the citizen assistant
// (module 1). Falls back gracefully - if no Gemini key is configured,
// this endpoint tells the frontend so it can fall back to its own
// rule-based logic instead of breaking the demo.
// ---------------------------------------------------------------------
// Requires login so a random visitor can't rack up calls against your
// Gemini API quota/bill by hitting this endpoint directly.
app.post("/api/chat", requireAuth, async (req, res) => {
  const { messages, language } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  // Cap conversation size/length to stop one client from sending huge
  // payloads that would burn through the Gemini API quota or hang the server.
  if (messages.length > 40) {
    return res.status(400).json({ error: "Conversation is too long. Please start a new report." });
  }
  for (const m of messages) {
    if (typeof m?.text !== "string" || m.text.length > 4000) {
      return res.status(400).json({ error: "Each message must be text under 4000 characters." });
    }
  }
  if (!hasApiKey()) {
    return res.status(200).json({ available: false, reason: "NO_API_KEY" });
  }

  const result = await chatWithGemini(messages, language);
  if (result.error) {
    // Log the real reason server-side for debugging, but never hand internal
    // API error bodies (which can contain implementation details) to the client.
    console.warn("[Gemini] chat failed:", result.error, result.detail ? String(result.detail).slice(0, 300) : "");
    return res.status(200).json({ available: false, reason: result.error });
  }
  res.json({ available: true, ...result });
});

// ---------------------------------------------------------------------
// CHAT SESSION HISTORY ENDPOINTS (ChatGPT Style)
// ---------------------------------------------------------------------
app.get("/api/chat-sessions", requireAuth, (req, res) => {
  const userSessions = CHAT_SESSIONS.filter((s) => s.userId === req.session.email);
  userSessions.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  res.json({ sessions: userSessions });
});

app.post("/api/chat-sessions", requireAuth, (req, res) => {
  const { id, title, messages, role } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }
  let session = CHAT_SESSIONS.find((s) => s.id === id && s.userId === req.session.email);
  const now = new Date().toISOString();
  if (!session) {
    const firstMsgText = messages.find(m => m.role === "user")?.text || messages[0]?.text || "New Chat";
    const defaultTitle = firstMsgText.length > 32 ? firstMsgText.slice(0, 32) + "…" : firstMsgText;
    session = {
      id: id || `CHAT-${Date.now()}`,
      userId: req.session.email,
      role: role || req.session.role || "citizen",
      title: title || defaultTitle,
      messages: messages,
      createdAt: now,
      updatedAt: now
    };
    CHAT_SESSIONS.push(session);
  } else {
    session.messages = messages;
    if (title) session.title = title;
    session.updatedAt = now;
  }
  schedulePersist(dataModule);
  res.json(session);
});

app.delete("/api/chat-sessions/:id", requireAuth, (req, res) => {
  const idx = CHAT_SESSIONS.findIndex((s) => s.id === req.params.id && s.userId === req.session.email);
  if (idx !== -1) {
    CHAT_SESSIONS.splice(idx, 1);
    schedulePersist(dataModule);
  }
  res.json({ success: true });
});

// Corrects the ward on an EXISTING submission - previously this was done by
// creating a brand new "[Location correction]" submission, which silently
// duplicated the report and could inflate demand/hotspot counts.
app.patch("/api/submissions/:id/ward", requireAuth, (req, res) => {
  const { id } = req.params;
  const { wardId } = req.body || {};
  if (!wardId) {
    return res.status(400).json({ error: "wardId is required." });
  }
  const submission = SUBMISSIONS.find((s) => s.id === id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }
  if (submission.citizenId !== req.session.email && req.session.role !== "employee") {
    return res.status(403).json({ error: "You can only correct your own reports." });
  }
  submission.wardId = wardId;
  schedulePersist(dataModule);
  submission.correctedAt = new Date().toISOString();
  res.json(submission);
});

app.get("/api/submissions/mine", requireAuth, (req, res) => {
  const mySubs = SUBMISSIONS.filter((s) => s.citizenId === req.session.email);
  const withStatus = mySubs.map((s) => {
    const assignment = s.linkedProjectId ? PROJECT_ASSIGNMENTS[s.linkedProjectId] : null;
    let status = "Received";
    let statusDetail = "Logged and awaiting review by the planning team.";
    if (assignment) {
      if (assignment.status === "Completed") {
        status = "Resolved";
        statusDetail = `Work completed on ${new Date(assignment.completedDate).toLocaleDateString()}.`;
      } else if (assignment.status === "In Progress") {
        status = "In Progress";
        statusDetail = `Assigned to ${assignment.assignedTo}, due ${new Date(assignment.deadlineDate).toLocaleDateString()}.`;
      }
    }
    return { ...s, status, statusDetail };
  });
  withStatus.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ count: withStatus.length, submissions: withStatus });
});

// ---------------------------------------------------------------------
// PROJECT ASSIGNMENT & COMPLETION TRACKING (module 6 follow-through)
// ---------------------------------------------------------------------
app.get("/api/projects/assignments", requireEmployee, (req, res) => {
  res.json({ assignments: PROJECT_ASSIGNMENTS });
});

app.post("/api/projects/:id/assign", requireEmployee, (req, res) => {
  const { id } = req.params;
  const { assignedTo, deadlineDate } = req.body || {};

  // #13: the project ID must actually exist
  const proposal = PROPOSALS.find((p) => p.id === id);
  if (!proposal) {
    return res.status(404).json({ error: `No such project: ${id}` });
  }

  if (!assignedTo || !deadlineDate) {
    return res.status(400).json({ error: "assignedTo and deadlineDate are required." });
  }

  // #14: we don't have a real staff/department directory to validate against
  // in this demo, but we can at least reject obvious garbage input.
  const trimmedAssignee = String(assignedTo).trim();
  if (trimmedAssignee.length < 2 || trimmedAssignee.length > 100) {
    return res.status(400).json({ error: "assignedTo must be a real name/team, between 2 and 100 characters." });
  }

  // #15: reject deadlines already in the past
  const deadline = new Date(deadlineDate);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (isNaN(deadline.getTime())) {
    return res.status(400).json({ error: "deadlineDate is not a valid date." });
  }
  if (deadline < todayStart) {
    return res.status(400).json({ error: "Deadline can't be in the past." });
  }

  // Re-assigning an already in-progress/completed project is allowed
  // (e.g. correcting a mistake), but we don't silently wipe completion data.
  const existing = PROJECT_ASSIGNMENTS[id];
  if (existing && existing.status === "Completed") {
    return res.status(409).json({ error: "This project is already marked completed and can't be reassigned." });
  }

  PROJECT_ASSIGNMENTS[id] = {
    assignedTo: trimmedAssignee,
    assignedDate: new Date().toISOString(),
    deadlineDate,
    status: "In Progress",
    completedDate: null,
    assignedBy: req.session.name,
  };
  schedulePersist(dataModule);
  res.json({ projectId: id, ...PROJECT_ASSIGNMENTS[id] });
});

app.post("/api/projects/:id/complete", requireEmployee, (req, res) => {
  const { id } = req.params;
  const assignment = PROJECT_ASSIGNMENTS[id];
  if (!assignment) {
    return res.status(404).json({ error: "This project has not been assigned yet." });
  }
  // #16: don't let a project be "completed" twice (would silently
  // re-calculate and could confuse the benefit-realized figures)
  if (assignment.status === "Completed") {
    return res.status(409).json({ error: "This project is already marked as completed.", completedDate: assignment.completedDate });
  }
  assignment.status = "Completed";
  assignment.completedDate = new Date().toISOString();

  const proposal = PROPOSALS.find((p) => p.id === id);
  let benefit = null;
  if (proposal) {
    const impact = estimateImpact(proposal, 8000);
    benefit = {
      beneficiariesReached: impact.beneficiariesReached,
      netBenefitLakhs: impact.economicImpact.estimatedNetBenefitLakhs,
      benefitCostRatio: impact.economicImpact.meanBenefitCostRatio,
      socialUpliftPct: impact.socialImpact.meanUpliftPct,
    };
  }

  schedulePersist(dataModule);
  res.json({ projectId: id, ...assignment, benefitRealized: benefit });
});

// ---------------------------------------------------------------------
// MODULE 2: Thematic Pattern Recognition and Demand Hotspot Mapping
// ---------------------------------------------------------------------
app.get("/api/hotspots", requireEmployee, (req, res) => {
  const hotspots = buildHotspots(SUBMISSIONS);
  res.json({ count: hotspots.length, hotspots });
});

// ---------------------------------------------------------------------
// MODULE 3: Multi-Source Data Fusion for Contextual Grounding
// ---------------------------------------------------------------------
app.get("/api/context/:wardId", requireEmployee, (req, res) => {
  const { wardId } = req.params;
  const ward = WARDS.find((w) => w.id === wardId);
  if (!ward) return res.status(404).json({ error: "ward not found" });

  const baseline = INFRA_BASELINE[wardId];
  const wardSubmissions = SUBMISSIONS.filter((s) => s.wardId === wardId);
  const wardProposals = PROPOSALS.filter((p) => p.wardId === wardId);

  res.json({
    ward,
    infraBaseline: baseline,
    citizenSubmissionCount: wardSubmissions.length,
    proposalsInWard: wardProposals.map((p) => ({ id: p.id, title: p.title, category: p.category })),
    note: "Fuses citizen-derived demand with documented infrastructure baseline for this ward.",
  });
});

// ---------------------------------------------------------------------
// MODULE 4: Comparative Evaluation and Priority Ranking Engine
// ---------------------------------------------------------------------
app.get("/api/proposals", requireEmployee, (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const weights = getSessionWeights(token);
  const ranked = rankProposals(PROPOSALS, weights);
  res.json({ weightsUsed: weights, proposals: ranked });
});

app.post("/api/proposals/weights", requireEmployee, (req, res) => {
  const { w1, w2, w3, w4 } = req.body || {};
  if (!isValidWeight(w1) || !isValidWeight(w2) || !isValidWeight(w3) || !isValidWeight(w4)) {
    return res.status(400).json({ error: "Weights must be numbers between 0 and 1." });
  }
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const current = getSessionWeights(token);
  const updated = {
    w1: w1 ?? current.w1,
    w2: w2 ?? current.w2,
    w3: w3 ?? current.w3,
    w4: w4 ?? current.w4,
  };
  WEIGHTS_BY_SESSION[token] = updated;
  const ranked = rankProposals(PROPOSALS, updated);
  res.json({ weightsUsed: updated, proposals: ranked });
});

app.get("/api/proposals/compare", requireEmployee, (req, res) => {
  const { a, b } = req.query;
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const ranked = rankProposals(PROPOSALS, getSessionWeights(token));
  const propA = ranked.find((p) => p.id === a);
  const propB = ranked.find((p) => p.id === b);
  if (!propA || !propB) {
    return res.status(404).json({ error: "one or both proposal ids not found" });
  }
  res.json({
    proposalA: propA,
    proposalB: propB,
    winner: propA.priorityScore >= propB.priorityScore ? propA.id : propB.id,
  });
});

// ---------------------------------------------------------------------
// MODULE 5: Predictive Social and Economic Impact Estimation
// ---------------------------------------------------------------------
app.get("/api/proposals/:id/impact", requireEmployee, (req, res) => {
  const proposal = PROPOSALS.find((p) => p.id === req.params.id);
  if (!proposal) return res.status(404).json({ error: "proposal not found" });
  // Cap iterations so a huge/garbage query value can't hang the server -
  // 20,000 is already far more precision than this demo simulation needs.
  let iterations = Number(req.query.iterations) || 10000;
  if (!Number.isFinite(iterations) || iterations < 100) iterations = 10000;
  iterations = Math.min(iterations, 20000);
  const impact = estimateImpact(proposal, iterations);
  res.json(impact);
});

// ---------------------------------------------------------------------
// MODULE 6: Constraint-Aware Portfolio Optimization
// ---------------------------------------------------------------------
app.post("/api/portfolio/optimize", requireEmployee, (req, res) => {
  const {
    budgetCapLakhs = 140,
    maxProjectsPerWard = null,
    requiredSectorFloor = null,
    weights = null,
  } = req.body || {};

  if (typeof budgetCapLakhs !== "number" || !isFinite(budgetCapLakhs) || budgetCapLakhs <= 0) {
    return res.status(400).json({ error: "budgetCapLakhs must be a positive number." });
  }
  if (budgetCapLakhs > 100000) {
    return res.status(400).json({ error: "budgetCapLakhs seems unrealistically large (max 100,000 Lakhs)." });
  }
  if (maxProjectsPerWard !== null && (!Number.isInteger(maxProjectsPerWard) || maxProjectsPerWard < 1)) {
    return res.status(400).json({ error: "maxProjectsPerWard must be a positive whole number, or null for no cap." });
  }
  if (weights) {
    const { w1, w2, w3, w4 } = weights;
    if (!isValidWeight(w1) || !isValidWeight(w2) || !isValidWeight(w3) || !isValidWeight(w4)) {
      return res.status(400).json({ error: "Weights must be numbers between 0 and 1." });
    }
  }

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const ranked = rankProposals(PROPOSALS, weights || getSessionWeights(token));

  // Exclude completed projects from active knapsack candidate pool so new projects take their place
  const activeProposals = ranked.filter((p) => {
    const assign = PROJECT_ASSIGNMENTS[p.id];
    return !(assign && assign.status === "Completed");
  });

  const completedProposals = ranked.filter((p) => {
    const assign = PROJECT_ASSIGNMENTS[p.id];
    return assign && assign.status === "Completed";
  }).map((p) => ({
    ...p,
    assignment: PROJECT_ASSIGNMENTS[p.id]
  }));

  const result = solvePortfolio(activeProposals, {
    budgetCapLakhs,
    maxProjectsPerWard,
    requiredSectorFloor,
  });

  res.json({
    ...result,
    completed: completedProposals,
    totalCompletedCount: completedProposals.length,
    totalAllProjects: PROPOSALS.length,
  });
});

// ---------------------------------------------------------------------
// Dashboard summary (powers the "Executive Brief" header stats)
// ---------------------------------------------------------------------
app.get("/api/summary", (req, res) => {
  const languages = [...new Set(SUBMISSIONS.map((s) => s.language))];
  res.json({
    zone: "Bhubaneswar Central (Khordha Dist, Odisha)",
    submissionCount: SUBMISSIONS.length,
    languagesSeen: languages,
    proposalCount: PROPOSALS.length,
    wards: WARDS.length,
  });
});

// ---------------------------------------------------------------------
// STATIC FILE SERVING: Serve frontend for 1-click unified deployment
// ---------------------------------------------------------------------
const path = require("path");
app.use(express.static(path.join(__dirname, "../FRONTEND")));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "../FRONTEND/index.html"));
});

app.listen(PORT, () => {
  loadPersistedState(dataModule); // restore citizens/submissions/assignments from last run, if any
  console.log(`JanDrishti AI backend running on http://localhost:${PORT}`);
  console.log(`Problem Statement: PK01PS002`);
});
