# Conserve usage, but conserve smart 

A local-first Next.js dashboard for Codex task execution and reported ChatGPT allowance windows. It runs the official Codex App Server as a local child process. The SQLite database stores usage snapshots and task records; credentials stay with Codex and are never copied into the database or browser.

Phase 2 adds deterministic allowance forecasts, a Nebius Token Factory Nemotron task analyzer, catalog-validated Auto routing, and a one-retry escalation control. Existing tables and records are retained; new task columns are added in place.

## Run

Requirements: Node.js 22+, Codex CLI on `PATH`, and an existing Codex sign-in (`codex login`).

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:3000>. Optionally set `CODEX_BIN` to the Codex executable and `QUOTAPILOT_DB` to an SQLite file path. The default database is `data/quotapilot.sqlite` and is gitignored.

For Auto Mode, copy `.env.example` to `.env.local`, then set `NEBIUS_API_KEY` and `NEBIUS_NEMOTRON_MODEL` to a Nemotron model ID available in your Nebius Token Factory account. Restart the server. The key is used only in the server route. An Auto preview makes one Nebius inference request; clicking **Run with Codex** starts the separate Codex task. If Nebius fails, the error is shown and Manual Mode remains available. Model IDs offered to Nemotron come from the live Codex `model/list` response, which is a catalog rather than an entitlement guarantee.

The built-in GPT-5.6 Luna/Terra/Sol tiers follow [OpenAI's documented family positioning](https://developers.openai.com/api/docs/changelog), and are applied only if those exact IDs appear in the Codex catalog. For other models, set `QUOTAPILOT_MODEL_PROFILES` to JSON such as `{"my-efficient-model":{"tier":1,"capabilities":["code_generation","testing"]},"my-advanced-model":{"tier":3,"capabilities":["code_generation","debugging","architecture","refactoring","testing"]}}`. Tiers are explicit operator judgments, not inferred from names, prices, or ChatGPT allowance cost. If no profile matches, the preview explains that routing confidence is low.

Enter a local workspace path when starting a task. The default is this app's folder. Tasks use the App Server's documented `thread/start` and `turn/start` methods with the CLI's `workspace-write` sandbox and `approvalPolicy: never`; operations requiring escalation fail rather than automatically gaining extra access. The dashboard polls every 30 seconds and the server requests allowance snapshots every 60 seconds while running. App Server `account/rateLimits/updated` notifications also create snapshots.

## Data provenance

- **Real:** `account/read`, `model/list`, `account/rateLimits/read`, `account/rateLimits/updated`, task lifecycle events, and task outcomes, all via the official local App Server.
- **Derived:** Remaining percent is `100 - usedPercent`; reset countdowns use the reported `resetsAt` timestamp and the local clock.
- **Forecasts:** Each five-hour and weekly window is analyzed independently. Decreases in remaining percentage across distinct readings form consumption rates. Increases are treated as rolling releases or resets. Three usable intervals across at least an hour are required before scenarios appear; a longer observation span is required for moderate confidence. Conservative, expected, and high-usage scenarios project observed percentage changes to the reported reset, capped at 0–100%. They are uncertain because future tasks and rolling releases are unknown.
- **Unavailable:** In API-key mode, ChatGPT allowance windows are not reported. If a window is absent, QuotaPilot displays “No data.” It never estimates limits from token usage.
- **No simulated usage data.** Unit tests use synthetic fixtures only.

`model/list` supplies picker options and the model used when the picker is left on its default setting, but does not guarantee account entitlement to each model. A task run provides the actual access test. Snapshot rows are keyed by bucket ID, primary/secondary slot, and timestamp; the UI labels a window as five-hour only when `windowDurationMins` is 300 and weekly only when it is 10080.

Task status means the Codex turn completed, failed, or was interrupted; it does not prove code correctness. When Codex emits a completed test command with an exit code, the result is recorded. Otherwise the history explicitly says correctness is unverified. Failed tasks or tasks with observed test failures may offer one user-triggered retry on the next documented/profiled tier. Automatic retries are disabled by default. To allow them, set `QUOTAPILOT_AUTO_ESCALATE=1` and restart, then explicitly opt in for an individual task. An automatic retry happens only after an observed test command fails, only once, and only if a stronger configured model is present. It causes another Codex run. The retry button remains available for failures without an observed test result.

## Evaluation

`evaluation/tasks.json` defines representative task categories and success criteria. To compare lightweight, stronger, and QuotaPilot routing, run each task in an isolated copy of a suitable test repository using the dashboard, once per strategy and preferably several repetitions. Record actual results in a JSONL file outside the app. Each line should contain `taskId`, `strategy` (`lightweight`, `stronger`, or `quotapilot`), `measured: true`, `model`, `success`, `testsPassed`, `selectionAppropriate`, `retries`, `durationSeconds`, and, only if snapshots bracket the run without unrelated activity, `allowanceDeltaPercent`. Use the task criteria for the selection judgment. Then run:

```sh
node evaluation/report.mjs path/to/measurements.jsonl
```

The report ignores hypothetical entries. No success, usage-savings, or quality improvement claim is made before real comparative runs. A ChatGPT allowance delta is a window-level observation, not a model-specific token charge.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

## Official interfaces

- [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
- [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk)
- [Nebius Token Factory API examples](https://docs.tokenfactory.nebius.com/api-reference/examples/batches)

This prototype binds Next.js to `127.0.0.1`. It is intended for one trusted user on a local machine; add authentication and request origin controls before exposing it beyond localhost.
