/**
 * scripts/capture-visual-tour.mjs
 * 
 * Captures Full HD screenshots of the complete system operational tour
 * and saves them directly to the artifact directory for the user to see!
 */

import { chromium } from "playwright";
import path from "path";

const BASE_URL = "http://127.0.0.1:8890";
const ARTIFACT_DIR = "C:/Users/KOTB/.gemini/antigravity/brain/24544496-ce86-4841-8fcf-092d64789551";

(async () => {
  console.log("📸 Starting visual screenshot tour capture...");

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    locale: "ar-EG",
  });

  // 1. Login Page
  console.log("1. Capturing Login Page...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-01-login.png") });

  // Do Login
  await page.fill('input[autocomplete="username"]', "kotb");
  await page.fill('#login-password', "Owner@2026");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // 2. Dashboard
  console.log("2. Capturing Dashboard...");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-02-dashboard.png") });

  // 3. Treasury & Shifts
  console.log("3. Capturing Treasury & Shifts...");
  await page.goto(`${BASE_URL}/cash`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-03-treasury-shifts.png") });

  // 4. Open Shift Modal (checking deficit alert)
  console.log("4. Capturing Open Shift Modal...");
  const openShiftBtn = page.getByRole("button", { name: /فتح وردية/i }).first();
  if (await openShiftBtn.isVisible().catch(() => false)) {
    await openShiftBtn.click();
    await page.waitForTimeout(600);
    const amountInput = page.locator('input[type="number"], input[placeholder*="المبلغ"]').first();
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill("450");
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-04-open-shift-deficit.png") });
    await page.getByRole("button", { name: /إلغاء/i }).first().click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // 5. Reception Desk & Check-in
  console.log("5. Capturing Reception & Attendance...");
  await page.goto(`${BASE_URL}/attendance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-05-reception-attendance.png") });

  // 6. Members
  console.log("6. Capturing Members List...");
  await page.goto(`${BASE_URL}/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-06-members-list.png") });

  // 7. Member Profile 360
  console.log("7. Capturing Member Profile 360...");
  const firstMember = page.locator("table tbody tr a, table tbody tr td:first-child").first();
  if (await firstMember.isVisible().catch(() => false)) {
    await firstMember.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-07-member-profile.png") });
  }

  // 8. Plans & Subscriptions
  console.log("8. Capturing Subscriptions & Plans...");
  await page.goto(`${BASE_URL}/subscriptions`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const addPlanBtn = page.getByRole("button", { name: /إضافة باقة/i }).first();
  if (await addPlanBtn.isVisible().catch(() => false)) {
    await addPlanBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-08-plan-form-modal.png") });
    await page.getByRole("button", { name: /إلغاء/i }).first().click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // 9. Academies & Trainers
  console.log("9. Capturing Academies & Trainers...");
  await page.goto(`${BASE_URL}/classes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-09-academies-trainers.png") });

  // 10. Store & POS
  console.log("10. Capturing Store & POS...");
  await page.goto(`${BASE_URL}/store`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-10-store-pos.png") });

  // 11. Expenses & Deficit Link
  console.log("11. Capturing Expenses...");
  await page.goto(`${BASE_URL}/expenses`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-11-expenses.png") });

  // 12. Reports (P&L)
  console.log("12. Capturing Financial Reports...");
  await page.goto(`${BASE_URL}/reports`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "tour-12-reports-pl.png") });

  await browser.close();
  console.log("✅ All tour screenshots captured successfully!");
})();
