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

module.exports = { matchSymptomsAI };
