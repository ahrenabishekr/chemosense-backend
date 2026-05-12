const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
require("dotenv").config();
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 587, secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name, email, role, student_id, created_at FROM users");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    res.json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

app.post("/api/login", async (req, res) => {
  const { student_id, password } = req.body;
  try {
    const [rows] = await db.query(
      "SELECT * FROM users WHERE student_id = ? OR email = ?",
      [student_id, student_id]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid Student ID or password" });
    if (rows[0].password !== password) return res.status(401).json({ error: "Invalid password" });
    const { password: _, ...user } = rows[0];
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/register", async (req, res) => {
  const { email, password, name, role, student_id } = req.body;
  try {
    const [r] = await db.query(
      "INSERT INTO users (name, email, password, role, student_id) VALUES (?, ?, ?, ?, ?)",
      [name, email, password, role || "doctor", student_id]
    );
    res.json({ id: r.insertId, name, email, role, student_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// FORGOT PASSWORD - sends reset email
app.post("/api/forgot-password", async (req, res) => {
  const { student_id } = req.body;
  try {
    const [rows] = await db.query(
      "SELECT * FROM users WHERE student_id = ?", [student_id]
    );
    if (!rows.length) return res.status(404).json({ error: "Student ID not found" });

    const user = rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 3600000); // 1 hour

    await db.query(
      "INSERT INTO reset_tokens (student_id, token, expires_at) VALUES (?, ?, ?)",
      [student_id, token, expires]
    );

    const resetLink = `http://localhost:8082/reset-password?token=${token}`;

    await transporter.sendMail({
      from: `"ChemoSense App" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "ChemoSense — Password Reset Request",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #0d9488;">ChemoSense Password Reset</h2>
          <p>Hello <strong>${user.name}</strong>,</p>
          <p>You requested a password reset for your account.</p>
          <p><strong>Student ID:</strong> ${student_id}</p>
          <p>Click the button below to reset your password:</p>
          <a href="${resetLink}" style="display:inline-block; padding: 12px 24px; background: #0d9488; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            Reset Password
          </a>
          <p style="color: #666; font-size: 12px;">This link expires in 1 hour.</p>
          <p style="color: #666; font-size: 12px;">If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true, message: "Reset email sent!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RESET PASSWORD - with token
app.post("/api/reset-password", async (req, res) => {
  const { token, new_password } = req.body;
  try {
    const [rows] = await db.query(
      "SELECT * FROM reset_tokens WHERE token = ? AND expires_at > NOW()",
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: "Invalid or expired token" });

    const { student_id } = rows[0];
    await db.query("UPDATE users SET password = ? WHERE student_id = ?", [new_password, student_id]);
    await db.query("DELETE FROM reset_tokens WHERE token = ?", [token]);

    res.json({ success: true, message: "Password reset successfully!" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ BioScan backend running on http://localhost:${PORT}`));
