"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/core/v1/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }
  return (
    <button
      onClick={logout}
      className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
    >
      Log out
    </button>
  );
}
