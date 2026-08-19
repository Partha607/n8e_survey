import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { generateSync } from "otplib";
import { Client } from "pg";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://n8e:n8e_dev_password@localhost:5432/n8e_collect";
const EMAIL = "admin@n8elabs.com";
const PASSWORD = "e2e-test-password";

async function resetAdmin() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  await client.query(
    `INSERT INTO admin_users (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = $2, totp_secret = NULL, totp_enabled = false`,
    [EMAIL, hash],
  );
  await client.query(
    `DELETE FROM audit_log WHERE subject_id = $1 AND action LIKE 'auth.%'`,
    [EMAIL],
  );
  await client.end();
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await resetAdmin();
});

test("full 2FA login: password → enrol → TOTP → admin", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();

  // first login → enrolment step with QR + manual secret
  await expect(page.getByAltText("TOTP enrolment QR code")).toBeVisible();
  const secretLine = await page.getByText("Manual secret:").textContent();
  const secret = secretLine!.replace("Manual secret:", "").trim();

  await page.getByLabel("Authenticator code").fill(generateSync({ secret }));
  await page.getByRole("button", { name: "Enable 2FA and sign in" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "N8E Collect — Admin" })).toBeVisible();

  // logout invalidates the session (FR-AUTH-03)
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("wrong TOTP code is rejected", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByAltText("TOTP enrolment QR code")).toBeVisible();
  await page.getByLabel("Authenticator code").fill("000000");
  await page.getByRole("button", { name: "Enable 2FA and sign in" }).click();

  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Invalid authenticator code",
  );
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("5 bad passwords lock the login for 15 minutes", async ({ page }) => {
  await page.goto("/admin/login");
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(`wrong-${i}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Invalid email or password",
    );
  }
  // 6th attempt — even with the CORRECT password — is locked
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Too many failed attempts",
  );
});
