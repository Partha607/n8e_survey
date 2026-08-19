import { expect, test } from "@playwright/test";

test("home page serves and carries the brand motto", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "N8E Collect" })).toBeVisible();
  await expect(page.getByText("IN DATA VERITAS")).toBeVisible();
});
