import numpy as np
import pandas as pd

np.random.seed(42)

N = 5000

species_list = [
    "Asian Elephant",
    "Tiger",
    "Leopard",
    "Wild Boar",
    "Spotted Deer"
]

species = np.random.choice(species_list, N)

yolo_confidence = np.random.uniform(60, 99, N)

recent_detections = np.random.randint(1, 21, N)

historical_conflicts = np.random.randint(0, 7, N)

settlement_proximity = np.random.randint(0, 3, N)

temporal_pattern = np.random.randint(0, 3, N)

environmental_context = np.random.randint(0, 3, N)

spatial_relationship = np.random.randint(0, 3, N)


# Species-specific risk contribution
species_risk = {
    "Asian Elephant": 10,
    "Tiger": 12,
    "Leopard": 9,
    "Wild Boar": 7,
    "Spotted Deer": 3
}

species_component = np.array([
    species_risk[s] for s in species
])


# Feature contributions
confidence_component = (yolo_confidence - 60) / 39 * 5

detection_component = recent_detections / 20 * 20

conflict_component = historical_conflicts / 6 * 20

settlement_component = settlement_proximity / 2 * 15

temporal_component = temporal_pattern / 2 * 10

environment_component = environmental_context / 2 * 10

spatial_component = spatial_relationship / 2 * 10


# Risk score
risk_score = (
    confidence_component
    + detection_component
    + conflict_component
    + settlement_component
    + temporal_component
    + environment_component
    + spatial_component
    + species_component
)

# Small noise to avoid a perfectly deterministic relationship
risk_score += np.random.normal(0, 2, N)

risk_score = np.clip(risk_score, 0, 100)

risk_score = np.round(risk_score, 2)


df = pd.DataFrame({
    "species": species,
    "yolo_confidence": np.round(yolo_confidence, 2),
    "recent_detections": recent_detections,
    "historical_conflicts": historical_conflicts,
    "settlement_proximity": settlement_proximity,
    "temporal_pattern": temporal_pattern,
    "environmental_context": environmental_context,
    "spatial_relationship": spatial_relationship,
    "risk_score": risk_score
})

df.to_csv("risk_dataset.csv", index=False)

print("Dataset generated successfully!")
print("Rows:", len(df))
print("Columns:", len(df.columns))
print()
print(df.head())