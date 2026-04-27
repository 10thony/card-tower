import { Link } from "react-router-dom";

export function ConvexCheckPage() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL || "Not configured";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-6 py-12">
      <h1 className="text-3xl font-bold">Convex Check</h1>
      <p className="text-slate-600">This confirms the React shell can read Convex configuration.</p>
      <div className="rounded-lg border border-slate-200 bg-white p-4 font-mono text-sm">
        VITE_CONVEX_URL: {convexUrl}
      </div>
      <Link className="text-blue-600 underline" to="/54321">
        Go to modern game
      </Link>
    </main>
  );
}
