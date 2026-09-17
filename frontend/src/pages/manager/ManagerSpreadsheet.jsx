import { useState, useEffect } from "react";
import apiClient, { downloadAuthedFile } from "../../api/client";
import ManagerLayout from "../../components/ManagerLayout";

const fmt = (n) =>
  Number(n).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const StatCard = ({ label, value, sub, highlight }) => (
  <div className={`rounded-xl border p-4 flex flex-col gap-1 ${highlight ? "border-mbzuai-gold bg-mbzuai-gold/10" : "border-mbzuai-navy/10 bg-white"}`}>
    <p className="text-xs text-mbzuai-navy/50 uppercase tracking-wide font-medium">{label}</p>
    <p className={`text-2xl font-bold ${highlight ? "text-mbzuai-navy" : "text-mbzuai-navy"}`}>{value}</p>
    {sub && <p className="text-xs text-mbzuai-navy/40">{sub}</p>}
  </div>
);

export default function ManagerPackage() {
  const [cardholders, setCardholders]   = useState([]);
  const [periods, setPeriods]           = useState([]);
  const [cardholderId, setCardholderId] = useState("");
  const [periodId, setPeriodId]         = useState("");
  const [preview, setPreview]           = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [generated, setGenerated]       = useState(null); // { filename, summary }
  const [error, setError]               = useState("");

  useEffect(() => {
    apiClient.get("/cardholders").then((r) => setCardholders(r.data.cardholders));
    apiClient.get("/reconciliation-periods").then((r) => setPeriods(r.data.periods));
  }, []);

  // auto-preview whenever both selectors are filled
  useEffect(() => {
    if (!cardholderId || !periodId) { setPreview(null); return; }
    setPreviewLoading(true);
    setGenerated(null);
    setError("");
    apiClient
      .get("/spreadsheets/preview", { params: { cardholderId: cardholderId, reconciliationPeriodId: periodId } })
      .then((r) => setPreview(r.data.preview))
      // A swallowed failure here is what hid a total outage: the request was
      // 400ing on every cardholder and every period, and the page rendered
      // exactly as it does for a period that genuinely has no transactions.
      // "The request failed" and "there is nothing here" must never look alike.
      .catch((err) => {
        setPreview(null);
        setError(
          err.response?.data?.message ??
            "Could not load the preview for this cardholder and period."
        );
      })
      .finally(() => setPreviewLoading(false));
  }, [cardholderId, periodId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await apiClient.post("/spreadsheets/generate", {
        cardholderId: cardholderId,
        reconciliationPeriodId: periodId,
      });
      setGenerated({ filename: res.data.filename, summary: res.data.summary });
      setPreview(null);
    } catch (err) {
      setError(err.response?.data?.message ?? "Failed to generate spreadsheet");
    } finally {
      setGenerating(false);
    }
  };

  const selectClass =
    "w-full rounded-lg border border-mbzuai-navy/20 px-3 py-2.5 text-sm text-mbzuai-navy focus:border-mbzuai-gold focus:outline-none bg-white";

  const selectedCardholder = cardholders.find((c) => String(c.cardholderId) === cardholderId);
  const selectedPeriod     = periods.find((p) => String(p.reconciliationPeriodId) === periodId);

  return (
    <ManagerLayout>
      <p className="text-mbzuai-gold font-medium tracking-wide uppercase text-sm">Manager</p>
      <h1 className="mt-2 text-3xl font-semibold text-mbzuai-navy">Reconciliation Spreadsheet</h1>
      <p className="mt-1 text-sm text-mbzuai-navy/50">
        Generate and download the Excel spreadsheet only. For the full ZIP (spreadsheet + receipt files), use <strong>Download Package</strong>.
      </p>

      {/* selectors */}
      <div className="mt-8 grid grid-cols-2 gap-4 max-w-xl">
        <div>
          <label className="block text-xs font-medium text-mbzuai-navy/60 mb-1.5 uppercase tracking-wide">
            Cardholder
          </label>
          <select value={cardholderId} onChange={(e) => setCardholderId(e.target.value)} className={selectClass}>
            <option value="">Select cardholder…</option>
            {cardholders.map((c) => (
              <option key={c.cardholderId} value={c.cardholderId}>
                {c.cardholderName} (#{c.lastFourDigits})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-mbzuai-navy/60 mb-1.5 uppercase tracking-wide">
            Reconciliation Period
          </label>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className={selectClass}>
            <option value="">Select period…</option>
            {periods.map((p) => (
              <option key={p.reconciliationPeriodId} value={p.reconciliationPeriodId}>
                {new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* loading */}
      {previewLoading && (
        <p className="mt-8 text-sm text-mbzuai-navy/50 animate-pulse">Loading eligible transactions…</p>
      )}

      {/* Failure banner. Rendered OUTSIDE the preview block on purpose: the
          error state below only renders when a preview exists, so a request
          that fails -- the case that leaves preview null -- could never show
          it. That is precisely how this failed silently. */}
      {error && !preview && !previewLoading && (
        <div className="mt-8 max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">Could not load the preview</p>
          <p className="mt-0.5 text-sm text-red-700">{error}</p>
          <p className="mt-1.5 text-xs text-red-600">
            This is a failure to load, not an empty period. The transactions may
            well be there.
          </p>
        </div>
      )}

      {/* preview */}
      {preview && !generated && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold text-mbzuai-navy">Spreadsheet Preview</h2>
            <span className="text-xs bg-mbzuai-navy/10 text-mbzuai-navy px-2 py-0.5 rounded-full font-medium">
              {selectedCardholder?.cardholderName} · {new Date(selectedPeriod?.startDate).toLocaleDateString()} – {new Date(selectedPeriod?.endDate).toLocaleDateString()}
            </span>
          </div>

          {preview.totalCount === 0 ? (
            <div className="rounded-xl border border-mbzuai-navy/10 bg-white p-8 text-center text-mbzuai-navy/40 text-sm">
              No eligible transactions for this cardholder and period.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Total Transactions"          value={preview.totalCount} />
                <StatCard label="Clean (Submitted)"           value={preview.submittedCount} sub="No flags" />
                <StatCard label="Manager Reviewed"            value={preview.reviewedCount} sub="Flags resolved" />
                <StatCard label="Already Packaged"            value={preview.packagedCount} sub="Will regenerate" />
                <StatCard label="Excluded (Unresolved)"       value={`AED ${fmt(preview.excludedAmount)}`} />
                <StatCard label="Eligible Replenishment"      value={`AED ${fmt(preview.eligibleReplenishment)}`} highlight />
              </div>

              <div className="mt-6 rounded-xl border border-mbzuai-navy/10 bg-mbzuai-sand/40 p-4 text-sm text-mbzuai-navy/70">
                <strong className="text-mbzuai-navy">What happens when you generate:</strong>
                <ul className="mt-1.5 list-disc list-inside space-y-0.5">
                  <li>An Excel spreadsheet is created for {selectedCardholder?.cardholderName} covering this period.</li>
                  <li>All {preview.totalCount} eligible transactions are included (already-packaged ones are regenerated).</li>
                  <li>The file is ready to download and upload to E-Services.</li>
                </ul>
              </div>

              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="mt-5 px-6 py-2.5 rounded-lg bg-mbzuai-navy text-white text-sm font-medium hover:bg-mbzuai-navy/80 disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate Spreadsheet"}
              </button>
            </>
          )}
        </div>
      )}

      {/* success state */}
      {generated && (
        <div className="mt-8">
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <p className="text-green-800 font-semibold text-sm">Spreadsheet generated successfully</p>
            <p className="text-green-700 text-xs mt-0.5">{generated.filename}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Transactions"         value={generated.summary.transactionCount} />
            <StatCard label="Total Spend"          value={`AED ${fmt(generated.summary.totalSpend)}`} />
            <StatCard label="Excluded"             value={`AED ${fmt(generated.summary.excludedAmount)}`} />
            <StatCard label="Eligible"             value={`AED ${fmt(generated.summary.eligibleReplenishment)}`} highlight />
            <StatCard label="Missing Receipts"     value={generated.summary.missingReceiptCount} />
          </div>

          <div className="mt-5 flex gap-3">
            {/* Was a plain <a href>. A browser navigating to a URL sends no
                Authorization header, so that returned 401 once the route was
                actually protected — fetch the bytes with the token instead. */}
            <button
              type="button"
              onClick={() =>
                downloadAuthedFile(
                  `/spreadsheets/download/${encodeURIComponent(generated.filename)}`,
                  generated.filename
                ).catch((err) => setError(err.message))
              }
              className="px-5 py-2.5 rounded-lg bg-mbzuai-gold text-mbzuai-navy text-sm font-semibold hover:bg-mbzuai-gold/80"
            >
              Download Spreadsheet
            </button>
            <button
              onClick={() => { setGenerated(null); setCardholderId(""); setPeriodId(""); }}
              className="px-5 py-2.5 rounded-lg border border-mbzuai-navy/20 text-mbzuai-navy text-sm font-medium hover:bg-mbzuai-sand/50"
            >
              Generate Another
            </button>
          </div>
        </div>
      )}
    </ManagerLayout>
  );
}
