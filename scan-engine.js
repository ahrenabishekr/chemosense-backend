// Scan matching engine - moved from frontend to backend

const pathogens = [
  {
    id: "pa",
    name: "Pseudomonas aeruginosa",
    shortName: "P. aeruginosa",
    gram: "Gram-negative",
    riskLevel: "Critical",
    infectionSites: ["Burn wounds", "Cystic fibrosis lungs", "VAP", "UTI", "Catheter biofilm"],
    biomarkers: [
      { name: "Pyocyanin", type: "Metabolite", recommendedSensor: "dpv-colorimetric", lod: "0.5 µM", detectionTime: "3–6 min", mechanism: "Redox-active phenazine pigment", clinicalMeaning: "Active P. aeruginosa infection" },
      { name: "3-oxo-C12-HSL", type: "QS Molecule", recommendedSensor: "frect-qd", lod: "1 nM", detectionTime: "6–10 min", mechanism: "Quorum sensing molecule", clinicalMeaning: "Biofilm formation imminent" },
      { name: "Elastase (LasB)", type: "Enzyme", recommendedSensor: "piezo-aptamer", lod: "10 ng/mL", detectionTime: "10–20 min", mechanism: "Protease enzyme", clinicalMeaning: "Tissue destruction marker" },
    ],
    summary: "Most dangerous hospital-acquired pathogen. Forms biofilms rapidly.",
    empiricalTreatment: ["Piperacillin-tazobactam 4.5g IV q6h", "Ceftolozane-tazobactam if MDR"],
  },
  {
    id: "sa",
    name: "Staphylococcus aureus",
    shortName: "S. aureus",
    gram: "Gram-positive",
    riskLevel: "High",
    infectionSites: ["Skin", "Wound infections", "Bacteremia", "Endocarditis"],
    biomarkers: [
      { name: "AIP-I", type: "QS Molecule", recommendedSensor: "piezo-aptamer", lod: "5 nM", detectionTime: "10–20 min", mechanism: "Agr quorum sensing peptide", clinicalMeaning: "Virulence activation" },
      { name: "Staphyloxanthin", type: "Metabolite", recommendedSensor: "dpv-colorimetric", lod: "1 µM", detectionTime: "3–6 min", mechanism: "Golden pigment carotenoid", clinicalMeaning: "Immune evasion marker" },
      { name: "Protein A", type: "Toxin", recommendedSensor: "aunp-lateral", lod: "1 ng/mL", detectionTime: "10–15 min", mechanism: "IgG-binding surface protein", clinicalMeaning: "MRSA virulence marker" },
    ],
    summary: "MRSA strains are major concern in hospital settings.",
    empiricalTreatment: ["Vancomycin 25–30 mg/kg IV", "Daptomycin for bacteremia"],
  },
  {
    id: "ec",
    name: "Escherichia coli",
    shortName: "E. coli",
    gram: "Gram-negative",
    riskLevel: "High",
    infectionSites: ["UTI", "Sepsis", "Wound infections", "Neonatal meningitis"],
    biomarkers: [
      { name: "Indole", type: "Metabolite", recommendedSensor: "dpv-colorimetric", lod: "0.2 µM", detectionTime: "3–6 min", mechanism: "Tryptophan metabolite", clinicalMeaning: "E. coli metabolic activity" },
      { name: "AI-2", type: "QS Molecule", recommendedSensor: "frect-qd", lod: "10 nM", detectionTime: "6–10 min", mechanism: "Interspecies QS signal", clinicalMeaning: "Biofilm coordination" },
      { name: "Colibactin", type: "Toxin", recommendedSensor: "aunp-lateral", lod: "5 ng/mL", detectionTime: "10–15 min", mechanism: "DNA-damaging genotoxin", clinicalMeaning: "Invasive infection marker" },
    ],
    summary: "Leading cause of UTI and gram-negative sepsis.",
    empiricalTreatment: ["Ceftriaxone 1–2g IV daily", "Meropenem if ESBL"],
  },
  {
    id: "kp",
    name: "Klebsiella pneumoniae",
    shortName: "K. pneumoniae",
    gram: "Gram-negative",
    riskLevel: "Critical",
    infectionSites: ["HAP", "UTI", "Liver abscess", "Bacteremia"],
    biomarkers: [
      { name: "Capsular Polysaccharide", type: "Toxin", recommendedSensor: "aunp-lateral", lod: "2 ng/mL", detectionTime: "10–15 min", mechanism: "Hypercapsule antigen", clinicalMeaning: "Hypervirulent strain" },
      { name: "Siderophores", type: "Metabolite", recommendedSensor: "electrochemical-imp", lod: "50 nM", detectionTime: "15–25 min", mechanism: "Iron chelating molecules", clinicalMeaning: "Iron acquisition — active infection" },
    ],
    summary: "Carbapenem-resistant strains are critical global threat.",
    empiricalTreatment: ["Ceftazidime-avibactam if KPC", "Colistin for pan-resistant"],
  },
  {
    id: "ab",
    name: "Acinetobacter baumannii",
    shortName: "A. baumannii",
    gram: "Gram-negative",
    riskLevel: "Critical",
    infectionSites: ["VAP", "Wound infections", "Burn wounds", "Bacteremia"],
    biomarkers: [
      { name: "3-hydroxy-C12-HSL", type: "QS Molecule", recommendedSensor: "frect-qd", lod: "5 nM", detectionTime: "6–10 min", mechanism: "AHL quorum sensing", clinicalMeaning: "Biofilm and resistance activation" },
      { name: "OmpA protein", type: "Toxin", recommendedSensor: "piezo-aptamer", lod: "1 ng/mL", detectionTime: "10–20 min", mechanism: "Outer membrane virulence protein", clinicalMeaning: "Cell invasion marker" },
    ],
    summary: "Extremely drug-resistant. Major ICU pathogen.",
    empiricalTreatment: ["Sulbactam-based therapy", "Colistin + rifampicin combination"],
  },
  {
    id: "ef",
    name: "Enterococcus faecium",
    shortName: "E. faecium",
    gram: "Gram-positive",
    riskLevel: "High",
    infectionSites: ["UTI", "Endocarditis", "Wound infections"],
    biomarkers: [
      { name: "Cytolysin", type: "Toxin", recommendedSensor: "aunp-lateral", lod: "5 ng/mL", detectionTime: "10–15 min", mechanism: "Pore-forming toxin", clinicalMeaning: "Tissue damage marker" },
      { name: "Gelatinase", type: "Enzyme", recommendedSensor: "piezo-aptamer", lod: "10 ng/mL", detectionTime: "10–20 min", mechanism: "Extracellular protease", clinicalMeaning: "Biofilm and invasion marker" },
    ],
    summary: "VRE strains are major concern. Common in immunocompromised.",
    empiricalTreatment: ["Linezolid for VRE", "Daptomycin + ampicillin"],
  },
  {
    id: "kp2",
    name: "Klebsiella variicola",
    shortName: "K. variicola",
    gram: "Gram-negative",
    riskLevel: "Moderate",
    infectionSites: ["Bacteremia", "Respiratory tract", "UTI"],
    biomarkers: [
      { name: "Indole", type: "Metabolite", recommendedSensor: "dpv-colorimetric", lod: "0.2 µM", detectionTime: "3–6 min", mechanism: "Tryptophan metabolite", clinicalMeaning: "Metabolic activity marker" },
    ],
    summary: "Emerging pathogen often misidentified as K. pneumoniae.",
    empiricalTreatment: ["Ceftriaxone", "Piperacillin-tazobactam"],
  },
  {
    id: "se",
    name: "Staphylococcus epidermidis",
    shortName: "S. epidermidis",
    gram: "Gram-positive",
    riskLevel: "Moderate",
    infectionSites: ["Catheter infections", "Prosthetic devices", "Wound infections"],
    biomarkers: [
      { name: "AIP-II", type: "QS Molecule", recommendedSensor: "piezo-aptamer", lod: "5 nM", detectionTime: "10–20 min", mechanism: "Agr group II peptide", clinicalMeaning: "Biofilm formation signal" },
      { name: "PNAG", type: "Metabolite", recommendedSensor: "aunp-lateral", lod: "10 ng/mL", detectionTime: "10–15 min", mechanism: "Polysaccharide biofilm matrix", clinicalMeaning: "Biofilm presence" },
    ],
    summary: "Major cause of device-related infections.",
    empiricalTreatment: ["Vancomycin for MRSE", "Rifampicin combination for biofilm"],
  },
];

const symptomMap = [
  { keywords: ["burn", "wound", "green", "pus", "fruity", "sweet", "grape"], pathogenId: "pa", weight: 3 },
  { keywords: ["pyocyanin", "blue", "pigment", "pseudomonas"], pathogenId: "pa", weight: 4 },
  { keywords: ["cystic fibrosis", "cf", "mucoid", "lung"], pathogenId: "pa", weight: 3 },
  { keywords: ["golden", "yellow", "skin", "abscess", "boil", "furuncle", "nasal"], pathogenId: "sa", weight: 3 },
  { keywords: ["mrsa", "staph", "staphylococcus", "methicillin"], pathogenId: "sa", weight: 4 },
  { keywords: ["endocarditis", "heart valve", "bacteremia", "blood"], pathogenId: "sa", weight: 2 },
  { keywords: ["urine", "uti", "urinary", "dysuria", "frequency", "catheter"], pathogenId: "ec", weight: 3 },
  { keywords: ["e.coli", "ecoli", "coliform", "fecal", "diarrhea", "gastro"], pathogenId: "ec", weight: 4 },
  { keywords: ["neonatal", "meningitis", "newborn", "infant"], pathogenId: "ec", weight: 3 },
  { keywords: ["pneumonia", "sputum", "lobar", "klebsiella", "liver abscess"], pathogenId: "kp", weight: 4 },
  { keywords: ["diabetic", "alcohol", "mucoid sputum", "currant jelly"], pathogenId: "kp", weight: 3 },
  { keywords: ["icu", "ventilator", "trauma", "combat", "endotracheal", "central line"], pathogenId: "ab", weight: 3 },
  { keywords: ["acinetobacter", "baumannii", "pan-resistant", "xdr"], pathogenId: "ab", weight: 4 },
  { keywords: ["vre", "enterococcus", "faecium", "vancomycin resistant"], pathogenId: "ef", weight: 4 },
  { keywords: ["prosthetic", "implant", "device", "catheter", "coagulase negative"], pathogenId: "se", weight: 3 },
];

function matchSymptoms(text) {
  const t = text.toLowerCase();
  const scores = new Map();
  for (const rule of symptomMap) {
    for (const kw of rule.keywords) {
      if (t.includes(kw)) {
        const cur = scores.get(rule.pathogenId) ?? { score: 0, matched: [] };
        cur.score += rule.weight;
        cur.matched.push(kw);
        scores.set(rule.pathogenId, cur);
      }
    }
  }
  return pathogens
    .filter((p) => scores.has(p.id))
    .map((p) => ({
      pathogen: p,
      score: scores.get(p.id).score,
      matched: scores.get(p.id).matched,
      topBiomarker: p.biomarkers[0],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function matchByBiomarker(biomarkerName) {
  const results = [];
  for (const p of pathogens) {
    const b = p.biomarkers.find((bm) => bm.name === biomarkerName);
    if (b) results.push({ pathogen: p, score: 10, matched: [biomarkerName], topBiomarker: b });
  }
  return results;
}

function allBiomarkers() {
  const set = new Set();
  pathogens.forEach((p) => p.biomarkers.forEach((b) => set.add(b.name)));
  return Array.from(set).sort();
}

module.exports = { matchSymptoms, matchByBiomarker, allBiomarkers, pathogens };
