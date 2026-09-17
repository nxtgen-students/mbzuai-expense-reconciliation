// Lets request ARGUMENTS arrive in camelCase even where a controller reads the
// snake_case column name -- whether they come in the body or the query string.
//
// Incoming bodies were as inconsistent as outgoing ones: cardholderController
// reads `lastFourDigits` while transactionController reads `amount_aed`, so the
// frontend had to remember which spelling each endpoint wanted. Now the client
// sends camelCase everywhere and this fills in the other spelling.
//
// It ADDS aliases, it never replaces: a key the client actually sent always
// wins over a generated one. That is what makes it safe to apply to the receipt
// submission path, which reads seventeen snake_case fields and is the last place
// in this system anyone should be hand-editing to satisfy a naming convention.
//
// req.query is covered as well as req.body, because covering only half of it
// was a real outage: the frontend asked for a package preview with
// ?cardholderId=…&reconciliationPeriodId=…, spreadsheetController read
// req.query.cardholder_id, and every preview 400'd before the database was
// ever queried. Both manager download pages render off that preview, so the
// spreadsheet and the ZIP looked empty for every cardholder in every period
// while the data underneath was perfectly fine. An argument should not change
// meaning based on which side of the "?" it arrived on.
//
// Multer handles file uploads and runs per-route, after this, so uploads are
// unaffected.

const toCamelKey = (key) =>
  key.replace(/_+([a-z0-9])/g, (_match, character) => character.toUpperCase());

const toSnakeKey = (key) =>
  key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);

const withBothSpellings = (value) => {
  if (Array.isArray(value)) return value.map(withBothSpellings);

  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof Date ||
    Buffer.isBuffer(value)
  ) {
    return value;
  }

  const normalized = {};

  // Pass one: everything the client actually sent, so these can never be
  // clobbered by an alias generated in pass two.
  for (const [key, nested] of Object.entries(value)) {
    normalized[key] = withBothSpellings(nested);
  }

  // Pass two: fill in whichever spelling is missing.
  for (const [key, nested] of Object.entries(normalized)) {
    for (const alias of [toCamelKey(key), toSnakeKey(key)]) {
      if (!(alias in normalized)) normalized[alias] = nested;
    }
  }

  return normalized;
};

const isPlainish = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

const normalizeRequestBody = (req, res, next) => {
  if (isPlainish(req.body)) {
    req.body = withBothSpellings(req.body);
  }

  if (isPlainish(req.query)) {
    // NOT `req.query = …`. On Express 5 req.query is a getter with no setter,
    // so a plain assignment is silently ignored -- the middleware would look
    // correct, run without error, and change nothing. defineProperty puts an
    // own property on this request that shadows the prototype getter.
    Object.defineProperty(req, "query", {
      value: withBothSpellings(req.query),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  return next();
};

module.exports = normalizeRequestBody;
module.exports.withBothSpellings = withBothSpellings;
