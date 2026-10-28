# Service level objective (declared before any measurement)

This file was committed before the first load test was run. `git log -- docs/SLO.md` shows the order.
The results are in `docs/results/LOADTEST.md`.

## Objective

| Indicator | Target |
|---|---|
| **Complete run latency, p95**, from the `POST /v1/complaints` call until `GET /v1/runs/{id}` returns a final status | **≤ 20 s** |
| Design load the target must hold at | **0.5 runs/s sustained** (about 43,000 runs/day) |
| Failed runs (status `failed`) | < 1 % |
| API availability (`/health` 200) | ≥ 99 % over the test |

The latency is measured from submission to final result, not for the submission call alone. The Locust
user submits, polls every 500 ms, and reports one `full_run` sample per completed run.

## Why 20 seconds, and why 0.5 runs/s

* **Section 1 of the brief.** The service does not decide anything. It produces an advisory routing that
  a grievance officer acts on, and the redress timelines it routes into are counted in days: 21 calendar
  days for an entity to resolve a complaint on SCORES, and 30 days for a bank to reply before the RBI
  Ombudsman takes a complaint. So the latency does not need to be sub-second.
  Routing is still the **first** step for every complaint. A wrong-regulator decision found late costs the
  investor weeks. The web client also shows the result to a person who is waiting, so a run has to finish
  while that person is still on the page. Twenty seconds is the most we accept for a person waiting on a
  form. It also leaves room for 6–8 model calls of about 1–2 s each from a free-tier provider.
* **Load.** 0.5 runs/s is far more than the complaint volume a national securities regulator receives
  through its online system. We chose it so that a burst (for example, after a market event or a broker
  default) does not breach the target. Locust is then run at higher user counts to find the breaking point.

## How it is measured

* The model is replaced by the stub provider (`llm-stub`), with a 900 ± 300 ms delay per call. That is
  close to a hosted free-tier model, so the test measures our system, not the provider's rate limits (D6).
* `docker compose --profile loadtest run --rm locust --headless -u <users> -r 1 -t 2m --csv /mnt/results/<name>`
* We run it with `agent-worker` scaled to 1 and to 3. Each run reports RPS, p50, p95 and the failure count.
