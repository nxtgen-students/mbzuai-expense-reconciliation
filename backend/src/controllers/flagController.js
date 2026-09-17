const pool = require("../db/pool");

const resolveFlag = async (req, res) => {
  try {
    const { flagId } = req.params;

    const result = await pool.query(
      `UPDATE flags SET resolved = TRUE WHERE flag_id = $1 RETURNING *`,
      [flagId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Flag not found" });
    }

    const flag = result.rows[0];

    // Clearing the last flag has to move the TRANSACTION too, not just the
    // flag row. 'flagged' is excluded from the preview, the spreadsheet and
    // the package (all three filter status IN submitted/reviewed/packaged), so
    // a transaction left at 'flagged' with every flag resolved is invisible to
    // reconciliation -- the manager resolves the flag, sees nothing change,
    // and the spend silently never reaches finance.
    //
    // Resolving every flag IS the review: a manager only gets here by opening
    // each exception and clearing it deliberately, so requiring a separate
    // "Mark reviewed" click afterwards just adds a step whose omission breaks
    // the package.
    //
    // One statement rather than a read-then-write: the guards live in the
    // WHERE clause, so concurrent resolves on the same transaction cannot
    // race, and re-resolving an already-resolved flag is a no-op.
    const promoted = await pool.query(
      `UPDATE transactions t
          SET status = 'reviewed'
        WHERE t.transaction_id = $1
          AND t.status = 'flagged'
          AND NOT EXISTS (
                SELECT 1 FROM flags f
                 WHERE f.transaction_id = t.transaction_id
                   AND f.resolved = FALSE
              )
        RETURNING t.transaction_id, t.status`,
      [flag.transaction_id]
    );

    return res.status(200).json({
      success: true,
      flag,
      // null when other flags are still open, or when the transaction had
      // already moved on to reviewed/packaged. The client uses this to update
      // the row's status badge without refetching.
      transactionStatus: promoted.rows[0]?.status ?? null,
    });
  } catch (error) {
    console.error("resolveFlag error:", error);
    return res.status(500).json({ success: false, message: "Failed to resolve flag" });
  }
};

module.exports = { resolveFlag };
