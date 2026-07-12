const bcrypt = require("bcrypt");
const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const db = require("./db");

// ─── AUTH MIDDLEWARE ──────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not logged in" });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not permitted for your role" });
    }
    next();
  };
}

const { matchSymptoms, matchByBiomarker, allBiomarkers, pathogens } = require("./scan-engine");

const app = express();
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

// ── HEALTH CHECK ────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.json({ message: "ChemoSense API", version: "1.0.0" });
});

// ── SCAN ENGINE ─────────────────────────────────────────────
app.post("/api/scan/symptoms", async (req, res) => {
  const { text } = req.body;
  const missing = text === undefined || text === null || text.trim().length === 0;
  if (missing) return res.status(400).json({ error: "text is required" });
  try {
    const { matchSymptomsAI } = require("./ai-match.js");
    const aiResult = await matchSymptomsAI(text);
    if (aiResult.noMatch) {
      return res.json({ results: [], aiPowered: true, note: aiResult.note });
    }
    return res.json({ results: aiResult.results, aiPowered: true });
  } catch (err) {
    console.error("AI match failed, falling back to keyword matcher:", err.message);
    const fallback = matchSymptoms(text);
    return res.json({ results: fallback, aiPowered: false, note: "AI matching temporarily unavailable, used backup matcher." });
  }
});

app.post("/api/scan/biomarker", (req, res) => {
  const { biomarker } = req.body;
  if (!biomarker) return res.status(400).json({ error: "biomarker is required" });
  res.json(matchByBiomarker(biomarker));
});

app.get("/api/scan/biomarkers", (req, res) => {
  res.json(allBiomarkers());
});

app.get("/api/pathogens", (req, res) => {
  res.json(pathogens);
});

// ── USERS ───────────────────────────────────────────────────
app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name, email, role, student_id, created_at FROM users");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SENSORS ─────────────────────────────────────────────────
app.get("/api/sensors", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM sensors");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/sensors", requireAuth, requireRole("technician", "doctor", "admin"), async (req, res) => {
  const { name, type, status, location, description } = req.body;
  try {
    const [r] = await db.query(
      "INSERT INTO sensors (name, type, status, location, description) VALUES (?, ?, ?, ?, ?)",
      [name, type, status || "active", location, description]
    );
    res.json({ id: r.insertId, name, type, status, location, description });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SCANS ───────────────────────────────────────────────────
app.get("/api/scans", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM scans ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/scans", requireAuth, async (req, res) => {
  const { sensor_id, patient_id, result, value, unit, notes, scanned_by, pathogen_name, biomarker_name, risk_level } = req.body;
  try {
    const [r] = await db.query(
      "INSERT INTO scans (sensor_id, patient_id, result, value, unit, notes, scanned_by, pathogen_name, biomarker_name, risk_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [sensor_id, patient_id, result || "positive", value, unit, notes, scanned_by, pathogen_name, biomarker_name, risk_level]
    );
    try {
      const [users] = await db.query("SELECT email, name FROM users WHERE student_id = ?", [scanned_by]);
      if (users.length) {
        await transporter.sendMail({
          from: "rahrenabishek2006@gmail.com",
          to: users[0].email,
          subject: "✅ ChemoSense — Scan Complete",
          html: `<h2>Scan Completed</h2><p>Dear ${users[0].name},</p><p>Your scan has been completed successfully.</p><table border="1" cellpadding="8"><tr><td><b>Patient ID</b></td><td>${patient_id}</td></tr><tr><td><b>Pathogen</b></td><td>${pathogen_name || "N/A"}</td></tr><tr><td><b>Biomarker</b></td><td>${biomarker_name || "N/A"}</td></tr><tr><td><b>Result</b></td><td>${result || "positive"}</td></tr><tr><td><b>Risk Level</b></td><td>${risk_level || "N/A"}</td></tr></table><p>View full report at <a href="https://chemosense-app.onrender.com">ChemoSense</a></p>`
        });
      }
    } catch (mailErr) { console.error("Mail error:", mailErr.message); }
    // Auto-alert for critical scans
    if ((risk_level === "Critical" || risk_level === "High") && r.insertId) {
      await db.query(
        "INSERT INTO alerts (type, title, message, patient_id, scan_id) VALUES (?, ?, ?, ?, ?)",
        [risk_level === "Critical" ? "critical_scan" : "high_scan",
         `${risk_level} Detection: ${pathogen_name || "Unknown"}`,
         `Biomarker ${biomarker_name || "unknown"} detected in patient ${patient_id}. Immediate review required.`,
         patient_id, r.insertId]
      );
    }
    res.json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CASES ───────────────────────────────────────────────────
app.get("/api/cases", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM cases ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/cases", requireAuth, requireRole("technician", "doctor", "admin"), async (req, res) => {
  const { title, patient_name, patient_id, status, notes } = req.body;
  try {
    const [r] = await db.query(
      "INSERT INTO cases (title, patient_name, patient_id, status, notes) VALUES (?, ?, ?, ?, ?)",
      [title, patient_name, patient_id, status || "open", notes]
    );
    res.json({ id: r.insertId, title, patient_name, patient_id, status, notes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/cases/:id", requireAuth, requireRole("doctor", "admin"), async (req, res) => {
  const { title, patient_name, status, notes } = req.body;
  try {
    await db.query(
      "UPDATE cases SET title=?, patient_name=?, status=?, notes=? WHERE id=?",
      [title, patient_name, status, notes, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DASHBOARD ───────────────────────────────────────────────
app.get("/api/dashboard", requireAuth, async (req, res) => {
  try {
    const [[{ total_scans }]] = await db.query("SELECT COUNT(*) as total_scans FROM scans");
    const [[{ total_cases }]] = await db.query("SELECT COUNT(*) as total_cases FROM cases");
    const [[{ active_sensors }]] = await db.query("SELECT COUNT(*) as active_sensors FROM sensors WHERE status = 'active'");
    const [[{ open_cases }]] = await db.query("SELECT COUNT(*) as open_cases FROM cases WHERE status = 'open'");
    const [recent_scans] = await db.query("SELECT * FROM scans ORDER BY created_at DESC LIMIT 5");
    res.json({ total_scans, total_cases, active_sensors, open_cases, recent_scans });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── AUTH ────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { student_id, password } = req.body;
  try {
    const [rows] = await db.query(
      "SELECT * FROM users WHERE student_id = ? OR email = ?",
      [student_id, student_id]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid Student ID or password" });
    if (!await bcrypt.compare(password, rows[0].password)) return res.status(401).json({ error: "Invalid password" });
    const { password: _, ...user } = rows[0];
    const token = jwt.sign(
      { id: user.id, student_id: user.student_id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ ...user, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/register", async (req, res) => {
  const { email, password, name, student_id } = req.body;
  const ALLOWED_ROLES = ["admin", "doctor", "technician", "student"];
  let role = String(req.body.role || "doctor").toLowerCase().trim();
  if (!ALLOWED_ROLES.includes(role)) role = "doctor";
  try {
    const [r] = await db.query(
      "INSERT INTO users (name, email, password, role, student_id) VALUES (?, ?, ?, ?, ?)",
      [name, email, await bcrypt.hash(password, 10), role, student_id]
    );
    const token = jwt.sign(
      { id: r.insertId, student_id, role, name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ id: r.insertId, name, email, role, student_id, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/forgot-password", async (req, res) => {
  const { student_id } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE student_id = ?", [student_id]);
    if (!rows.length) return res.status(404).json({ error: "Student ID not found" });
    const user = rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 3600000);
    await db.query("INSERT INTO reset_tokens (student_id, token, expires_at) VALUES (?, ?, ?)", [student_id, token, expires]);
    const resetLink = `https://chemosense-app.onrender.com/reset-password?token=${token}`;
    // Try email, but always return reset link so it works even if SMTP is blocked
    try {
      await transporter.sendMail({
        from: `"ChemoSense" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: "ChemoSense — Password Reset",
        html: `<p>Hello ${user.name},</p><p>Reset your password: <a href="${resetLink}">Click here</a></p><p>Expires in 1 hour.</p>`,
      });
    } catch (mailErr) {
      console.warn("Email failed (SMTP blocked), returning link directly:", mailErr.message);
    }
    res.json({ success: true, message: "Reset link generated!", resetLink, email: user.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/reset-password", async (req, res) => {
  const { token, new_password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM reset_tokens WHERE token = ? AND expires_at > NOW()", [token]);
    if (!rows.length) return res.status(400).json({ error: "Invalid or expired token" });
    const { student_id } = rows[0];
    await db.query("UPDATE users SET password = ? WHERE student_id = ?", [await bcrypt.hash(new_password, 10), student_id]);
    await db.query("DELETE FROM reset_tokens WHERE token = ?", [token]);
    res.json({ success: true, message: "Password reset successfully!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/email-report", requireAuth, requireRole("doctor", "admin"), async (req, res) => {
  const { to, caseId, doctor, pathogen, riskLevel, biomarker, sensor, treatment, createdAt } = req.body;
  try {
    await resend.emails.send({
      from: "ChemoSense <onboarding@resend.dev>",
      to: to,
      subject: `ChemoSense Report — ${caseId} — ${pathogen}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #0d9488; padding: 20px; color: white;">
            <h1 style="margin:0; font-size: 20px;">ChemoSense Clinical Report</h1>
          </div>
          <div style="padding: 20px; background: #f0fdfa;">
            <p><strong>Case ID:</strong> ${caseId}</p>
            <p><strong>Date:</strong> ${new Date(createdAt).toLocaleString()}</p>
            <p><strong>Doctor:</strong> ${doctor}</p>
          </div>
          <div style="padding: 20px;">
            <h2 style="color: #0d9488;">Pathogen Detected</h2>
            <p style="font-size: 18px; font-weight: bold; font-style: italic;">${pathogen}</p>
            <p><span style="background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${riskLevel}</span></p>
            <h2 style="color: #0d9488;">Detection</h2>
            <p><strong>Biomarker:</strong> ${biomarker}</p>
            <p><strong>Sensor:</strong> ${sensor}</p>
            <h2 style="color: #0d9488;">Treatment</h2>
            <ul>
              ${treatment.map((t) => `<li>${t}</li>`).join("")}
            </ul>
            <p style="background: #fef3c7; padding: 10px; border-radius: 4px; font-size: 12px;">
              ⚠️ Confirm by culture and sensitivity. Not a substitute for laboratory confirmation.
            </p>
          </div>
          <div style="background: #0d9488; padding: 10px; color: white; font-size: 11px; text-align: center;">
            ChemoSense — Clinical decision support
          </div>
        </div>
      `,
    });
    res.json({ success: true, message: "Report emailed successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ BioScan backend running on http://localhost:${PORT}`));

// ── ALERTS ──────────────────────────────────────────────────
app.get("/api/alerts", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/alerts/:id/read", async (req, res) => {
  try {
    await db.query("UPDATE alerts SET is_read = 1 WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/alerts/read-all", async (req, res) => {
  try {
    await db.query("UPDATE alerts SET is_read = 1");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SCAN → CASE AUTO-LINK ───────────────────────────────────
app.post("/api/scans/full", requireAuth, async (req, res) => {
  const { sensor_id, patient_id, result, value, unit, notes, scanned_by, pathogen_name, biomarker_name, risk_level, is_practice } = req.body;
  try {
    // 1. Save the scan
    const [scanResult] = await db.query(
      "INSERT INTO scans (sensor_id, patient_id, result, value, unit, notes, scanned_by, pathogen_name, biomarker_name, risk_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [sensor_id, patient_id, result || "positive", value, unit, notes, scanned_by, pathogen_name, biomarker_name, risk_level]
    );
    const scan_id = scanResult.insertId;

    // Practice scans (student role): save the scan for history, but skip creating a real case or alert
    if (is_practice) {
      return res.json({ scan_id, case_id: null, practice: true });
    }

    // 2. Auto-create a linked case
    const caseTitle = `${pathogen_name || "Unknown"} — ${patient_id}`;
    const [caseResult] = await db.query(
      "INSERT INTO cases (title, patient_name, patient_id, status, notes) VALUES (?, ?, ?, ?, ?)",
      [caseTitle, patient_id, patient_id, "open", `Auto-created from scan. Biomarker: ${biomarker_name}. Risk: ${risk_level}.`]
    );
    const case_id = caseResult.insertId;

    // 3. Link scan to case
    await db.query("UPDATE scans SET case_id = ? WHERE id = ?", [case_id, scan_id]);

    // 4. Auto-alert for critical/high
    if (risk_level === "Critical" || risk_level === "High") {
      await db.query(
        "INSERT INTO alerts (type, title, message, patient_id, scan_id) VALUES (?, ?, ?, ?, ?)",
        [
          risk_level === "Critical" ? "critical_scan" : "high_scan",
          `${risk_level} Detection: ${pathogen_name || "Unknown"}`,
          `Biomarker ${biomarker_name || "unknown"} detected in patient ${patient_id}. Immediate review required.`,
          patient_id, scan_id
        ]
      );
    }

    res.json({ scan_id, case_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PDF REPORT ───────────────────────────────────────────────
const PDFDocument = require("pdfkit");

app.get("/api/cases/:id/report", requireAuth, async (req, res) => {
  try {
    const [[c]] = await db.query("SELECT * FROM cases WHERE id = ?", [req.params.id]);
    if (!c) return res.status(404).json({ error: "Case not found" });

    const [scans] = await db.query("SELECT * FROM scans WHERE case_id = ? ORDER BY created_at DESC", [req.params.id]);

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="ChemoSense-Case-${c.id}.pdf"`);
    doc.pipe(res);

    // Header
    doc.rect(0, 0, 595, 80).fill("#0d9488");
    doc.fill("white").fontSize(20).font("Helvetica-Bold").text("ChemoSense", 50, 25);
    doc.fontSize(9).font("Helvetica").text("Selective Chemosensors for Pathogen Detection", 50, 50);
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()}`, 350, 50, { align: "right", width: 195 });

    // Case info
    doc.fill("#111").fontSize(16).font("Helvetica-Bold").text(`Case Report #${c.id}`, 50, 100);
    doc.fontSize(10).font("Helvetica").fill("#555").text(c.title, 50, 122);

    doc.moveTo(50, 140).lineTo(545, 140).strokeColor("#e2e8f0").stroke();

    const field = (label, value, x, y) => {
      doc.fontSize(8).fill("#888").font("Helvetica").text(label.toUpperCase(), x, y);
      doc.fontSize(10).fill("#111").font("Helvetica-Bold").text(value || "—", x, y + 12);
    };

    field("Patient ID", c.patient_id, 50, 155);
    field("Status", c.status?.toUpperCase(), 200, 155);
    field("Created", new Date(c.created_at).toLocaleDateString(), 350, 155);

    // Scans
    doc.fontSize(13).font("Helvetica-Bold").fill("#0d9488").text("Scan Results", 50, 210);
    doc.moveTo(50, 228).lineTo(545, 228).strokeColor("#0d9488").lineWidth(1.5).stroke();

    let y = 240;
    if (scans.length === 0) {
      doc.fontSize(10).fill("#888").font("Helvetica").text("No scans linked to this case.", 50, y);
    } else {
      scans.forEach((s, i) => {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.rect(50, y, 495, 90).fill(i % 2 === 0 ? "#f8fafc" : "#fff").stroke("#e2e8f0");
        doc.fontSize(11).font("Helvetica-Bold").fill("#111").text(s.pathogen_name || "Unknown Pathogen", 60, y + 10);
        const riskColor = s.risk_level === "Critical" ? "#ef4444" : s.risk_level === "High" ? "#f59e0b" : "#10b981";
        doc.fontSize(8).fill(riskColor).font("Helvetica-Bold").text(s.risk_level || "—", 450, y + 12);
        doc.fontSize(9).fill("#555").font("Helvetica");
        doc.text(`Biomarker: ${s.biomarker_name || "—"}`, 60, y + 28);
        doc.text(`Scanned by: ${s.scanned_by || "—"}`, 60, y + 42);
        doc.text(`Date: ${new Date(s.created_at).toLocaleString()}`, 60, y + 56);
        doc.text(`Notes: ${s.notes || "—"}`, 60, y + 70);
        y += 100;
      });
    }

    // Notes
    if (c.notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.fontSize(13).font("Helvetica-Bold").fill("#0d9488").text("Clinical Notes", 50, y + 10);
      doc.moveTo(50, y + 28).lineTo(545, y + 28).strokeColor("#0d9488").lineWidth(1.5).stroke();
      doc.fontSize(10).fill("#333").font("Helvetica").text(c.notes, 50, y + 38, { width: 495 });
      y += 60;
    }

    // Footer
    doc.fontSize(8).fill("#888").font("Helvetica")
      .text("⚠ This report is for clinical decision support only. Confirm by culture and sensitivity testing.", 50, 780, { width: 495, align: "center" });

    doc.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SENSOR READINGS & QS ALERTS ─────────────────────────────
app.post("/api/sensors/:id/reading", requireAuth, requireRole("technician", "doctor", "admin"), async (req, res) => {
  const { reading, unit } = req.body;
  try {
    const [[sensor]] = await db.query("SELECT * FROM sensors WHERE id = ?", [req.params.id]);
    if (!sensor) return res.status(404).json({ error: "Sensor not found" });

    const lod_crossed = reading >= sensor.lod_threshold ? 1 : 0;
    const qs_activated = reading >= sensor.qs_threshold ? 1 : 0;
    const signal_strength = Math.min(100, Math.round((reading / sensor.qs_threshold) * 100));

    await db.query(
      "INSERT INTO sensor_readings (sensor_id, reading, unit, signal_strength, qs_activated, lod_crossed) VALUES (?, ?, ?, ?, ?, ?)",
      [req.params.id, reading, unit || sensor.reading_unit || "nM", signal_strength, qs_activated, lod_crossed]
    );

    await db.query("UPDATE sensors SET last_reading = ? WHERE id = ?", [reading, req.params.id]);

    // AI-powered clinical interpretation: match this reading against known pathogen biomarker profiles
    let pathogenMatch = null;
    if (sensor.target_biomarker && (qs_activated || lod_crossed)) {
      const matches = matchByBiomarker(sensor.target_biomarker);
      if (matches.length > 0) {
        const top = matches[0];
        pathogenMatch = {
          pathogenId: top.pathogen.id,
          pathogenName: top.pathogen.name,
          riskLevel: top.pathogen.riskLevel,
          biomarker: sensor.target_biomarker,
          confidence: qs_activated ? "High" : "Moderate",
          reasoning: qs_activated
            ? `${sensor.target_biomarker} at ${reading} ${unit || sensor.reading_unit} exceeds the quorum sensing threshold — consistent with active ${top.pathogen.name} colonization.`
            : `${sensor.target_biomarker} detected above the limit of detection — early sign of possible ${top.pathogen.name} presence.`,
        };
      }
    }

    if (qs_activated) {
      await db.query(
        "INSERT INTO alerts (type, title, message, patient_id, scan_id) VALUES (?, ?, ?, ?, ?)",
        ["qs_threshold", `QS Threshold Crossed: ${sensor.name}`,
         `Sensor ${sensor.name} detected ${reading} ${unit || "nM"} — quorum sensing threshold exceeded. Biofilm formation likely imminent.`,
         null, null]
      );
    } else if (lod_crossed) {
      await db.query(
        "INSERT INTO alerts (type, title, message, patient_id, scan_id) VALUES (?, ?, ?, ?, ?)",
        ["lod_crossed", `LOD Crossed: ${sensor.name}`,
         `Sensor ${sensor.name} detected ${reading} ${unit || "nM"} — limit of detection exceeded. Pathogen presence confirmed.`,
         null, null]
      );
    }

    res.json({ lod_crossed, qs_activated, signal_strength, reading, pathogenMatch });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/sensors/:id/readings", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM sensor_readings WHERE sensor_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/sensors/:id/calibrate", requireAuth, requireRole("technician", "doctor", "admin"), async (req, res) => {
  try {
    const [[sensor]] = await db.query("SELECT calibration_drift FROM sensors WHERE id = ?", [req.params.id]);
    const drift_before = sensor ? Number(sensor.calibration_drift) : 0;

    await db.query(
      "UPDATE sensors SET last_calibrated = NOW(), calibration_drift = 0.00 WHERE id = ?",
      [req.params.id]
    );
    res.json({ success: true, calibrated_at: new Date(), drift_before, drift_after: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATIENT TIMELINE ─────────────────────────────────────────
app.get("/api/patients", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT patient_id, MAX(created_at) as last_scan, COUNT(*) as scan_count, MAX(risk_level) as max_risk FROM scans GROUP BY patient_id ORDER BY last_scan DESC"
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/patients/:patient_id/timeline", requireAuth, async (req, res) => {
  try {
    const [scans] = await db.query(
      "SELECT * FROM scans WHERE patient_id = ? ORDER BY created_at ASC",
      [req.params.patient_id]
    );
    const [cases] = await db.query(
      "SELECT * FROM cases WHERE patient_id = ? ORDER BY created_at ASC",
      [req.params.patient_id]
    );
    res.json({ scans, cases });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── TREATMENT OUTCOMES ───────────────────────────────────────
app.patch("/api/cases/:id/outcome", requireAuth, requireRole("doctor", "admin"), async (req, res) => {
  const { outcome, outcome_notes } = req.body;
  try {
    await db.query(
      "UPDATE cases SET status = 'closed', notes = CONCAT(IFNULL(notes,''), '\n[Outcome: ', ?, '] ', IFNULL(?, '')) WHERE id = ?",
      [outcome, outcome_notes, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CHANGE PASSWORD ──────────────────────────────────────────
app.post("/api/change-password", requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body;
  const student_id = req.user.student_id; // identity comes from the verified JWT, not the request body
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE student_id = ?", [student_id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    if (!await bcrypt.compare(old_password, rows[0].password))
      return res.status(401).json({ error: "Current password is incorrect" });
    await db.query("UPDATE users SET password = ? WHERE student_id = ?",
      [await bcrypt.hash(new_password, 10), student_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SENSOR UPDATE & DELETE ───────────────────────────────────
app.patch("/api/sensors/:id", requireAuth, async (req, res) => {
  const { name, type, status, location, description, lod_threshold, qs_threshold, target_biomarker } = req.body;
  try {
    await db.query(
      "UPDATE sensors SET name=COALESCE(?,name), type=COALESCE(?,type), status=COALESCE(?,status), location=COALESCE(?,location), description=COALESCE(?,description), lod_threshold=COALESCE(?,lod_threshold), qs_threshold=COALESCE(?,qs_threshold), target_biomarker=COALESCE(?,target_biomarker) WHERE id=?",
      [name, type, status, location, description, lod_threshold, qs_threshold, target_biomarker, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/cases/:id", requireAuth, requireRole("doctor", "admin"), async (req, res) => {
  try {
    await db.query("DELETE FROM cases WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/sensors/:id", async (req, res) => {
  try {
    const [[row]] = await db.query("SELECT * FROM sensors WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Sensor not found" });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── OUTBREAK DETECTION ───────────────────────────────────────
app.get("/api/outbreaks", async (req, res) => {
  try {
    // Find pathogens detected 3+ times in last 48 hours
    const [rows] = await db.query(`
      SELECT 
        pathogen_name,
        COUNT(*) as case_count,
        GROUP_CONCAT(DISTINCT patient_id) as patients,
        GROUP_CONCAT(DISTINCT scanned_by) as doctors,
        MAX(created_at) as last_seen,
        MIN(created_at) as first_seen
      FROM scans
      WHERE created_at >= NOW() - INTERVAL 48 HOUR
        AND pathogen_name IS NOT NULL
        AND result = 'positive'
      GROUP BY pathogen_name
      HAVING COUNT(*) >= 3
      ORDER BY case_count DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WARD INFECTION HEATMAP (real scan data) ──────────────────
app.get("/api/ward-heatmap", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        pathogen_name,
        risk_level,
        scanned_by,
        COUNT(*) as count,
        MAX(created_at) as last_seen
      FROM scans
      WHERE result = 'positive'
        AND pathogen_name IS NOT NULL
      GROUP BY pathogen_name, risk_level, scanned_by
      ORDER BY count DESC
    `);
    // Group by doctor (proxy for ward)
    const wards = {};
    rows.forEach((r) => {
      const ward = r.scanned_by || "Unknown";
      if (!wards[ward]) wards[ward] = { ward, pathogens: [], total: 0, critical: 0 };
      wards[ward].pathogens.push({ name: r.pathogen_name, count: r.count, risk: r.risk_level, last_seen: r.last_seen });
      wards[ward].total += r.count;
      if (r.risk_level === "Critical") wards[ward].critical += r.count;
    });
    res.json(Object.values(wards));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LIVE SENSOR STREAM ───────────────────────────────────────
app.get("/api/sensors/:id/live", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const sendReading = async () => {
    try {
      const [[sensor]] = await db.query("SELECT * FROM sensors WHERE id = ?", [req.params.id]);
      if (!sensor) { res.end(); return; }
      // Simulate realistic reading with drift around last_reading
      const base = parseFloat(sensor.last_reading) || 5;
      const noise = (Math.random() - 0.4) * 8;
      const reading = Math.max(0, +(base + noise).toFixed(2));
      const lod_crossed = reading >= sensor.lod_threshold ? 1 : 0;
      const qs_activated = reading >= sensor.qs_threshold ? 1 : 0;
      const signal_strength = Math.min(100, Math.round((reading / sensor.qs_threshold) * 100));

      // Save to DB
      await db.query(
        "INSERT INTO sensor_readings (sensor_id, reading, unit, signal_strength, qs_activated, lod_crossed) VALUES (?, ?, ?, ?, ?, ?)",
        [req.params.id, reading, sensor.reading_unit || "nM", signal_strength, qs_activated, lod_crossed]
      );
      await db.query("UPDATE sensors SET last_reading = ? WHERE id = ?", [reading, req.params.id]);

      res.write(`data: ${JSON.stringify({ reading, lod_crossed, qs_activated, signal_strength, timestamp: new Date().toISOString() })}\n\n`);
    } catch {}
  };

  const interval = setInterval(sendReading, 2000);
  req.on("close", () => clearInterval(interval));
});
