"""
Trains a Bernoulli Naive Bayes symptom -> disease classifier on a real
public dataset (Kaggle "Disease Prediction Using Machine Learning", 4920
patient records, 132 symptoms, 41 diseases), and exports the learned
parameters as JSON for pure-JS inference in the Node backend (no sklearn
runtime dependency in production).

Run once locally: python3 scripts/train_symptom_model.py
Output: models/symptom_nb_model.json
"""
import pandas as pd
import numpy as np
import json
import urllib.request

DATASET_URL = "https://raw.githubusercontent.com/anujdutt9/Disease-Prediction-from-Symptoms/master/dataset/training_data.csv"

print("Downloading real dataset...")
urllib.request.urlretrieve(DATASET_URL, "training_data.csv")

from sklearn.naive_bayes import BernoulliNB

df = pd.read_csv("training_data.csv")
df = df.loc[:, ~df.columns.str.contains("^Unnamed")]
X = df.drop(columns=["prognosis"])
y = df["prognosis"]
symptom_names = list(X.columns)

print(f"Training on {len(df)} records, {len(symptom_names)} symptoms, {y.nunique()} diseases...")
model = BernoulliNB()
model.fit(X, y)

export = {
    "meta": {
        "source": "Disease Prediction Using Machine Learning (Kaggle, kaushil268) via anujdutt9/Disease-Prediction-from-Symptoms",
        "trained_on_samples": len(df),
        "algorithm": "Bernoulli Naive Bayes",
        "num_symptoms": len(symptom_names),
        "num_diseases": len(model.classes_),
    },
    "symptoms": symptom_names,
    "classes": list(model.classes_),
    "class_log_prior": model.class_log_prior_.tolist(),
    "feature_log_prob": model.feature_log_prob_.tolist(),
    "feature_log_prob_neg": np.log1p(-np.exp(model.feature_log_prob_)).tolist(),
}

with open("models/symptom_nb_model.json", "w") as f:
    json.dump(export, f)

print("Model exported to models/symptom_nb_model.json")
print(f"Classes: {list(model.classes_)}")
