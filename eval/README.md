# Eval tasks

`tasks.json` is a set of realistic, multi-step on-call tasks used to measure how
effectively an agent selects and drives the `ir_*` tools. Each entry has:

- `prompt` — a natural-language request a responder might make.
- `expected_tools` — the tool(s) a good solution should use (order not strict).
- `notes` — optional expectations (e.g. destructive confirm behavior).

These are **not** part of `npm test`. They exercise real tool selection against
a live (dev) IncidentRelay and therefore need credentials and a running server.

## Running

1. Point the server at a disposable dev IncidentRelay:

   ```bash
   export IR_BASE_URL=https://dev-incidentrelay.example.com
   export IR_TOKEN=<dev-token>
   ```

   Consider `IR_READONLY=true` for a first pass so no state changes.

2. Drive each prompt through an agentic loop (your MCP client of choice, or the
   MCP SDK `Client`) with this server attached, then compare the tools the agent
   actually called against `expected_tools`. Score = fraction of tasks where the
   expected tools were used and the task's `notes` held (e.g. the destructive
   task triggered a confirm preview before execution).

3. Use failures to refine tool `description`s in `src/tools/*.ts` — per
   Anthropic's guidance, description edits are the highest-leverage improvement
   to tool selection.
