# ChemoSense — Full Testing Summary Report
**Project:** ChemoSense — Selective Chemosensors for Rapid Detection of Pathogenic Bacteria and Infection Biomarkers
**Date:** July 2026

---

## Overview

Four independent test suites were built and run against the live production deployment (frontend on Render, backend on Render, MySQL on Railway):

| Suite | Tool | Test Cases | Result |
|---|---|---|---|
| Web E2E | Selenium (headless Chrome) | 205 | 191 pass / 11 fail / 3 skip |
| Android E2E | Appium (real device, WebView) | 203 | 203 pass / 0 fail |
| Security (DAST) | Custom Node.js + curl-based runner | 210 | 161 pass / 49 findings |
| Load | k6 | 200 virtual users, 1 min | 0% request failures |

Plus: a GitHub Actions CI/CD pipeline that runs the Appium suite on every push and publishes results to GitHub Pages.

---

## 1. Selenium (Web) — 205 tests, 191 pass

Covers: login/auth flows, dashboard, scan (symptom + biomarker modes), cases, patients, alerts, sensors, simulator, pathogen library (all 8 real pathogens), compare tool, analytics, history, outbreaks, settings, forgot-password, unauthenticated-access redirects, and backend API health checks.

**Known remaining failures (11, low severity, documented not fixed):**
- Pathogen detail card click-through selector mismatch (8 cases) — cosmetic selector issue, not a functional bug
- Register-flow edge case in one test path (2 cases) — test timing issue, manual registration confirmed working via Appium and curl
- Sensor-add-form modal overlay blocking a click once (1 case) — intermittent UI timing

## 2. Appium (Android) — 203 tests, 203 pass, 0 fail

Runs against a real connected Android device, through the Capacitor WebView, hitting the live Render-hosted app. Covers the same functional surface as Selenium (all 8 pathogens, all 13 routes, unauthenticated-access redirects, forgot-password, negative/nonexistent-id handling, repeat-visit stability, multiple sign-out/sign-in round trips).

## 3. DAST (Security) — 210 tests, 49 findings

Custom-built DAST runner (not a template — written from scratch against ChemoSense's actual endpoint inventory), covering:
- AuthN bypass (protected endpoints with no token)
- RBAC matrix (each role token × each role-restricted endpoint)
- IDOR (id enumeration, unauthenticated and per-role)
- JWT token tampering (flipped role claim without re-signing)
- Injection probes (16 payloads × 3 endpoints — SQLi, NoSQLi, path traversal, XSS, template injection)
- Rate limiting (per-endpoint + high-volume burst)
- Hardcoded credentials static scan
- Duplicate-registration handling
- Public-endpoint smoke tests (malformed/edge-case input)
- Cross-role data access scope (informational)

### Critical vulnerabilities found and fixed
1. **Broken authentication** — `requireAuth` originally trusted a client-supplied `student_id` with zero password/token verification, allowing full impersonation of any user/role. Replaced with proper JWT-based sessions (`jsonwebtoken`, server-side `JWT_SECRET`, `Authorization: Bearer`, 7-day expiry).
2. **12 endpoints with no authentication at all**, exposing patient PII, clinical case data, scan records, and allowing unauthenticated writes — including `/api/patients`, `/api/patients/:id/timeline`, `/api/cases/:id/report`, `/api/scans/full`, `/api/change-password`, `/api/users`, `/api/dashboard`, `/api/alerts`, `/api/scans` (read+write), `/api/cases` (read), `/api/sensors/:id` (write). All fixed with `requireAuth` middleware, verified live via re-run (all now correctly return 401).
3. **`/api/change-password`** trusted a client-supplied `student_id` to select whose password to change (though it did verify the old password). Fixed to derive identity from the verified JWT instead.
4. **`/api/register`** leaked raw HTTP 500s with internal error messages on duplicate or malformed input. Fixed to return a clean 409 on duplicates.
5. **`/api/email-report`** crashed with an unhandled error (`Cannot read properties of undefined`) when the treatment list or recipient was missing. Fixed with proper input guards.

### Remaining open findings (documented, not fixed)
- No rate limiting on `/api/login`, `/api/forgot-password`, or other sensitive endpoints — recommend `express-rate-limit`.
- `/api/sensors/:id` and `/api/sensors/:id/readings` remain publicly readable without auth (by design decision — sensor readings are treated as non-sensitive telemetry, not patient data). Worth an explicit team decision if this should change.
- Cross-role patient data access: any authenticated technician or doctor can view any patient's timeline (no per-user record scoping). Documented as likely intentional for a shared clinical dashboard, but should be an explicit decision, not an oversight.
- All SQL queries use parameterized `?` placeholders — no actual SQL injection was achievable in any test; "injection_probe" flags above were response-format anomalies, not successful injections.

## 4. k6 Load Test — 200 virtual users, 1 minute

- **0% request failure rate** — the backend held up structurally under load, no crashes or dropped connections.
- **Performance under load:** average response time ~14.5s, p95 ~34s — well outside acceptable range for a real clinical tool at this scale.
- **Root cause:** Render free-tier compute + Railway free-tier MySQL connection limits, not application code. Confirmed via earlier single-user testing (sub-second to low-second response times with no load).
- **Recommendation:** upgrading off free-tier hosting is the direct fix; this is an infrastructure/budget decision, not a code defect.

## 5. CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/android-e2e.yml`) builds the Android app, runs the full 203-case Appium suite against a GitHub-hosted emulator on every push to `main`, and publishes HTML/Excel/summary reports to GitHub Pages. Initial setup required three fixes: JDK version mismatch (bumped to 21), GitHub Pages not enabled as a deployment source, and a driver-already-installed error in the Appium setup step — all resolved.

## Bugs found and fixed during this testing cycle (outside the security findings above)
- MySQL connection pool would throw "Connection lost" on the first request after Render's free-tier cold start; fixed with automatic query retry + a keep-alive ping.
- `dashboard.tsx`, `alerts.tsx` crashed with `TypeError: forEach is not a function` when an API call returned a 401 error object instead of an array (a direct consequence of adding real authentication). Fixed with response-status checks and safe fallbacks.
- Manual (non-demo) login and new account registration never actually saved the JWT token to the session — every non-demo login appeared to silently "log out" immediately, because every subsequent API call had no token. Fixed on both backend (register now issues a token) and frontend (session now stores it for both login paths).

## Still open / lower priority
- `patients.tsx` and `history.tsx` have the same unguarded-response pattern as the dashboard/alerts fix above — not yet patched, same fix would apply.
- Rate limiting not yet implemented anywhere in the backend.
- Real dataset integration (Kaggle symptom-to-disease data) planned to strengthen Mode A's non-AI fallback matcher, not yet started.
