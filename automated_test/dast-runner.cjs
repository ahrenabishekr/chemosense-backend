const fs = require("fs");
const path = require("path");

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "input.json"), "utf8"));
const BASE_URL = config.baseUrl;
const TOKENS = { technician: config.technician, doctor: config.doctor };

const results = [];
function recordResult(rec) {
  results.push({ ...rec, timestamp: new Date().toISOString() });
  const mark = rec.finding ? (rec.severity === "Critical" || rec.severity === "High" ? "✗" : "⚠") : "✓";
  console.log(`${mark} [${rec.test_category}] ${rec.method} ${rec.endpoint} (role: ${rec.role || "none"}) — ${rec.status} (expected ${rec.expected_status}) ${rec.note || ""}`);
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function req(method, endpoint, { token = null, body = null, headers = {} } = {}) {
  const start = Date.now();
  const h = { "Content-Type": "application/json", ...headers };
  if (token) h["Authorization"] = `Bearer ${token}`;
  let res, text;
  try {
    res = await fetch(BASE_URL + endpoint, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    text = await res.text();
  } catch (e) {
    return { status: 0, time: Date.now() - start, body: e.message, error: true };
  }
  return { status: res.status, time: Date.now() - start, body: text };
}

// ── Endpoint inventory, derived from a manual code review of server.js ──
// requiresAuth / roles reflect what the code ACTUALLY enforces (via requireAuth/requireRole).
// expectedAuth reflects what the endpoint SHOULD require given the data it touches —
// this is where the real findings come from: actual vs expected mismatches.
const ENDPOINTS = [
  { method: "GET", path: "/health", requiresAuth: false, expectedAuth: false },
  { method: "GET", path: "/api/pathogens", requiresAuth: false, expectedAuth: false },
  { method: "GET", path: "/api/scan/biomarkers", requiresAuth: false, expectedAuth: false },
  { method: "POST", path: "/api/scan/symptoms", requiresAuth: false, expectedAuth: false, body: { text: "test" } },
  { method: "GET", path: "/api/users", requiresAuth: false, expectedAuth: true, sensitivity: "exposes full user list incl. emails/roles" },
  { method: "GET", path: "/api/scans", requiresAuth: false, expectedAuth: true, sensitivity: "clinical scan records" },
  { method: "POST", path: "/api/scans", requiresAuth: false, expectedAuth: true, sensitivity: "unauthenticated write — fabricate scan records", body: { sensor_id: 1, patient_id: "x", result: "positive" } },
  { method: "GET", path: "/api/cases", requiresAuth: false, expectedAuth: true, sensitivity: "clinical case data" },
  { method: "POST", path: "/api/cases", requiresAuth: true, roles: ["technician", "doctor", "admin"], expectedAuth: true, body: { title: "dast-test", patient_id: "x" } },
  { method: "PUT", path: "/api/cases/1", requiresAuth: true, roles: ["doctor", "admin"], expectedAuth: true, body: { notes: "dast-test" } },
  { method: "GET", path: "/api/dashboard", requiresAuth: false, expectedAuth: true, sensitivity: "aggregated clinical stats" },
  { method: "GET", path: "/api/alerts", requiresAuth: false, expectedAuth: true, sensitivity: "clinical alerts" },
  { method: "POST", path: "/api/scans/full", requiresAuth: false, expectedAuth: true, sensitivity: "CRITICAL: unauthenticated write, creates cases+alerts", body: { sensor_id: 1, patient_id: "x", pathogen_name: "test" } },
  { method: "GET", path: "/api/cases/1/report", requiresAuth: false, expectedAuth: true, sensitivity: "CRITICAL: PDF patient report, IDOR-able by id" },
  { method: "GET", path: "/api/patients", requiresAuth: false, expectedAuth: true, sensitivity: "CRITICAL: patient PII list" },
  { method: "GET", path: "/api/patients/1/timeline", requiresAuth: false, expectedAuth: true, sensitivity: "CRITICAL: patient PII, IDOR-able by id" },
  { method: "POST", path: "/api/change-password", requiresAuth: false, expectedAuth: true, sensitivity: "CRITICAL: account takeover — change any account's password with no auth", body: { student_id: "demo", new_password: "dast-should-not-work-123" } },
  { method: "PATCH", path: "/api/sensors/1", requiresAuth: false, expectedAuth: true, sensitivity: "unauthenticated write to sensor config" },
  { method: "GET", path: "/api/sensors/1", requiresAuth: false, expectedAuth: false },
  { method: "GET", path: "/api/outbreaks", requiresAuth: false, expectedAuth: false },
  { method: "DELETE", path: "/api/cases/1", requiresAuth: true, roles: ["doctor", "admin"] },
];

// ── STEP 0: endpoints that need auth but enforce none (code-review based) ──
async function testMissingAuthByDesign() {
  console.log("\n=== Category 0: Missing-auth-by-design (code review) ===");
  for (const ep of ENDPOINTS) {
    if (ep.expectedAuth && !ep.requiresAuth) {
      recordResult({
        endpoint: ep.path, method: ep.method, role: "none",
        status: "n/a (code review)", expected_status: "requireAuth present",
        finding: true, severity: "Critical",
        response_time_ms: null, test_category: "missing_auth_by_design",
        note: ep.sensitivity || "endpoint touches sensitive/mutating data with no auth middleware",
      });
    }
  }
}

// ── 1. AuthN bypass: protected endpoints, no token ──
async function testAuthNBypass() {
  console.log("\n=== Category 1: AuthN bypass ===");
  for (const ep of ENDPOINTS.filter((e) => e.requiresAuth)) {
    const r = await req(ep.method, ep.path, { body: ep.body });
    const finding = r.status >= 200 && r.status < 300;
    recordResult({
      endpoint: ep.path, method: ep.method, role: "none",
      status: r.status, expected_status: "401",
      finding, severity: finding ? "Critical" : null,
      response_time_ms: r.time, test_category: "authn_bypass",
      note: finding ? "endpoint accepted request with NO token" : "correctly rejected",
    });
    await sleep(150);
  }
}

// ── 2 & 4. AuthZ/privesc + RBAC matrix: each role token x each role-restricted endpoint ──
async function testRBACMatrix() {
  console.log("\n=== Category 2/4: AuthZ / RBAC matrix ===");
  for (const ep of ENDPOINTS.filter((e) => e.requiresAuth && e.roles)) {
    for (const [role, token] of Object.entries(TOKENS)) {
      const allowed = ep.roles.includes(role);
      const r = await req(ep.method, ep.path, { token, body: ep.body });
      const success = r.status >= 200 && r.status < 300;
      const finding = allowed ? !success && r.status !== 404 : success;
      recordResult({
        endpoint: ep.path, method: ep.method, role,
        status: r.status, expected_status: allowed ? "2xx" : "403",
        finding, severity: finding ? (allowed ? "Medium" : "High") : null,
        response_time_ms: r.time, test_category: "rbac_matrix",
        note: finding
          ? (allowed ? "expected role was denied — possible over-restriction" : "lower-privilege role was NOT denied — privilege escalation")
          : "matches expected access rule",
      });
      await sleep(150);
    }
  }
}

// ── 3. IDOR: vary :id params ──
async function testIDOR() {
  console.log("\n=== Category 3: IDOR ===");
  const idorTargets = ["/api/cases/1/report", "/api/patients/1/timeline", "/api/sensors/1"];
  for (const base of idorTargets) {
    for (const id of [1, 2, 9999]) {
      const ep = base.replace(/\/1(\/|$)/, `/${id}$1`);
      const r = await req("GET", ep);
      const accessible = r.status >= 200 && r.status < 300;
      recordResult({
        endpoint: ep, method: "GET", role: "none",
        status: r.status, expected_status: "401 (no auth at all) or scoped access",
        finding: accessible, severity: accessible ? "High" : null,
        response_time_ms: r.time, test_category: "idor",
        note: accessible ? "record accessible by guessing/incrementing id, with no auth" : "not accessible",
      });
      await sleep(150);
    }
  }
}

// ── 5. Token tampering: flip role claim without re-signing ──
async function testTokenTampering() {
  console.log("\n=== Category 5: Token tampering ===");
  const [header, payload] = TOKENS.technician.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  const tampered = { ...decoded, role: "admin" };
  const tamperedPayload = Buffer.from(JSON.stringify(tampered)).toString("base64url");
  // keep original signature — it will no longer match the tampered payload
  const originalSig = TOKENS.technician.split(".")[2];
  const tamperedToken = `${header}.${tamperedPayload}.${originalSig}`;

  const target = ENDPOINTS.find((e) => e.path === "/api/cases/1" && e.method === "DELETE");
  const r = await req("DELETE", target.path, { token: tamperedToken });
  const finding = r.status >= 200 && r.status < 300;
  recordResult({
    endpoint: target.path, method: "DELETE", role: "technician->admin (tampered)",
    status: r.status, expected_status: "401 (invalid signature)",
    finding, severity: finding ? "Critical" : null,
    response_time_ms: r.time, test_category: "token_tampering",
    note: finding ? "server accepted a token with a tampered, unsigned claim!" : "correctly rejected tampered token",
  });
}

// ── 6. Injection probes (detection only) ──
async function testInjectionProbes() {
  console.log("\n=== Category 6: Injection probes ===");
  const payloads = ["' OR '1'='1", "1; DROP TABLE users;--", "{\"$ne\":null}", "' UNION SELECT NULL--"];
  for (const p of payloads) {
    const r = await req("POST", "/api/login", { body: { student_id: p, password: p } });
    const anomalous = r.status >= 500 || /sql|syntax|mysql|stack/i.test(r.body);
    recordResult({
      endpoint: "/api/login", method: "POST", role: "none",
      status: r.status, expected_status: "401 (clean rejection, no error leakage)",
      finding: anomalous, severity: anomalous ? "High" : null,
      response_time_ms: r.time, test_category: "injection_probe",
      note: anomalous ? `anomalous response to payload ${JSON.stringify(p)} — investigate` : "clean rejection",
    });
    await sleep(200);
  }
}

// ── 7. Rate limiting ──
async function testRateLimiting() {
  console.log("\n=== Category 7: Rate limiting ===");
  const statuses = [];
  for (let i = 0; i < 30; i++) {
    const r = await req("POST", "/api/login", { body: { student_id: "demo", password: "wrong" } });
    statuses.push(r.status);
  }
  const got429 = statuses.includes(429);
  recordResult({
    endpoint: "/api/login", method: "POST", role: "none",
    status: statuses.join(","), expected_status: "429 after N attempts",
    finding: !got429, severity: !got429 ? "Medium" : null,
    response_time_ms: null, test_category: "rate_limiting",
    note: got429 ? "rate limit observed" : "no rate limit after 30 rapid attempts — brute-force risk",
  });
}

// ── 8. Hardcoded creds scan ──
async function testHardcodedCreds() {
  console.log("\n=== Category 8: Hardcoded credentials scan ===");
  const srcDir = path.join(__dirname, "..");
  const patterns = [
    /AIzaSy[0-9A-Za-z_-]{33}/,
    /sk-[a-zA-Z0-9]{32,}/,
    /password\s*[:=]\s*["'][^"']{4,}["']/i,
    /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  ];
  const skip = new Set(["node_modules", ".git", "automated_test"]);
  const findings = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|cjs|ts|tsx|env)$/.test(entry.name) && !entry.name.startsWith(".env.example")) {
        const content = fs.readFileSync(full, "utf8");
        for (const pat of patterns) {
          if (pat.test(content)) findings.push({ file: full.replace(srcDir, ""), pattern: pat.toString() });
        }
      }
    }
  }
  try { walk(srcDir); } catch (e) { /* best effort */ }
  recordResult({
    endpoint: "n/a (static scan)", method: "n/a", role: "none",
    status: findings.length, expected_status: 0,
    finding: findings.length > 0, severity: findings.length > 0 ? "Critical" : null,
    response_time_ms: null, test_category: "hardcoded_creds",
    note: findings.length > 0 ? `possible secrets in: ${findings.map((f) => f.file).join(", ")}` : "none found by pattern scan (not exhaustive — manually verify .env is gitignored)",
  });
}

async function main() {
  await testMissingAuthByDesign();
  await testAuthNBypass();
  await testRBACMatrix();
  await testIDOR();
  await testTokenTampering();
  await testInjectionProbes();
  await testRateLimiting();
  await testHardcodedCreds();

  fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify(results, null, 2));

  const bySeverity = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const findings = results.filter((r) => r.finding);
  findings.forEach((f) => { if (f.severity) bySeverity[f.severity]++; });

  console.log("\n\n=== SUMMARY ===");
  console.log(`Endpoints reviewed: ${ENDPOINTS.length}`);
  console.log(`Tests run: ${results.length}`);
  console.log(`Findings: ${findings.length} (Critical: ${bySeverity.Critical}, High: ${bySeverity.High}, Medium: ${bySeverity.Medium}, Low: ${bySeverity.Low})`);
  console.log("\nTop issues to fix first:");
  findings
    .filter((f) => f.severity === "Critical")
    .forEach((f) => console.log(`  ✗ [${f.test_category}] ${f.method} ${f.endpoint} — ${f.note}`));
  console.log(`\nFull report: ${path.join(__dirname, "report.json")}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
