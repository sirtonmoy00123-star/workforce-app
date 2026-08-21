"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ProofType = "BEFORE" | "DURING" | "AFTER" | "OTHER";

interface TemplateItem {
  id: string;
  proof_type: ProofType;
  instruction: string | null;
  minimum_photos: number;
  maximum_photos: number;
  is_required: boolean;
  allow_employee_note: boolean;
  allow_finish_without_proof: boolean;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  task_proof_template_items: TemplateItem[];
}

const PROOF_LABELS: Record<string, { label: string; emoji: string }> = {
  BEFORE: { label: "Before Work", emoji: "📷" },
  DURING: { label: "During Work", emoji: "🔄" },
  AFTER: { label: "After Work", emoji: "✅" },
  OTHER: { label: "Other", emoji: "📎" },
};

const ALL_PROOF_TYPES: ProofType[] = ["BEFORE", "DURING", "AFTER", "OTHER"];

export default function TaskProofTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<ProofType>>(new Set(["BEFORE", "AFTER"]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const res = await fetch("/api/task-proof/templates");
      const data = await res.json();
      if (Array.isArray(data)) setTemplates(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  function toggleType(type: ProofType) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function handleCreate() {
    setError("");
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }
    if (selectedTypes.size === 0) {
      setError("Select at least one proof type.");
      return;
    }

    setSaving(true);
    try {
      const items = Array.from(selectedTypes).map((type) => ({
        proof_type: type,
        instruction: "",
        minimum_photos: 1,
        maximum_photos: 6,
        is_required: true,
        allow_employee_note: true,
        allow_finish_without_proof: true,
      }));

      const res = await fetch("/api/task-proof/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, items }),
      });

      if (res.ok) {
        setSuccess("Template created!");
        setShowCreate(false);
        setName("");
        setDescription("");
        setSelectedTypes(new Set(["BEFORE", "AFTER"]));
        await loadTemplates();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create template.");
      }
    } catch {
      setError("Something went wrong.");
    }
    setSaving(false);
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">📷 Proof Templates</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          {showCreate ? "Cancel" : "+ New"}
        </button>
      </div>

      {success && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          ✓ {success}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4 space-y-4">
          <h2 className="font-semibold text-gray-900">New Template</h2>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cleaning Proof"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional description"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Proof Types</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_PROOF_TYPES.map((type) => {
                const pt = PROOF_LABELS[type];
                return (
                  <label
                    key={type}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-sm transition-colors ${
                      selectedTypes.has(type)
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTypes.has(type)}
                      onChange={() => toggleType(type)}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span>{pt.emoji} {pt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={saving}
            className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Creating…" : "Create Template"}
          </button>
        </div>
      )}

      {/* Template list */}
      {templates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <div className="text-3xl mb-2">📷</div>
          <p className="text-gray-500 text-sm mb-2">No proof templates yet.</p>
          <p className="text-gray-400 text-xs">Templates let you quickly add proof requirements to shifts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-gray-900">{tpl.name}</h3>
                <span className="text-xs text-gray-400">
                  {tpl.task_proof_template_items.length} type{tpl.task_proof_template_items.length !== 1 ? "s" : ""}
                </span>
              </div>
              {tpl.description && (
                <p className="text-xs text-gray-500 mb-2">{tpl.description}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {tpl.task_proof_template_items.map((item) => {
                  const pt = PROOF_LABELS[item.proof_type] || { label: item.proof_type, emoji: "📎" };
                  return (
                    <span
                      key={item.id}
                      className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full"
                    >
                      {pt.emoji} {pt.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Link
        href="/admin/roster"
        className="block text-center text-sm text-blue-600 hover:underline mt-6"
      >
        ← Back to Roster
      </Link>
    </div>
  );
}
