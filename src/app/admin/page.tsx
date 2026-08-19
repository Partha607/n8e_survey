import { LogoutButton } from "./logout-button";

export default function AdminHome() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <header className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-4">
        <h1 className="text-xl font-semibold tracking-tight">N8E Collect — Admin</h1>
        <LogoutButton />
      </header>
      <p className="text-sm text-[var(--text-muted)]">
        Signed in. Dashboards arrive in Phase 4.
      </p>
    </main>
  );
}
