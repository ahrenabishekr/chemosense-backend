# ChemoSense — Local ML Fallback: Methodology & Data Sources

This document explains the offline machine learning components added to
ChemoSense so the Scan and Sensors pages produce real, dataset-backed
predictions even when the Gemini API is unavailable (no key, rate limited,
or network failure).

## 1. Scan page — Symptom Classifier

**Algorithm:** Bernoulli Naive Bayes
**Dataset:** "Disease Prediction Using Machine Learning" (Kaggle, kaushil268),
mirrored at github.com/anujdutt9/Disease-Prediction-from-Symptoms
**Size:** 4,920 real patient records, 132 binary symptom features, 41 disease
labels
**Training:** `bioscan-backend/scripts/train_symptom_model.py` — downloads
the dataset fresh, trains the model, exports learned parameters
(class priors, per-feature log-probabilities) as JSON.
**Inference:** `bioscan-backend/models/symptom-classifier.js` — pure
JavaScript port of the trained model's math, verified numerically identical
to scikit-learn's `predict_proba` output on the same inputs (no Python
runtime needed in production).

**Fallback chain:** Gemini API → local trained model → keyword matcher.
The local model activates automatically whenever the Gemini call throws
(missing key, network error, rate limit).

**Coverage:** the dataset covers 41 general diseases; only 5 of ChemoSense's
8 pathogens have an honest, clinically-defensible mapping to a disease in
this dataset:

| Disease (dataset label)     | Pathogen             |
|------------------------------|-----------------------|
| Tuberculosis                 | M. tuberculosis       |
| Urinary tract infection      | E. coli               |
| Pneumonia                    | K. pneumoniae         |
| Gastroenteritis              | V. cholerae           |
| Impetigo                     | S. aureus             |

A. baumannii, E. faecium, and K. variicola are hospital-acquired /
opportunistic pathogens with no equivalent label in general public
symptom-checker datasets. We searched for a second dataset to extend
coverage (ICU sepsis-risk datasets: MIMIC-III/IV, PhysioNet 2019
Challenge) but these predict sepsis risk from vital signs, not organism
identity, and MIMIC requires restricted-access credentialing — not a
genuine fit. No mapping is forced for these 3 pathogens; the model
honestly reports "no match" rather than guessing.

## 2. Sensors page — Biomarker Confidence Model

**Algorithm:** Gaussian likelihood in log-concentration space, softmax-
normalized across all pathogens sharing a given biomarker.
**Dataset:** ChemoSense's own curated biomarker table (`scan-engine.js`) —
literature-researched limit-of-detection (LOD) values per pathogen per
biomarker. This is our own domain data, not an external published dataset.
**Why not an external dataset:** no public dataset exists for synthetic
quorum-sensing / electrochemical biomarker concentrations, since these are
this project's own proposed sensing chemistry, not a measured clinical
panel in the literature.

**How it works:** a sensor reading (e.g. 15 nM of Pyocyanin) is scored
against every pathogen whose profile includes that biomarker, using each
pathogen's known LOD as the model's expected concentration. When a
biomarker is unique to one pathogen, confidence is 100%. When a biomarker
is shared (e.g. "Indole" appears in both E. coli and K. variicola at the
same LOD), the model honestly reports near-50/50 confidence across both
candidates instead of arbitrarily picking one — this ambiguity is
scientifically real, not a bug.

**Replaces:** a previous fixed "High"/"Moderate" label that didn't reflect
actual concentration data.

## 3. Reproducing / verifying this work

```bash
cd bioscan-backend
python3 scripts/train_symptom_model.py    # retrains from the real dataset, from scratch
node -e "const {matchSymptomsLocalML} = require('./ai-match.js'); console.log(matchSymptomsLocalML('burning micturition, bladder discomfort'));"
```

Both are fully offline once the dataset is downloaded — no API key required.
