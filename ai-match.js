// Real AI-powered symptom matching using Google Gemini (free tier)
const { pathogens } = require("./scan-engine.js");

async function matchSymptomsAI(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const pathogenContext = pathogens.map(p => ({
    id: p.id,
    name: p.name,
    sites: p.infectionSites.slice(0, 3),
    topBiomarkers: p.biomarkers.slice(0, 2).map(b => b.name),
  }));

  const prompt = `You are a clinical microbiology assistant for ChemoSense, a bacterial pathogen detection system. Given a patient's clinical presentation, identify which pathogens from the provided list are plausible matches, with reasoning.

Available pathogens (only choose from this list, using their exact "id"):
${JSON.stringify(pathogenContext, null, 2)}

Respond ONLY with valid JSON, no markdown, no explanation outside JSON:
{
  "matches": [
    { "pathogenId": "pa", "confidence": 0-100, "reasoning": "short clinical reasoning, 1 sentence" }
  ],
  "noMatch": false,
  "note": "optional short note if no pathogens are plausible matches"
}

Rules:
- Only include pathogenId values from the list above.
- If the clinical picture genuinely doesn't suggest any of these pathogens, return "matches": [] and "noMatch": true with a clear "note".
- Sort matches by confidence descending. Max 5 matches.
- Confidence reflects real clinical plausibility, not just keyword presence.

Clinical presentation: ${text}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json" },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

  let parsed;
  try {
    // Strip markdown code fences and extract JSON object
    let cleaned = rawText.trim();
    // Remove code fences
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    // If still not valid, try to extract first { ... } block
    if (!cleaned.startsWith("{")) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
    }
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Failed to parse AI response as JSON: " + e.message);
  }

  const results = (parsed.matches || [])
    .map(m => {
      const p = pathogens.find(x => x.id === m.pathogenId);
      if (!p) return null;
      return {
        pathogen: p,
        score: m.confidence,
        matched: [],
        reasoning: m.reasoning || "",
        topBiomarker: p.biomarkers[0],
      };
    })
    .filter(Boolean);

  return {
    results,
    noMatch: !!parsed.noMatch,
    note: parsed.note || null,
  };
}


// --- Compare two pathogens with AI ---
async function compareWithAI(pathogenAId, pathogenBId) {
  const A = pathogens.find((p) => p.id === pathogenAId);
  const B = pathogens.find((p) => p.id === pathogenBId);
  if (!A || !B) throw new Error("Invalid pathogen id");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { comparison: buildFallbackComparison(A, B), source: "fallback" };
  }

  const prompt = `You are a clinical microbiology assistant for ChemoSense. Compare these two pathogens for a clinician reviewing a side-by-side profile.

Pathogen A: ${JSON.stringify({ name: A.name, gram: A.gram, riskLevel: A.riskLevel, biomarkers: A.biomarkers.map(b => b.name), qsSystem: A.qsSystem.name, sites: A.infectionSites, treatment: A.empiricalTreatment })}

Pathogen B: ${JSON.stringify({ name: B.name, gram: B.gram, riskLevel: B.riskLevel, biomarkers: B.biomarkers.map(b => b.name), qsSystem: B.qsSystem.name, sites: B.infectionSites, treatment: B.empiricalTreatment })}

Respond ONLY with valid JSON, no markdown:
{
  "summary": "2-3 sentence clinical comparison of the two pathogens",
  "keyDifferentiator": "the single most clinically useful distinguishing factor between them",
  "coInfectionRisk": "short note on whether these two commonly co-infect and what that means",
  "treatmentNote": "short note on any treatment overlap or conflict between the two"
}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json" },
        }),
      }
    );

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    if (!cleaned.startsWith("{")) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) cleaned = match[0];
    }
    const parsed = JSON.parse(cleaned);
    return { comparison: parsed, source: "ai" };
  } catch (e) {
    return { comparison: buildFallbackComparison(A, B), source: "fallback", error: e.message };
  }
}

function buildFallbackComparison(A, B) {
  const riskOrder = { Critical: 4, High: 3, Moderate: 2, Low: 1 };
  const higherRisk = riskOrder[A.riskLevel] >= riskOrder[B.riskLevel] ? A.name : B.name;
  const sharedSites = A.infectionSites.filter((s) => B.infectionSites.includes(s));
  return {
    summary: `${A.name} and ${B.name} are both clinically significant pathogens with distinct quorum sensing systems (${A.qsSystem.name} vs ${B.qsSystem.name}). ${higherRisk} carries the higher baseline risk classification of the two.`,
    keyDifferentiator: `${A.name} is primarily detected via ${A.biomarkers[0]?.name}, while ${B.name} is primarily detected via ${B.biomarkers[0]?.name}.`,
    coInfectionRisk: sharedSites.length > 0
      ? `Both pathogens can present at overlapping sites (${sharedSites.slice(0, 2).join(", ")}), so co-infection should be considered when biomarkers for both are present.`
      : "These pathogens typically present at different infection sites, making co-infection less common.",
    treatmentNote: `First-line treatment differs: ${A.empiricalTreatment[0]} for ${A.name.split(" ")[0]} vs ${B.empiricalTreatment[0]} for ${B.name.split(" ")[0]}.`,
  };
}

// --- Ask AI a free-text question about a specific pathogen ---
async function askAboutPathogen(pathogenId, question) {
  const p = pathogens.find((x) => x.id === pathogenId);
  if (!p) throw new Error("Pathogen not found");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      answer: "The AI assistant isn't configured right now — please refer to the biomarker, AMR gene, and treatment data above for this pathogen.",
      source: "fallback",
    };
  }

  const context = {
    name: p.name, gram: p.gram, riskLevel: p.riskLevel,
    qsSystem: p.qsSystem, biomarkers: p.biomarkers, amrGenes: p.amrGenes,
    infectionSites: p.infectionSites, empiricalTreatment: p.empiricalTreatment,
  };

  const prompt = `You are a clinical microbiology assistant for ChemoSense. Using ONLY the data below about ${p.name}, answer the clinician's question in 2-4 plain-text sentences. No markdown, no headers.

Pathogen data: ${JSON.stringify(context)}

Question: ${question}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
        }),
      }
    );

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "No response generated.";
    return { answer, source: "ai" };
  } catch (e) {
    return {
      answer: "The AI assistant couldn't generate an answer right now — please refer to the data above for this pathogen.",
      source: "fallback",
      error: e.message,
    };
  }
}

module.exports = { matchSymptomsAI, compareWithAI, askAboutPathogen };
