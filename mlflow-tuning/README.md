# MLflow Hyperparameter Tuning (Optuna) — `n_trials = 10`

A faithful, runnable reproduction of the MLflow **Getting Started: Hyperparameter
Tuning** tutorial, configured for **10 Optuna trials**.

> Tutorial: <https://mlflow.org/docs/latest/ml/getting-started/hyperparameter-tuning/>

## What it does

The tutorial tunes a scikit-learn `RandomForestRegressor` on the **California
Housing** dataset using **Optuna**, and tracks every trial with **MLflow** using
a parent run / child run hierarchy:

- A single **parent run** (`study`) groups the whole optimisation session and
  logs `n_trials`, the best parameters and the best error.
- Each Optuna **trial** runs inside a **nested child run** (`trial_N`) that logs
  that trial's hyperparameters, its `error` metric (validation MSE) and the
  fitted model.

The search space (per the tutorial):

| Hyperparameter    | Range                     |
| ----------------- | ------------------------- |
| `rf_max_depth`    | int, 2–32                 |
| `rf_n_estimators` | int, 50–300 (step 10)     |
| `rf_max_features` | float, 0.2–1.0            |

Objective minimised: **mean squared error** on the validation split.

## Files

- `hyperparameter_tuning.py` — the tutorial script (`N_TRIALS = 10`).
- `requirements.txt` — `mlflow`, `optuna`, `scikit-learn`.

## Run it

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python hyperparameter_tuning.py
```

By default MLflow 3.x stores runs in a local `mlflow.db` (SQLite) with artifacts
under `mlruns/`. View them in the UI:

```bash
mlflow server --backend-store-uri sqlite:///mlflow.db --port 5000
# open http://localhost:5000
```

## Result of the 10-trial run

Study backend: `sqlite:///mlflow.db` · 1 parent run + 10 child runs.

| Trial     | rf_max_depth | rf_n_estimators | rf_max_features | error (val MSE) |
| --------- | ------------ | --------------- | --------------- | --------------- |
| trial_0   | 32           | 230             | 0.611           | 0.253705        |
| **trial_1** ⭐ | **22**   | **150**         | **0.477**       | **0.244922**    |
| trial_2   | 29           | 200             | 0.283           | 0.245266        |
| trial_3   | 24           | 150             | 0.673           | 0.259251        |
| trial_4   | 8            | 290             | 0.311           | 0.357632        |
| trial_5   | 14           | 240             | 0.500           | 0.257453        |
| trial_6   | 22           | 180             | 0.888           | 0.268547        |
| trial_7   | 5            | 250             | 0.606           | 0.451593        |
| trial_8   | 27           | 220             | 0.939           | 0.265986        |
| trial_9   | 5            | 260             | 0.932           | 0.464277        |

**Best trial:** `trial_1` — error (validation MSE) **0.244922**
with `max_depth=22`, `n_estimators=150`, `max_features≈0.477`.

> Optuna's sampler is stochastic (the study is created without a fixed seed, as
> in the tutorial), so exact numbers vary from run to run.

## Step 5 — Register the best model (optional)

Once the best trial is identified, register its model into the MLflow Model
Registry (requires a database-backed tracking store, e.g. the default
`sqlite:///mlflow.db`):

```python
import mlflow

mlflow.set_tracking_uri("sqlite:///mlflow.db")
mlflow.register_model(
    model_uri="runs:/<best_child_run_id>/model",  # printed by the script
    name="housing-price-predictor",
)
```

## Notes on MLflow 3.x compatibility

- **Model serialization:** MLflow 3.x defaults `mlflow.sklearn.log_model` to the
  `skops` format, which refuses to serialize tree-based models
  (`sklearn.tree._tree.Tree` is flagged as an untrusted type). The script pins
  `serialization_format="cloudpickle"` so the RandomForest logs and reloads
  cleanly. This is the only deviation from the tutorial's code.
- **Tracking backend:** MLflow 3.x uses a SQLite backend by default (the legacy
  `./mlruns` file store is in maintenance mode), which also enables the Model
  Registry step above without running a separate server.
