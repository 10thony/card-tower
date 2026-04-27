import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">PokeDeck App Shell</h1>
      <p className="text-slate-600">
        React + TypeScript + Convex-powered PokiStack game, prepared for Netlify deployment.
      </p>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-xl font-semibold">Routes</h2>
        <div className="flex flex-wrap gap-3">
          <Link className={cn(buttonVariants())} to="/54321">
            Open React Modernized Game
          </Link>
          <Link className={cn(buttonVariants({ variant: "outline" }))} to="/convex-check">
            Convex Check
          </Link>
        </div>
      </section>
    </main>
  );
}
