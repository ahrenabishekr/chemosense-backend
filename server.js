const bcrypt = require("bcrypt");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
require("dotenv").config();
const db = require("./db");
const { matchSymptoms, matchByBiomarker, allBiomarkers, pathogens } = require("./scan-engine");

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ── HEALTH CHECK ────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.json({ message: "ChemoSense API", version: "1.0.0" });
});

// ── SCAN ENGINE ─────────────────────────────────────────────
app.post("/api/scan/symptoms", (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });
  res.json(matchSymptoms(text));
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
app.get("/api/users", async (req, res) => {
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

app.post("/api/sensors", async (req, res) => {
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
app.get("/api/scans", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM scans ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/scans", async (req, res) => {
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
    res.json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CASES ───────────────────────────────────────────────────
app.get("/api/cases", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM cases ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/cases", async (req, res) => {
  const { title, patient_name, patient_id, status, notes } = req.body;
  try {
    const [r] = await db.query(
      "INSERT INTO cases (title, patient_name, patient_id, status, notes) VALUES (?, ?, ?, ?, ?)",
      [title, patient_name, patient_id, status || "open", notes]
    );
    res.json({ id: r.insertId, title, patient_name, patient_id, status, notes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/cases/:id", async (req, res) => {
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
app.get("/api/dashboard", async (req, res) => {
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
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/register", async (req, res) => {
  const { email, password, name, role, student_id } = req.body;
  try {
    const [r] = await db.query(
      "INSERT INTO users (name, email, password, role, student_id) VALUES (?, ?, ?, ?, ?)",
      [name, email, await bcrypt.hash(password, 10), role || "doctor", student_id]
    );
    res.json({ id: r.insertId, name, email, role, student_id });
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
    await transporter.sendMail({
      from: `"ChemoSense" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "ChemoSense — Password Reset",
      html: `<p>Hello ${user.name},</p><p>Reset your password: <a href="${resetLink}">Click here</a></p><p>Expires in 1 hour.</p>`,
    });
    res.json({ success: true, message: "Reset email sent!" });
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

app.post("/api/email-report", async (req, res) => {
  const { to, caseId, doctor, pathogen, riskLevel, biomarker, sensor, treatment, createdAt } = req.body;
  try {
    await transporter.sendMail({
      from: `"ChemoSense" <${process.env.EMAIL_USER}>`,
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
