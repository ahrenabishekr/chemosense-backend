require("dotenv").config();
const db = require("./db");

const scans = [
  { patient_id: "CS-2026-PA001", pathogen: "Pseudomonas aeruginosa", biomarker: "Pyocyanin", risk: "Critical", notes: "Burn wound ICU day 3", doctor: "Dr. Maya Krishnan" },
  { patient_id: "CS-2026-PA001", pathogen: "Pseudomonas aeruginosa", biomarker: "Pyocyanin", risk: "Critical", notes: "Follow-up day 5, worsening", doctor: "Dr. Maya Krishnan" },
  { patient_id: "CS-2026-MB002", pathogen: "MRSA", biomarker: "Alpha-toxin", risk: "Critical", notes: "Post-surgical wound infection", doctor: "Dr. Ananya Iyer" },
  { patient_id: "CS-2026-KP003", pathogen: "Klebsiella pneumoniae", biomarker: "2,3-butanediol", risk: "High", notes: "Ventilator-associated pneumonia", doctor: "Dr. Ravi Menon" },
  { patient_id: "CS-2026-KP003", pathogen: "Klebsiella pneumoniae", biomarker: "2,3-butanediol", risk: "Critical", notes: "Day 3 follow-up, sepsis risk", doctor: "Dr. Ravi Menon" },
  { patient_id: "CS-2026-EC004", pathogen: "E. coli (UPEC)", biomarker: "Indole", risk: "Moderate", notes: "UTI catheter-associated", doctor: "Dr. Maya Krishnan" },
  { patient_id: "CS-2026-AB005", pathogen: "Acinetobacter baumannii", biomarker: "OXA-carbapenemase", risk: "Critical", notes: "MDR strain, ICU isolation", doctor: "Dr. Ananya Iyer" },
  { patient_id: "CS-2026-SA006", pathogen: "Staphylococcus aureus", biomarker: "Protein A", risk: "High", notes: "Diabetic foot ulcer", doctor: "Dr. Ravi Menon" },
  { patient_id: "CS-2026-SA006", pathogen: "Staphylococcus aureus", biomarker: "Alpha-toxin", risk: "Critical", notes: "Spreading cellulitis day 2", doctor: "Dr. Maya Krishnan" },
  { patient_id: "CS-2026-SP007", pathogen: "Streptococcus pneumoniae", biomarker: "Pneumolysin", risk: "High", notes: "Community-acquired pneumonia", doctor: "Dr. Ananya Iyer" },
  { patient_id: "CS-2026-PA008", pathogen: "Pseudomonas aeruginosa", biomarker: "2-heptyl-4-quinolone", risk: "High", notes: "CF patient exacerbation", doctor: "Dr. Ravi Menon" },
  { patient_id: "CS-2026-MB009", pathogen: "MRSA", biomarker: "Protein A", risk: "Critical", notes: "Bacteraemia, blood culture positive", doctor: "Dr. Maya Krishnan" },
  { patient_id: "CS-2026-EC010", pathogen: "E. coli (UPEC)", biomarker: "Colibactin", risk: "High", notes: "Pyelonephritis", doctor: "Dr. Ananya Iyer" },
  { patient_id: "CS-2026-KP011", pathogen: "Klebsiella pneumoniae", biomarker: "Capsular polysaccharide", risk: "Critical", notes: "Liver abscess, hypermucoviscous", doctor: "Dr. Ravi Menon" },
  { patient_id: "CS-2026-AB012", pathogen: "Acinetobacter baumannii", biomarker: "OXA-carbapenemase", risk: "Critical", notes: "Wound dehiscence post-trauma", doctor: "Dr. Maya Krishnan" },
  { patient_id: "CS-2026-EF013", pathogen: "Enterococcus faecalis", biomarker: "Cytolysin", risk: "Moderate", notes: "Endocarditis screening", doctor: "Dr. Ananya Iyer" },
  { patient_id: "CS-2026-CA014", pathogen: "Candida albicans", biomarker: "Farnesol", risk: "High", notes: "Invasive candidiasis ICU", doctor: "Dr. Ravi Menon" },
  { patient_id: "CS-2026-PA015", pathogen: "Pseudomonas aeruginosa", biomarker: "Pyocyanin", risk: "Critical", notes: "Burn unit new admission", doctor: "Dr. Maya Krishnan" },
  { patient_id: "CS-2026-SA016", pathogen: "Staphylococcus aureus", biomarker: "TSST-1", risk: "Critical", notes: "Toxic shock syndrome presentation", doctor: "Dr. Ananya Iyer" },
  { patient_id: "CS-2026-SP017", pathogen: "Streptococcus pneumoniae", biomarker: "Pneumolysin", risk: "Moderate", notes: "Paediatric meningitis screening", doctor: "Dr. Ravi Menon" },
];

async function seed() {
  console.log("🌱 Seeding demo data...");
  for (const s of scans) {
    const [r] = await db.query(
      "INSERT INTO scans (patient_id, pathogen_name, biomarker_name, risk_level, notes, scanned_by, result) VALUES (?, ?, ?, ?, ?, ?, 'positive')",
      [s.patient_id, s.pathogen, s.biomarker, s.risk, s.notes, s.doctor]
    );
    const scan_id = r.insertId;

    const [c] = await db.query(
      "INSERT INTO cases (title, patient_name, patient_id, status, notes) VALUES (?, ?, ?, 'open', ?)",
      [`${s.pathogen} — ${s.patient_id}`, s.patient_id, s.patient_id, s.notes]
    );
    await db.query("UPDATE scans SET case_id = ? WHERE id = ?", [c.insertId, scan_id]);

    if (s.risk === "Critical" || s.risk === "High") {
      await db.query(
        "INSERT INTO alerts (type, title, message, patient_id, scan_id) VALUES (?, ?, ?, ?, ?)",
        [
          s.risk === "Critical" ? "critical_scan" : "high_scan",
          `${s.risk} Detection: ${s.pathogen}`,
          `Biomarker ${s.biomarker} detected in patient ${s.patient_id}. Immediate review required.`,
          s.patient_id, scan_id
        ]
      );
    }
    console.log(`✅ ${s.patient_id} — ${s.pathogen}`);
  }
  console.log("🎉 Demo data seeded!");
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
