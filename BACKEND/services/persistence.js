// Lightweight persistence: saves the in-memory data to a JSON file on disk
// and restores it on startup. This is NOT a real database - it's a simple,
// zero-setup way to stop losing all citizens/submissions/assignments every
// time the backend restarts, which matters a lot for a multi-day hackathon
// where the laptop gets closed and reopened.
//
// For anything beyond hackathon-demo scale, this should be replaced with a
// real database (SQLite/Postgres/etc) - documented as a known limitation.

const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data-store.json");

function loadPersistedState(data) {
  if (!fs.existsSync(STORE_PATH)) return;
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const saved = JSON.parse(raw);

    if (Array.isArray(saved.CITIZENS)) {
      data.CITIZENS.length = 0;
      data.CITIZENS.push(...saved.CITIZENS);
    }
    if (Array.isArray(saved.SUBMISSIONS)) {
      data.SUBMISSIONS.length = 0;
      data.SUBMISSIONS.push(...saved.SUBMISSIONS);
    }
    if (saved.PROJECT_ASSIGNMENTS) {
      Object.keys(data.PROJECT_ASSIGNMENTS).forEach((k) => delete data.PROJECT_ASSIGNMENTS[k]);
      Object.assign(data.PROJECT_ASSIGNMENTS, saved.PROJECT_ASSIGNMENTS);
    }
    if (Array.isArray(saved.PROPOSALS_DEMAND)) {
      saved.PROPOSALS_DEMAND.forEach(({ id, demandVolume }) => {
        const p = data.PROPOSALS.find((x) => x.id === id);
        if (p && typeof demandVolume === "number") p.demandVolume = demandVolume;
      });
    }
    if (Array.isArray(saved.CHAT_SESSIONS)) {
      data.CHAT_SESSIONS.length = 0;
      data.CHAT_SESSIONS.push(...saved.CHAT_SESSIONS);
    }
    if (typeof saved.submissionCounter === "number") data.setSubmissionCounter(saved.submissionCounter);
    if (typeof saved.citizenCounter === "number") data.setCitizenCounter(saved.citizenCounter);

    // Restore non-expired sessions so users don't get kicked out on server restart.
    // This is the key fix: previously every backend restart wiped all sessions,
    // forcing citizens to re-login which cleared their chat history.
    if (saved.SESSIONS && typeof saved.SESSIONS === "object") {
      const now = Date.now();
      let restoredCount = 0;
      Object.entries(saved.SESSIONS).forEach(([token, session]) => {
        if (session.expiresAt && session.expiresAt > now) {
          data.SESSIONS[token] = session;
          restoredCount++;
        }
      });
      if (restoredCount > 0) {
        console.log(`[Persistence] Restored ${restoredCount} active session(s) from data-store.json`);
      }
    }

    console.log(`[Persistence] Restored ${data.CITIZENS.length} citizen(s), ${data.SUBMISSIONS.length} submission(s), ${data.CHAT_SESSIONS.length} chat session(s) from data-store.json`);
  } catch (e) {
    console.warn("[Persistence] Could not load data-store.json, starting fresh:", e.message);
  }
}

let saveTimer = null;
// Debounced save - if several requests mutate data in quick succession, this
// waits a moment and writes once instead of hitting the disk on every request.
function schedulePersist(data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistNow(data), 800);
}

function persistNow(data) {
  try {
    // Only save sessions that haven't expired yet - no point persisting stale tokens
    const now = Date.now();
    const activeSessions = {};
    Object.entries(data.SESSIONS).forEach(([token, session]) => {
      if (session.expiresAt && session.expiresAt > now) {
        activeSessions[token] = session;
      }
    });

    const snapshot = {
      CITIZENS: data.CITIZENS,
      SUBMISSIONS: data.SUBMISSIONS,
      PROJECT_ASSIGNMENTS: data.PROJECT_ASSIGNMENTS,
      PROPOSALS_DEMAND: data.PROPOSALS.map((p) => ({ id: p.id, demandVolume: p.demandVolume })),
      CHAT_SESSIONS: data.CHAT_SESSIONS,
      SESSIONS: activeSessions,
      submissionCounter: data.getSubmissionCounter(),
      citizenCounter: data.getCitizenCounter(),
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(snapshot, null, 2));
  } catch (e) {
    console.warn("[Persistence] Could not save data-store.json:", e.message);
  }
}

module.exports = { loadPersistedState, schedulePersist, persistNow };
