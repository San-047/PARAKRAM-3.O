// STEP 1: Copy this file and rename the copy to "config.local.js" (same folder)
// STEP 2: Get a free API key from https://aistudio.google.com/apikey
// STEP 3: Paste your key below, replacing PASTE_YOUR_KEY_HERE
// STEP 4: Restart the backend (npm start)
//
// config.local.js is for your personal key only - never commit it or share it.

module.exports = {
  GEMINI_API_KEY: "PASTE_YOUR_KEY_HERE",

  // OPTIONAL: once you deploy the frontend somewhere real (e.g. Netlify),
  // list its URL(s) here so ONLY your frontend can call this backend -
  // otherwise the backend defaults to allowing any localhost/127.0.0.1
  // origin (fine for local development).
  // Example:
  // ALLOWED_ORIGINS: ["https://your-site.netlify.app"],
};
