import { MOTTO, TAGLINE } from "@/lib/brand";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">N8E Collect</h1>
      <p className="font-mono text-sm text-[var(--text-muted)]">{MOTTO}</p>
      <p className="text-xs text-[var(--text-muted)]">{TAGLINE}</p>
    </main>
  );
}
