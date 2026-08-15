// Reusable status badge component used across the app.
const colors: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-gray-100 text-gray-600",
  disabled: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  accepted: "bg-blue-100 text-blue-700",
  declined: "bg-red-100 text-red-700",
  working: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-500",
  updated_pending: "bg-amber-100 text-amber-700",
  submitted: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  needs_correction: "bg-orange-100 text-orange-700",
  unpaid: "bg-red-100 text-red-700",
  paid: "bg-green-100 text-green-700",
  estimated: "bg-yellow-100 text-yellow-700",
};

export default function StatusBadge({ status }: { status: string }) {
  const colorClass = colors[status] || "bg-gray-100 text-gray-600";
  const label = status.replace(/_/g, " ");

  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${colorClass}`}
    >
      {label}
    </span>
  );
}
