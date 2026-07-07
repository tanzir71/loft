import { expect, test } from "@playwright/test";

import { resetE2eDb } from "./test-db";

test.beforeEach(async () => {
  await resetE2eDb();
});

test("tutor builds a module and material with live markdown preview", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("tutor@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible();

  await page.goto("/courses");
  await page.getByLabel("Course title").fill("Algebra I");
  await page.getByLabel("Subject").fill("Math");
  await page.getByLabel("Description").fill("Algebra foundations");
  await page.getByRole("button", { name: /^add course$/i }).click();

  await page.goto("/content");
  await page.getByLabel("Module title").fill("Foundations");
  await page.getByLabel("Module description").fill("Start here");
  await page.getByLabel("Module sort order").fill("0");
  await page.getByRole("button", { name: /^add module$/i }).click();
  await expect(page.getByLabel("Title for Foundations")).toHaveValue("Foundations");

  await page.getByLabel("Material title").fill("Lesson notes");
  await page.getByLabel("Material module").selectOption({ label: "Foundations" });
  await page.getByLabel("Material type").selectOption("lecture");
  await page.getByLabel("Material body", { exact: true }).fill("# Lesson\n<script>alert(1)</script>");
  await expect(page.getByText("Live preview")).toBeVisible();
  await expect(page.getByLabel("Material body preview").getByText("Lesson")).toBeVisible();
  await page.getByRole("button", { name: /^add material$/i }).click();

  await expect(page.getByText("Lesson notes")).toBeVisible();
  await page.getByText("Lesson notes").click();
  await expect(page.getByText("0 completed")).toBeVisible();
  await page.getByRole("button", { name: /^duplicate material Lesson notes$/i }).click();
  await expect(page.getByText("Lesson notes copy")).toBeVisible();
});
