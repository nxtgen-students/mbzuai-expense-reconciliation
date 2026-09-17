// Four fixes for one symptom: the manager's download pages showed nothing for
// any cardholder in any period, while the data underneath was correct.
//
//   1. req.query is normalized like req.body, so a camelCase query parameter
//      reaches a controller that reads the snake_case name. This was the
//      outage: /spreadsheets/preview 400'd on every request.
//   2. (frontend) a failed preview shows an error instead of rendering as an
//      empty period.
//   3. resolving the last flag moves the transaction to 'reviewed', so it
//      stops being filtered out of the package.
//   4. editing purchase_date recomputes reconciliation_period_id, so a
//      corrected date does not leave the row filed under the wrong fortnight.
process.env.JWT_SECRET = "test-only-secret-not-used-anywhere-real";

const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../src/app");
const pool = require("../src/db/pool");
const authService = require("../src/services/authService");
const { resolveFlag } = require("../src/controllers/flagController");

const realQuery = pool.query;

// ---------------------------------------------------------------------------
// 1. The query string speaks camelCase too
// ---------------------------------------------------------------------------

test("a camelCase query parameter reaches a controller reading snake_case", async (t) => {
  // The five packageable transactions on Xiwei's card in 04-17 Sept.
  const rows = [
    { transaction_id: 2, amount_aed: "415.80", status: "reviewed", has_unresolved_flags: false },
    { transaction_id: 15, amount_aed: "227.70", status: "submitted", has_unresolved_flags: false },
    { transaction_id: 16, amount_aed: "200.00", status: "submitted", has_unresolved_flags: false },
    { transaction_id: 12, amount_aed: "2000.00", status: "reviewed", has_unresolved_flags: false },
    { transaction_id: 18, amount_aed: "453.60", status: "submitted", has_unresolved_flags: false },
  ];
  const manager = {
    user_id: 1, full_name: "M", username: "m", role: "manager", is_active: true,
  };

  pool.query = async (text, params = []) => {
    if (text.includes("FROM users")) return { rows: [manager] };
    if (text.includes("FROM transactions t") && text.includes("has_unresolved_flags")) {
      const match = String(params[0]) === "2" && String(params[1]) === "2";
      return { rows: match ? rows : [] };
    }
    return { rows: [] };
  };

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = authService.signToken(manager);

  t.after(() => {
    pool.query = realQuery;
    server.close();
  });

  const ask = async (qs) => {
    const response = await fetch(`${base}/api/spreadsheets/preview?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() };
  };

  // What the browser actually sends. This is the request that used to 400.
  const camel = await ask("cardholderId=2&reconciliationPeriodId=2");
  assert.equal(camel.status, 200);
  assert.equal(camel.body.preview.totalCount, 5);
  assert.equal(camel.body.preview.eligibleReplenishment, 3297.1);

  // The spelling the controller reads must keep working.
  const snake = await ask("cardholder_id=2&reconciliation_period_id=2");
  assert.equal(snake.status, 200);
  assert.equal(snake.body.preview.totalCount, 5);

  // Normalizing must not turn the validation into a rubber stamp.
  const incomplete = await ask("cardholderId=2");
  assert.equal(incomplete.status, 400);
});

// ---------------------------------------------------------------------------
// 3. Resolving the last flag releases the transaction
// ---------------------------------------------------------------------------

let transactions;
let flags;

const fakeFlagQuery = async (text, params = []) => {
  if (text.includes("UPDATE flags SET resolved = TRUE")) {
    const flag = flags.find((f) => f.flag_id === Number(params[0]));
    if (!flag) return { rows: [], rowCount: 0 };
    flag.resolved = true;
    return { rows: [{ ...flag }], rowCount: 1 };
  }
  if (text.includes("UPDATE transactions t") && text.includes("'reviewed'")) {
    const tx = transactions.find((t) => t.transaction_id === Number(params[0]));
    const stillOpen = flags.some(
      (f) => f.transaction_id === Number(params[0]) && !f.resolved
    );
    if (!tx || tx.status !== "flagged" || stillOpen) return { rows: [], rowCount: 0 };
    tx.status = "reviewed";
    return { rows: [{ ...tx }], rowCount: 1 };
  }
  throw new Error(`unstubbed query in test: ${text}`);
};

const resolve = async (flagId) => {
  let payload;
  const res = {
    status() { return this; },
    json(body) { payload = body; return this; },
  };
  await resolveFlag({ params: { flagId: String(flagId) } }, res);
  return payload;
};

const withFlagStubs = (t) => {
  transactions = [
    { transaction_id: 1, status: "flagged" },
    { transaction_id: 2, status: "flagged" },
    { transaction_id: 3, status: "packaged" },
  ];
  flags = [
    { flag_id: 10, transaction_id: 1, resolved: false },
    { flag_id: 20, transaction_id: 2, resolved: false },
    { flag_id: 21, transaction_id: 2, resolved: false },
    { flag_id: 30, transaction_id: 3, resolved: false },
  ];
  pool.query = fakeFlagQuery;
  t.after(() => { pool.query = realQuery; });
};

test("resolving the last flag marks the transaction reviewed", async (t) => {
  withFlagStubs(t);

  const body = await resolve(10);

  assert.equal(body.flag.resolved, true);
  assert.equal(body.transactionStatus, "reviewed");
  assert.equal(transactions[0].status, "reviewed");
});

test("a transaction with another flag still open stays flagged", async (t) => {
  withFlagStubs(t);

  const body = await resolve(20);

  assert.equal(body.transactionStatus, null);
  assert.equal(transactions[1].status, "flagged");
});

test("clearing the remaining flag then marks it reviewed", async (t) => {
  withFlagStubs(t);

  await resolve(20);
  const body = await resolve(21);

  assert.equal(body.transactionStatus, "reviewed");
  assert.equal(transactions[1].status, "reviewed");
});

test("a packaged transaction is never dragged back to reviewed", async (t) => {
  withFlagStubs(t);

  const body = await resolve(30);

  assert.equal(body.flag.resolved, true);
  assert.equal(body.transactionStatus, null);
  assert.equal(transactions[2].status, "packaged");
});

test("an unknown flag id is a 404, not a silent success", async (t) => {
  withFlagStubs(t);

  let status;
  const res = {
    status(code) { status = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await resolveFlag({ params: { flagId: "9999" } }, res);

  assert.equal(status, 404);
});

// ---------------------------------------------------------------------------
// 4. A corrected purchase date moves the transaction to the right period
// ---------------------------------------------------------------------------

// Periods as they exist in production, plus the grid they sit on.
const PERIODS = [
  { reconciliation_period_id: 1, start_date: "2026-08-07", end_date: "2026-08-20" },
  { reconciliation_period_id: 2, start_date: "2026-09-04", end_date: "2026-09-17" },
  { reconciliation_period_id: 3, start_date: "2026-08-21", end_date: "2026-09-03" },
];

// Run updateTransaction against an in-memory row, returning what was written.
const runEdit = async (t, { startingDate, startingPeriodId, newDate }) => {
  const { updateTransaction } = require("../src/controllers/transactionController");

  const row = {
    transaction_id: 7,
    purchase_date: new Date(`${startingDate}T00:00:00`),
    reconciliation_period_id: startingPeriodId,
    vendor_name: "Deliveroo",
  };
  const written = {};
  const audits = [];
  let created = null;

  pool.query = async (text, params = []) => {
    if (text.includes("SELECT * FROM transactions")) return { rows: [row] };

    if (text.includes("FROM reconciliation_periods") && text.includes("start_date = $1")) {
      const hit = PERIODS.find(
        (p) => p.start_date === params[0] && p.end_date === params[1]
      );
      return { rows: hit ? [hit] : [] };
    }
    if (text.includes("INSERT INTO reconciliation_periods")) {
      created = { reconciliation_period_id: 99, start_date: params[0], end_date: params[1] };
      return { rows: [created] };
    }

    if (text.includes("UPDATE transactions") && text.includes("SET ")) {
      const fields = text.match(/SET ([\s\S]*?)\s+WHERE/)[1]
        .split(",")
        .map((f) => f.trim().split(" = ")[0]);
      fields.forEach((field, i) => { written[field] = params[i]; });
      return { rows: [{ ...row, ...written }] };
    }

    if (text.includes("INSERT INTO audit_logs")) {
      audits.push({ field: params[4], from: params[5], to: params[6] });
      return { rows: [] };
    }
    throw new Error(`unstubbed query in test: ${text}`);
  };
  t.after(() => { pool.query = realQuery; });

  const res = { status() { return this; }, json(body) { this.body = body; return this; } };
  await updateTransaction(
    {
      params: { id: "7" },
      body: { purchase_date: newDate },
      user: { userId: 1, fullName: "Manager" },
    },
    res
  );

  return { written, audits, created, response: res.body };
};

test("moving a purchase date into another fortnight refiles the transaction", async (t) => {
  // 19 Aug (period 1) corrected to 1 Sept, which belongs to period 3.
  const { written, audits } = await runEdit(t, {
    startingDate: "2026-08-19",
    startingPeriodId: 1,
    newDate: "2026-09-01",
  });

  assert.equal(written.purchase_date, "2026-09-01");
  assert.equal(written.reconciliation_period_id, 3);

  // The move is auditable: it shifts money between finance submissions.
  const moved = audits.find((a) => a.field === "reconciliation_period_id");
  assert.ok(moved, "the period change must be written to the audit log");
  assert.equal(moved.from, 1);
  assert.equal(moved.to, 3);
});

test("correcting a date within the same fortnight leaves the period alone", async (t) => {
  // 18 Aug -> 19 Aug, both inside period 1.
  const { written, audits } = await runEdit(t, {
    startingDate: "2026-08-18",
    startingPeriodId: 1,
    newDate: "2026-08-19",
  });

  assert.equal(written.purchase_date, "2026-08-19");
  assert.equal(
    written.reconciliation_period_id,
    undefined,
    "an unchanged period must not be rewritten"
  );
  assert.equal(audits.filter((a) => a.field === "reconciliation_period_id").length, 0);
});

test("a date in a fortnight never seen before creates that period", async (t) => {
  const { written, created } = await runEdit(t, {
    startingDate: "2026-08-19",
    startingPeriodId: 1,
    newDate: "2026-10-01",
  });

  assert.ok(created, "the missing period must be created on demand");
  // 1 Oct 2026 sits in the fortnight starting Friday 18 Sept, on the same
  // 14-day grid every other period is built from.
  assert.equal(created.start_date, "2026-09-18");
  assert.equal(created.end_date, "2026-10-01");
  assert.equal(written.reconciliation_period_id, 99);
});

test("a full ISO timestamp still edits cleanly", async (t) => {
  const { written } = await runEdit(t, {
    startingDate: "2026-08-19",
    startingPeriodId: 1,
    newDate: "2026-09-01T00:00:00.000Z",
  });

  assert.equal(written.reconciliation_period_id, 3);
});
