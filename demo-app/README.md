# demo-app

Owner: Person B. The checkout app the agent tests in the demo.

Needs:
- `POST /api/orders`, `POST /api/pay`, `GET /api/orders/:id`; pages `/cart`, `/checkout`, `/orders/:id`.
- Postgres tables `orders`, `charges`. A fake payment provider with modes `ok | slow | timeout | error`.
- Sandbox-only test hooks: `POST /__test/reset`, `POST /__test/seed {fixture}`, `POST /__test/provider {mode, latencyMs}`, `GET /__test/db/:table`.
- Relative URLs only (it is served under `/preview/<session>/<env>/` inside the live view embedded in Jira).
- `data-test` attributes matching `manifest.json`.

The bug PR removes the payment lock. With `slow` 800 ms and 5 parallel `POST /api/pay`, base must make 1 charge and the PR 2, 10 out of 10 times.

`manifest.json` is part of the shared contract and is validated in `packages/contracts/test`.
