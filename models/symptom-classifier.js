const fs = require("fs");
const path = require("path");

class SymptomClassifier {
  constructor(modelPath) {
    const m = JSON.parse(fs.readFileSync(modelPath, "utf8"));
    this.symptoms = m.symptoms;
    this.classes = m.classes;
    this.classLogPrior = m.class_log_prior;
    this.featureLogProb = m.feature_log_prob;
    this.featureLogProbNeg = m.feature_log_prob_neg;
    this.meta = m.meta;
  }

  predict(symptomsPresent) {
    const present = new Set(symptomsPresent.map(s => s.toLowerCase().trim().replace(/\s+/g, "_")));
    const x = this.symptoms.map(s => (present.has(s) ? 1 : 0));

    const scores = this.classes.map((cls, ci) => {
      let logProb = this.classLogPrior[ci];
      for (let fi = 0; fi < x.length; fi++) {
        logProb += x[fi] ? this.featureLogProb[ci][fi] : this.featureLogProbNeg[ci][fi];
      }
      return logProb;
    });

    const maxScore = Math.max(...scores);
    const exps = scores.map(s => Math.exp(s - maxScore));
    const sumExp = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / sumExp);

    return this.classes
      .map((cls, i) => ({ disease: cls, confidence: probs[i] }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  // extract which of the 132 known symptom keywords appear in free-text input
  extractSymptoms(text) {
    const lower = text.toLowerCase();
    return this.symptoms.filter(s => {
      const readable = s.replace(/_/g, " ");
      return lower.includes(readable) || lower.includes(s);
    });
  }
}

module.exports = { SymptomClassifier, MODEL_PATH: path.join(__dirname, "symptom_nb_model.json") };
