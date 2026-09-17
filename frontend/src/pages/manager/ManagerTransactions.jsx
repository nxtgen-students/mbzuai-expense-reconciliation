// frontend/src/pages/manager/ManagerTransactions.jsx
import { useState, useEffect } from "react";
import apiClient, { openAuthedFile, downloadAuthedFile } from "../../api/client";
import ManagerLayout from "../../components/ManagerLayout";

export default function ManagerTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [cardholders, setCardholders] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [cardholderFilter, setCardholderFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [generatingId, setGeneratingId] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const isDeleted = selectedTransaction?.status === "deleted" || selectedTransaction?.isActive === false;
  const [modalFlags, setModalFlags] = useState([]);
  const [editFields, setEditFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [resolvingFlagId, setResolvingFlagId] = useState(null);
  const [markingReviewed, setMarkingReviewed] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [budgetItems, setBudgetItems] = useState([])
  const inputClass =
  "w-full rounded-lg border border-mbzuai-navy/20 px-3 py-2 text-sm text-mbzuai-navy";

  // load everything once
  useEffect(() => {
    apiClient
      .get("/transactions")
      .then((res) => setTransactions(res.data.transactions));
    apiClient
      .get("/cardholders")
      .then((res) => setCardholders(res.data.cardholders));
    apiClient
      .get("/reconciliation-periods")
      .then((res) => setPeriods(res.data.periods));
    apiClient
      .get("/budget-items")
      .then((res) => setBudgetItems(res.data.budgetItems || []))
      .catch((err) => console.error("Failed to load budget items:", err));
  }, []);

  useEffect(() => {
    if (!selectedTransaction) {
      setModalFlags([]);
      setEditFields({});
      return;
    }
    const { vendorName, purchaseDate, invoiceNumber, category, budgetItemId, department, amountAed, originalCurrency, paymentMethod, notes } = selectedTransaction;
    setEditFields({
      vendorName: vendorName ?? "",
      purchaseDate: purchaseDate ? purchaseDate.split("T")[0] : "",
      invoiceNumber: invoiceNumber ?? "",
      category: category ?? "",
      budgetItemId: budgetItemId ?? "",
      department: department ?? "",
      amountAed: amountAed ?? "",
      originalCurrency: originalCurrency ?? "",
      paymentMethod: paymentMethod ?? "",
      notes: notes ?? "",
    });
    apiClient
      .get(`/transactions/${selectedTransaction.transactionId}/flags`)
      .then((res) => setModalFlags(res.data.flags))
      .catch((err) => console.error("Failed to load flags:", err));
  }, [selectedTransaction]);

  // apply filters in the browser (client-side filtering)
  const filtered = transactions.filter((t) => {
    const matchCardholder =
      !cardholderFilter || String(t.cardholderId) === cardholderFilter;
    const matchPeriod =
      !periodFilter || String(t.reconciliationPeriodId) === periodFilter;
    return matchCardholder && matchPeriod;
  });

  const handleGenerate = async (id) => {
    setGeneratingId(id);
    try {
      const res = await apiClient.post(`/transactions/${id}/generate-pdf`);
      // update that transaction's pdfPath in state so the row switches to View/Download
      setTransactions((prev) =>
        prev.map((t) =>
          t.transactionId === id ? { ...t, pdfPath: res.data.pdfPath } : t
        )
      );
    } catch (err) {
      console.error("Generate failed:", err.message);
    } finally {
      setGeneratingId(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiClient.patch(
        `/transactions/${selectedTransaction.transactionId}`,
        editFields
      );
      const refreshed = await apiClient.get("/transactions");
      setTransactions(refreshed.data.transactions);

      setSelectedTransaction(null);
      setEditFields({});
      
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
  selectedTransaction &&
  Object.keys(editFields).some((key) => {
    const original =
      key === "purchaseDate"
        ? (selectedTransaction.purchaseDate?.split("T")[0] ?? "")
        : (selectedTransaction[key] ?? "");

    return String(editFields[key] ?? "") !== String(original);
  });

  const handleResolveFlag = async (flagId) => {
    setResolvingFlagId(flagId);
    try {
      const res = await apiClient.patch(`/flags/${flagId}/resolve`);
      setModalFlags((prev) =>
        prev.map((f) => (f.flagId === flagId ? res.data.flag : f))
      );

      // Resolving the LAST flag moves the transaction to 'reviewed' on the
      // server. Reflect it here or the row keeps its amber badge until a
      // reload, which reads as "the resolve did nothing".
      const newStatus = res.data.transactionStatus;
      if (newStatus) {
        const txId = selectedTransaction?.transactionId;
        setTransactions((prev) =>
          prev.map((t) =>
            t.transactionId === txId ? { ...t, status: newStatus } : t
          )
        );
        setSelectedTransaction((prev) =>
          prev ? { ...prev, status: newStatus } : prev
        );
      }
    } catch (err) {
      console.error("Resolve flag failed:", err);
    } finally {
      setResolvingFlagId(null);
    }
  };

  const handleMarkReviewed = async () => {
    setMarkingReviewed(true);
    try {
      await apiClient.patch(
        `/transactions/${selectedTransaction.transactionId}/status`,
        { status: "reviewed" }
      );
      setTransactions((prev) =>
        prev.map((t) =>
          t.transactionId === selectedTransaction.transactionId
            ? { ...t, status: "reviewed" }
            : t
        )
      );
      setSelectedTransaction(null);
    } catch (err) {
      console.error("Mark reviewed failed:", err);
    } finally {
      setMarkingReviewed(false);
    }
  };

  const handleDeleteTransaction = async () => {
    if (!selectedTransaction) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this transaction?"
    );

    if (!confirmed) return;

    try {
      const res = await apiClient.patch(
        `/transactions/${selectedTransaction.transactionId}/delete`
      );

      const deletedTransaction = res.data.transaction;

      setTransactions((prev) =>
        prev.map((t) =>
          t.transactionId === deletedTransaction.transactionId
            ? deletedTransaction
            : t
        )
      );

      setSelectedTransaction(null);
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete transaction.");
    }
  };

  const handleViewHistory = async () => {
    if (!selectedTransaction) return;

    if (showAuditLogs) {
      setShowAuditLogs(false);
      return;
    }

    try {
      setLoadingAuditLogs(true);

      const res = await apiClient.get(
        `/transactions/${selectedTransaction.transactionId}/audit-logs`
      );

      setAuditLogs(res.data.auditLogs);
      setShowAuditLogs(true);
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
      alert("Failed to load edit history.");
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  const statusBadge = (status) => {
    const styles = {
      submitted: "bg-mbzuai-navy/10 text-mbzuai-navy",
      flagged: "bg-amber-100 text-amber-700",
      reviewed: "bg-green-100 text-green-700",
      deleted: "bg-red-100 text-red-700",
      packaged: "bg-blue-100 text-blue-700",
    };
    return styles[status] || "bg-gray-100 text-gray-600";
  };

  const selectClass =
    "rounded-lg border border-mbzuai-navy/20 px-3 py-2 text-sm text-mbzuai-navy focus:border-mbzuai-gold focus:outline-none";

  return (
    <ManagerLayout>
      <p className="text-mbzuai-gold font-medium tracking-wide uppercase text-sm">
        Manager
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-mbzuai-navy">
        Transactions
      </h1>

      {/* filters */}
      <div className="mt-6 flex flex-wrap gap-3">
        <select
          value={cardholderFilter}
          onChange={(e) => setCardholderFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All cardholders</option>
          {cardholders.map((c) => (
            <option key={c.cardholderId} value={c.cardholderId}>
              {c.cardholderName}
            </option>
          ))}
        </select>

        <select
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All periods</option>
          {periods.map((p) => (
            <option
              key={p.reconciliationPeriodId}
              value={p.reconciliationPeriodId}
            >
              {new Date(p.startDate).toLocaleDateString()} –{" "}
              {new Date(p.endDate).toLocaleDateString()}
            </option>
          ))}
        </select>
      </div>

      {/* Table. Seven columns never fit a phone; without a scroll container the
          browser's only move is to wrap every cell, which turned one vendor
          name into four stacked lines and pushed the later columns off-screen
          with no way to reach them. `min-w` keeps the columns at a readable
          width and lets the wrapper scroll instead. overflow-hidden stays on
          the OUTER div so the rounded corners still clip. */}
      <div className="mt-6 bg-white rounded-2xl border border-mbzuai-navy/10 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-mbzuai-navy/50 bg-mbzuai-sand/50">
              <th className="px-5 py-3 font-medium whitespace-nowrap">Ref</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Cardholder</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Vendor</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Purchase For</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Amount</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Status</th>
              <th className="px-5 py-3 font-medium whitespace-nowrap">Receipt PDF</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-10 text-center text-mbzuai-navy/50"
                >
                  No transactions match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr
                  key={t.transactionId}
                  onClick={() => {
                    setAuditLogs([]);
                    setShowAuditLogs(false);
                    setSelectedTransaction(t);
                  }}
                  className="border-t border-mbzuai-navy/5 hover:bg-mbzuai-sand/30 transition-colors"
                >
                  <td className="px-5 py-4 text-mbzuai-navy/70 whitespace-nowrap">
                    #{t.transactionId}
                  </td>
                  <td className="px-5 py-4 font-medium text-mbzuai-navy whitespace-nowrap">
                    {t.cardholderName}
                  </td>
                  <td className="px-5 py-4 text-mbzuai-navy/70">
                    {t.vendorName}
                  </td>
                  <td className="px-5 py-4 text-mbzuai-navy/70">
                    {t.budgetItemName || "—"}
                  </td>
                  <td className="px-5 py-4 text-mbzuai-navy/70 whitespace-nowrap">
                    AED {t.amountAed}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${statusBadge(
                        t.status
                      )}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    {t.pdfPath ? (
                      <div className="flex gap-3 text-sm">
                        {/* These were plain <a href> links. A browser
                            navigating to a URL sends no Authorization header,
                            so they broke once the receipt archive became
                            genuinely manager-only — fetch with the token. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openAuthedFile(
                              `/transactions/${t.transactionId}/pdf`
                            ).catch((err) => alert(err.message));
                          }}
                          className="text-mbzuai-navy underline hover:text-mbzuai-gold"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadAuthedFile(
                              `/transactions/${t.transactionId}/pdf?download=true`,
                              `transaction-${t.transactionId}.pdf`
                            ).catch((err) => alert(err.message));
                          }}
                          className="text-mbzuai-navy underline hover:text-mbzuai-gold"
                        >
                          Download
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleGenerate(t.transactionId); }}
                        disabled={generatingId === t.transactionId}
                        className="text-sm text-mbzuai-navy underline hover:text-mbzuai-gold disabled:opacity-50"
                      >
                        {generatingId === t.transactionId
                          ? "Generating…"
                          : "Generate PDF"}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
      {/* transaction detail modal */}
      {selectedTransaction && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6"
          onClick={() => setSelectedTransaction(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* modal header */}
            <div className="px-6 py-4 border-b border-mbzuai-navy/10 flex items-start justify-between">
              <div>
                <p className="text-mbzuai-gold font-medium tracking-wide uppercase text-xs">
                  Transaction #{selectedTransaction.transactionId}
                </p>
                <h2 className="text-xl font-semibold text-mbzuai-navy mt-0.5">
                  {selectedTransaction.vendorName}
                </h2>
                <p className="text-sm text-mbzuai-navy/50 mt-0.5">
                  {selectedTransaction.cardholderName} &middot; submitted{" "}
                  {new Date(selectedTransaction.submissionDate).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${statusBadge(selectedTransaction.status)}`}>
                  {selectedTransaction.status}
                </span>
                <button
                  onClick={() => setSelectedTransaction(null)}
                  className="text-mbzuai-navy/40 hover:text-mbzuai-navy text-lg leading-none"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* editable fields */}
            <div className="px-6 py-5">
              <h3 className="text-sm font-semibold text-mbzuai-navy/60 uppercase tracking-wide mb-3">
                Transaction Details
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Vendor", key: "vendorName" },
                  { label: "Invoice #", key: "invoiceNumber" },
                  { label: "Purchase Date", key: "purchaseDate", type: "date" },
                  { label: "Amount (AED)", key: "amountAed", type: "number" },
                  { label: "Currency", key: "originalCurrency" },
                  { label: "Payment Method", key: "paymentMethod" },
                  { label: "Category", key: "category" },
                  { label: "Purchase For", key: "budgetItemId", type: "budgetItem"},
                  { label: "Department", key: "department" },
                ].map(({ label, key, type = "text" }) => (
                  <div key={key}>
                    <label className="block text-xs text-mbzuai-navy/50 mb-1">{label}</label>
                    {type === "budgetItem" ? (
                      <select 
                      value={editFields[key] || ""}
                      onChange={(e) => 
                        setEditFields((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      disabled={isDeleted}
                      className={inputClass}
                      >
                        <option value="">Select purchase purpose</option>
                        {budgetItems.map((item) => (
                          <option key={item.budgetItemId} value={item.budgetItemId}>
                            {item.itemName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input 
                      type={type}
                      value={editFields[key] ?? ""}
                      onChange={(e) => 
                        setEditFields((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      } 
                      disabled={isDeleted}
                      className={inputClass}
                      />
                    )}
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="block text-xs text-mbzuai-navy/50 mb-1">Notes</label>
                  <textarea
                    value={editFields.notes ?? ""}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, notes: e.target.value }))}
                    disabled={isDeleted}
                    rows={2}
                    className="w-full rounded-lg border border-mbzuai-navy/20 px-3 py-2 text-sm text-mbzuai-navy focus:border-mbzuai-gold focus:outline-none resize-none"
                  />
                </div>
              </div>
            </div>

            {/* flags */}
            <div className="px-6 pb-5">
              <h3 className="text-sm font-semibold text-mbzuai-navy/60 uppercase tracking-wide mb-3">
                Flags
              </h3>
              {modalFlags.length === 0 ? (
                <p className="text-sm text-mbzuai-navy/40">No flags on this transaction.</p>
              ) : (
                <ul className="space-y-2">
                  {modalFlags.map((flag) => (
                    <li
                      key={flag.flagId}
                      className="flex items-center justify-between rounded-lg border border-mbzuai-navy/10 px-4 py-2"
                    >
                      <div>
                        <span className="text-sm font-medium text-mbzuai-navy">
                          {flag.flagType.replace(/_/g, " ")}
                        </span>
                        <span className={`ml-2 text-xs ${flag.resolved ? "text-green-600" : "text-amber-600"}`}>
                          {flag.resolved ? "resolved" : "unresolved"}
                        </span>
                      </div>
                      {!flag.resolved && (
                        <button
                          onClick={() => handleResolveFlag(flag.flagId)}
                          disabled={resolvingFlagId === flag.flagId}
                          className="text-xs text-mbzuai-navy underline hover:text-mbzuai-gold disabled:opacity-50"
                        >
                          {resolvingFlagId === flag.flagId ? "Resolving…" : "Resolve"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-6 pb-4">
              <button
                onClick={handleViewHistory}
                className="text-sm font-medium text-mbzuai-gold hover:underline"
              >
                {showAuditLogs ? "Hide Edit History" : "View Edit History"}
              </button>

              {showAuditLogs && (
                <div className="mt-4 space-y-3 rounded-lg border border-mbzuai-navy/10 p-4 bg-white">
                  {auditLogs.length === 0 ? (
                    <p className="text-sm text-mbzuai-navy/60">
                      No edit history yet.
                    </p>
                  ) : (
                    auditLogs.map((log) => (
                      <div
                        key={log.logId}
                        className="border-b border-mbzuai-navy/10 pb-3 last:border-b-0"
                      >
                        <p className="font-medium text-sm">
                          {log.fieldName}
                        </p>

                        <p className="text-sm text-mbzuai-navy/70">
                          {String(log.oldValue ?? "—")} → {String(log.newValue ?? "—")}
                        </p>

                        <p className="text-xs text-mbzuai-navy/50">
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* footer actions */}
            <div className="px-6 py-4 border-t border-mbzuai-navy/10 flex justify-between items-center">
              <button
                onClick={handleDeleteTransaction}
                disabled={selectedTransaction.status === "deleted"}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                Delete Transaction
              </button>

              <button
                onClick={handleSave}
                disabled={!hasChanges || saving || isDeleted}
                className="px-4 py-2 rounded-lg bg-mbzuai-navy text-white text-sm font-medium hover:bg-mbzuai-navy/80 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleted
                  ? "Transaction Deleted"
                  : saving
                    ? "Saving..."
                    : "Save Changes"}
              </button>
              {selectedTransaction.status !== "reviewed" && !isDeleted &&(
                <button
                  onClick={handleMarkReviewed}
                  disabled={markingReviewed}
                  className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {markingReviewed ? "Marking…" : "Mark as Reviewed"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </ManagerLayout>
  );
}
