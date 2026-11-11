"""Tracking hyperparameter tuning with MLflow.

A faithful reproduction of the MLflow "Getting Started: Hyperparameter Tuning"
tutorial, configured to run ``n_trials = 10``.

Reference: https://mlflow.org/docs/latest/ml/getting-started/hyperparameter-tuning/

The tutorial uses Optuna to tune a scikit-learn ``RandomForestRegressor`` on the
California Housing dataset, and uses MLflow parent/child runs to track each
trial:

* A **parent run** (named ``"study"``) groups the whole optimisation session.
* Each Optuna **trial** runs the ``objective`` function inside a **child run**
  (``nested=True``), logging that trial's params, error metric and model.

Run it with:

    python hyperparameter_tuning.py

Then view the results in the MLflow UI:

    mlflow server --port 5000
"""

import mlflow
import optuna
import sklearn
import sklearn.datasets
import sklearn.ensemble
import sklearn.metrics
from sklearn.model_selection import train_test_split

# Number of Optuna trials (tutorial default is 30; this run uses 10).
N_TRIALS = 10

# ---------------------------------------------------------------------------
# Step 1: Create a new experiment
# ---------------------------------------------------------------------------
# The set_experiment API creates a new experiment if it doesn't exist.
mlflow.set_experiment("Hyperparameter Tuning Experiment")

# ---------------------------------------------------------------------------
# Step 2: Prepare your data
# ---------------------------------------------------------------------------
# Load a sample dataset and split it into training and validation sets.
X, y = sklearn.datasets.fetch_california_housing(return_X_y=True)
X_train, X_val, y_train, y_val = train_test_split(X, y, random_state=0)


# ---------------------------------------------------------------------------
# Step 3: Define the objective function
# ---------------------------------------------------------------------------
def objective(trial):
    # Setting nested=True will create a child run under the parent run.
    with mlflow.start_run(nested=True, run_name=f"trial_{trial.number}") as child_run:
        rf_max_depth = trial.suggest_int("rf_max_depth", 2, 32)
        rf_n_estimators = trial.suggest_int("rf_n_estimators", 50, 300, step=10)
        rf_max_features = trial.suggest_float("rf_max_features", 0.2, 1.0)
        params = {
            "max_depth": rf_max_depth,
            "n_estimators": rf_n_estimators,
            "max_features": rf_max_features,
        }
        # Log current trial's parameters
        mlflow.log_params(params)

        regressor_obj = sklearn.ensemble.RandomForestRegressor(**params)
        regressor_obj.fit(X_train, y_train)

        y_pred = regressor_obj.predict(X_val)
        error = sklearn.metrics.mean_squared_error(y_val, y_pred)

        # Log current trial's error metric
        mlflow.log_metrics({"error": error})
        # Log the model file.
        # NOTE: MLflow >= 3 defaults to the skops serialization format, which
        # refuses to save tree-based models (sklearn.tree._tree.Tree is flagged
        # as an untrusted type). We pin cloudpickle so the RandomForest model
        # logs and reloads cleanly.
        mlflow.sklearn.log_model(
            regressor_obj, name="model", serialization_format="cloudpickle"
        )
        # Make it easy to retrieve the best-performing child run later
        trial.set_user_attr("run_id", child_run.info.run_id)

        return error


def main():
    # -----------------------------------------------------------------------
    # Step 3 (cont.): Run the hyperparameter tuning study
    # -----------------------------------------------------------------------
    # Create a parent run that contains all child runs for different trials.
    with mlflow.start_run(run_name="study") as run:
        # Log the experiment settings
        n_trials = N_TRIALS
        mlflow.log_param("n_trials", n_trials)

        study = optuna.create_study(direction="minimize")
        study.optimize(objective, n_trials=n_trials)

        # Log the best trial and its run ID
        mlflow.log_params(study.best_trial.params)
        mlflow.log_metrics({"best_error": study.best_value})
        if best_run_id := study.best_trial.user_attrs.get("run_id"):
            mlflow.log_param("best_child_run_id", best_run_id)

        print("\n=== Study complete ===")
        print(f"Parent run ID : {run.info.run_id}")
        print(f"Trials run    : {n_trials}")
        print(f"Best trial    : #{study.best_trial.number}")
        print(f"Best error    : {study.best_value:.6f}")
        print(f"Best params   : {study.best_trial.params}")
        print(f"Best child run: {best_run_id}")


if __name__ == "__main__":
    main()
