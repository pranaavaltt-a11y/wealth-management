# Runbook — MLflow Hyperparameter Tuning Demo (`n_trials = 10`)

A step-by-step guide to run the MLflow + Optuna hyperparameter-tuning tutorial on
your own machine and view the results in the MLflow UI.

Tutorial reproduced: <https://mlflow.org/docs/latest/ml/getting-started/hyperparameter-tuning/>

---

## What this demo shows

Optuna searches for the best `RandomForestRegressor` hyperparameters on the
California Housing dataset, running **10 trials**. Every trial is tracked in
MLflow as a **child run** under one **parent run** (`study`), so you can compare
all 10 attempts and see which won.

---

## 0. Prerequisites (one time)

- **Python 3.9+** — check with `python --version`. (Get it from python.org; tick
  *"Add Python to PATH"* during install.)
- **Git** — check with `git --version`.

---

## 1. Get the code

```powershell
git clone https://github.com/pranaavaltt-a11y/wealth-management.git
cd wealth-management
git checkout claude/sweet-archimedes-7v7ndw
cd mlflow-tuning
```

> Already have the repo? Just run `git pull`, `git checkout claude/sweet-archimedes-7v7ndw`, then `cd mlflow-tuning`.

## 2. Create and activate a virtual environment

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

> If activation is blocked ("running scripts is disabled"), run this once, then retry:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`
>
> On macOS/Linux the activate command is `source venv/bin/activate` instead.

## 3. Install the dependencies

```powershell
pip install -r requirements.txt
```

(Installs `mlflow`, `optuna`, `scikit-learn`.)

## 4. Point MLflow at a local database

```powershell
$env:MLFLOW_TRACKING_URI = "sqlite:///mlflow.db"
```

> macOS/Linux: `export MLFLOW_TRACKING_URI="sqlite:///mlflow.db"`

## 5. Run the 10-trial study

```powershell
python hyperparameter_tuning.py
```

You'll see Optuna print each trial, ending with a summary like:

```
=== Study complete ===
Parent run ID : 9c3597bc9f384d1083601a9c1c96e0ef
Trials run    : 10
Best trial    : #1
Best error    : 0.244922
Best params   : {'rf_max_depth': 22, 'rf_n_estimators': 150, 'rf_max_features': 0.477...}
```

(Exact numbers vary each run — Optuna's search is randomised.)

## 6. Open the MLflow UI

```powershell
mlflow server --backend-store-uri sqlite:///mlflow.db --port 5000
```

Leave that window running, then open **http://localhost:5000** in your browser.
To stop the server later, press **Ctrl+C** in that window.

---

## What to show your teacher in the UI

1. **Experiments → "Hyperparameter Tuning Experiment"** — click it.
2. The **`study`** run is the parent. Expand it (click the ▸ arrow) to reveal the
   **10 child runs** `trial_0` … `trial_9`. This is the parent/child tracking the
   tutorial is about.
3. Tick the child runs, then click the **chart icon** (top-left) to compare them —
   the **Parallel Coordinates** plot shows how `max_depth`, `n_estimators` and
   `max_features` relate to the `error` metric.
4. Click the **best** child run (lowest `error`) to see its logged parameters,
   metric and saved model.
5. **Models** tab (if you ran the registration step) — the best model registered
   as `housing-price-predictor`.

### One-line explanation you can give

> "Optuna tried 10 different hyperparameter combinations for a Random Forest.
> MLflow logged each attempt as a child run under one parent 'study' run, so we
> can compare all 10 and pick the one with the lowest validation error."

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `The token '&&' is not a valid statement separator` | You're in Windows PowerShell — run each command on its own line (don't chain with `&&`), or use `;`. |
| `running scripts is disabled on this system` | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, then activate again. |
| `'mlflow' is not recognized` | Your venv isn't active — re-run `.\venv\Scripts\Activate.ps1`. |
| UI is empty | The server isn't reading the same DB. Make sure you pass `--backend-store-uri sqlite:///mlflow.db` and run it from the `mlflow-tuning` folder. |
| Port 5000 in use | Use another port, e.g. `--port 5001`, and open `http://localhost:5001`. |
