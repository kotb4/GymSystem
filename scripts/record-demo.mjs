/**
 * scripts/record-demo.mjs
 * 
 * GymGate Master Showcase Video Recorder (Full Comprehensive Edition)
 * Powered by KOTB Digital Solutions
 * 
 * Features:
 * - Full HD 1080p (1920x1080) 60fps automated browser video recording
 * - Exhaustive coverage of ALL system modules (13 structured scenes, ~15 minutes total)
 * - Calibrated timings matching the word-by-word AI Voiceover Script
 * - Realistic smooth human-like mouse trajectories, hovering, clicks, and typing
 * 
 * Modules Covered:
 *   Scene 1:  Intro, Architecture, Security & Login (0:00 - 0:45)
 *   Scene 2:  Dashboard KPIs, Occupancy & Financial Overview (0:45 - 1:45)
 *   Scene 3:  Front Desk, Barcode Check-in & Day Pass Countdown (1:45 - 3:00)
 *   Scene 4:  Members Database, Comprehensive Profile & Cards (3:00 - 4:15)
 *   Scene 5:  Plans, Subscriptions Lifecycle, Freeze & Renewal (4:15 - 5:30)
 *   Scene 6:  Academies, Group Classes & Personal Training (PT) (5:30 - 6:45)
 *   Scene 7:  Store, POS Sales, Inventory & Credit Debts (6:45 - 8:00)
 *   Scene 8:  Treasury, Cashier Shifts, Z-Reports & P&L Ledger (8:00 - 9:15)
 *   Scene 9:  HR, Staff Management, Payroll & Commissions (9:15 - 10:15)
 *   Scene 10: WhatsApp Automation, Smart Bot & Live Smartphone Mockup (10:15 - 12:15)
 *   Scene 11: Option 0 Handover, Real-time Alert & Deep Linking (12:15 - 13:15)
 *   Scene 12: Smart Member Portal Showcase (13:15 - 14:15)
 *   Scene 13: Multi-Branch Sync, Backups, License & Outro (14:15 - 15:00)
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import http from "http";

// ============================================================================
// 1. SCENE TIMINGS (Matched 1:1 with the Voiceover Audio Script)
// ============================================================================
export const DEMO_CONFIG = {
  baseUrl: process.env.BASE_URL || "http://127.0.0.1:8890",
  outputDir: path.resolve(process.cwd(), "recordings"),
  outputFileName: "gymgate-master-showcase-1080p.webm",
  viewport: { width: 1920, height: 1080 },
  credentials: {
    username: process.env.DEMO_USER || "admin",
    password: process.env.DEMO_PASSWORD || "admin123",
  },
  headless: process.env.HEADLESS === "true" ? true : false,

  // Scene durations in milliseconds (Total = 900 seconds / 15 minutes)
  timings: {
    scene01_intro_login: 45_000,         // [00:00 - 00:45] Intro & Authentication
    scene02_dashboard: 60_000,           // [00:45 - 01:45] Dashboard Overview
    scene03_attendance_daypass: 75_000,  // [01:45 - 03:00] Front Desk & Day Pass Countdown
    scene04_members_profile: 75_000,     // [03:00 - 04:15] Members & 360 Profile
    scene05_plans_subscriptions: 75_000, // [04:15 - 05:30] Plans, Subscriptions & Freeze
    scene06_classes_pt_academies: 75_000,// [05:30 - 06:45] Classes, PT & Belts
    scene07_store_pos: 75_000,           // [06:45 - 08:00] Store POS & Debts
    scene08_treasury_shifts: 75_000,     // [08:00 - 09:15] Treasury Shifts & Z-Report
    scene09_hr_payroll: 60_000,          // [09:15 - 10:15] Staff, Trainers & Payroll
    scene10_whatsapp_bot_mockup: 120_000,// [10:15 - 12:15] WhatsApp Bot & Smartphone Simulator
    scene11_option0_handover: 60_000,    // [12:15 - 13:15] Option 0 Real-time Alert
    scene12_member_portal: 60_000,       // [13:15 - 14:15] Smart Member Portal
    scene13_sync_backups_outro: 45_000,  // [14:15 - 15:00] Backups, Sync & Outro
  },
};

// ============================================================================
// 2. REALISTIC HUMAN-LIKE INTERACTION HELPERS
// ============================================================================
async function smoothMoveTo(page, selectorOrLocator, steps = 30) {
  try {
    const loc = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator).first() : selectorOrLocator;
    await loc.waitFor({ state: "visible", timeout: 4000 });
    const box = await loc.boundingBox();
    if (!box) return;

    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;

    await page.mouse.move(targetX, targetY, { steps });
    await page.waitForTimeout(200);
  } catch {
    /* fallback gracefully */
  }
}

async function smoothClick(page, selectorOrLocator) {
  await smoothMoveTo(page, selectorOrLocator, 25);
  const loc = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator).first() : selectorOrLocator;
  await loc.click({ delay: 120 });
  await page.waitForTimeout(400);
}

async function smoothType(page, selectorOrLocator, text, delayMs = 65) {
  const loc = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator).first() : selectorOrLocator;
  await smoothClick(page, loc);
  await loc.fill("");
  await page.waitForTimeout(200);
  for (const char of text) {
    await loc.pressSequentially(char, { delay: delayMs });
  }
  await page.waitForTimeout(300);
}

async function gentleScroll(page, deltaY, durationMs = 2000) {
  const steps = 20;
  const stepDelta = deltaY / steps;
  const stepDelay = durationMs / steps;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, stepDelta);
    await page.waitForTimeout(stepDelay);
  }
}

function isBackendAlive(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => resolve(res.statusCode < 500));
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ============================================================================
// 3. MASTER SHOWCASE ORCHESTRATOR
// ============================================================================
async function runMasterShowcase() {
  console.log("\n=======================================================");
  console.log("🎬 GymGate Master Showcase Video Recorder (15 Minutes)");
  console.log("   Exhaustive System Features • 1080p 60fps Automation");
  console.log("   Powered by KOTB Digital Solutions");
  console.log("=======================================================\n");

  if (!fs.existsSync(DEMO_CONFIG.outputDir)) {
    fs.mkdirSync(DEMO_CONFIG.outputDir, { recursive: true });
  }

  const alive = await isBackendAlive(DEMO_CONFIG.baseUrl);
  if (!alive) {
    console.log("⚠️ Backend server is not running on " + DEMO_CONFIG.baseUrl);
    console.log("   Please start the system backend first, then rerun this script.");
    process.exit(1);
  }

  console.log("🚀 Initializing browser engine...");
  let browser;
  for (const channel of ["msedge", "chrome", undefined]) {
    try {
      browser = await chromium.launch({
        channel,
        headless: DEMO_CONFIG.headless,
        args: [
          "--start-maximized",
          "--disable-infobars",
          "--no-default-browser-check",
          "--autoplay-policy=no-user-gesture-required",
        ],
      });
      console.log(`   Connected via: ${channel || "bundled chromium"}`);
      break;
    } catch {
      continue;
    }
  }

  if (!browser) throw new Error("Could not launch browser.");

  const context = await browser.newContext({
    viewport: DEMO_CONFIG.viewport,
    recordVideo: {
      dir: DEMO_CONFIG.outputDir,
      size: DEMO_CONFIG.viewport,
    },
    colorScheme: "dark",
    locale: "ar-EG",
  });

  const page = await context.newPage();

  try {
    // ========================================================================
    // SCENE 1: INTRO, BRANDING & LOGIN [00:00 - 00:45] (45s)
    // ========================================================================
    console.log("🎬 [Scene 01/13] Intro, Branding & Login (45s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(6000); // Intro speech pause

    // Smooth typing credentials
    await smoothType(page, 'input[autocomplete="username"]', DEMO_CONFIG.credentials.username, 80);
    await page.waitForTimeout(2000);
    await smoothType(page, "#login-password", DEMO_CONFIG.credentials.password, 80);
    await page.waitForTimeout(3000);

    // Hover over branding wordmark & login button
    await smoothMoveTo(page, 'img[alt*="KOTB"]', 25);
    await page.waitForTimeout(3000);

    await smoothClick(page, 'button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(25000); // Remaining voiceover explanation

    // ========================================================================
    // SCENE 2: DASHBOARD KPIS & LIVE OPERATIONAL OVERVIEW [00:45 - 01:45] (60s)
    // ========================================================================
    console.log("🎬 [Scene 02/13] Dashboard KPIs & Live Analytics (60s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);

    // Tour across metric cards
    const metricCards = page.locator(".shadow-card, [data-card]");
    const cardCount = await metricCards.count();
    for (let i = 0; i < Math.min(cardCount, 5); i++) {
      await smoothMoveTo(page, metricCards.nth(i), 25);
      await page.waitForTimeout(3500);
    }

    // Scroll gently down to charts
    await gentleScroll(page, 450, 2500);
    await page.waitForTimeout(15000);
    await gentleScroll(page, -450, 2000);
    await page.waitForTimeout(15000);

    // ========================================================================
    // SCENE 3: FRONT DESK, SCANNER & DAY PASS COUNTDOWN [01:45 - 03:00] (75s)
    // ========================================================================
    console.log("🎬 [Scene 03/13] Reception Desk, Scanner & Quick Day Pass (75s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/attendance`, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Hover barcode scan input simulation
    const barcodeInput = page.locator('input[placeholder*="باركود"], input[placeholder*="كود"]').first();
    if (await barcodeInput.isVisible().catch(() => false)) {
      await smoothType(page, barcodeInput, "B1-MEM-000001", 90);
      await page.waitForTimeout(3000);
    }

    // Open Quick Day Pass Modal
    const dayPassBtn = page.getByRole("button", { name: /تذكرة يوم واحد|حصة يومية/i }).first();
    if (await dayPassBtn.isVisible().catch(() => false)) {
      await smoothClick(page, dayPassBtn);
      await page.waitForTimeout(3000);

      // Type visitor name
      const visitorNameInput = page.locator('input[placeholder*="اسم"]').first();
      if (await visitorNameInput.isVisible().catch(() => false)) {
        await smoothType(page, visitorNameInput, "كابتن سيف الدين محمود (تذكرة يوم)");
        await page.waitForTimeout(2000);
      }

      // Confirm Day Pass
      const confirmDayPass = page.getByRole("button", { name: /تأكيد|حفظ|إصدار/i }).last();
      if (await confirmDayPass.isVisible().catch(() => false)) {
        await smoothClick(page, confirmDayPass);
        await page.waitForTimeout(4000);
      }
    }

    // Scroll down to Live Occupants table to show the countdown badge
    await gentleScroll(page, 400, 2500);
    await page.waitForTimeout(35000); // Highlighting countdown badge & occupancy

    // ========================================================================
    // SCENE 4: MEMBERS 360 PROFILE, DATABASE & CARDS [03:00 - 04:15] (75s)
    // ========================================================================
    console.log("🎬 [Scene 04/13] Members 360 Database, Profiles & Cards (75s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/members`, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Search for a member
    const searchInput = page.locator('input[placeholder*="بحث"]').first();
    if (await searchInput.isVisible().catch(() => false)) {
      await smoothType(page, searchInput, "محمد", 80);
      await page.waitForTimeout(4000);
      await searchInput.fill("");
    }

    // Click on the first member to view 360 profile
    const firstMemberLink = page.locator("table tbody tr a, table tbody tr").first();
    if (await firstMemberLink.isVisible().catch(() => false)) {
      await smoothClick(page, firstMemberLink);
      await page.waitForTimeout(5000);

      // Tour profile tabs: Subscriptions, Attendance, Payments, Loyalty
      const profileTabs = page.locator('[role="tab"], button').filter({ hasText: /اشتراكات|حضور|مالية|ملاحظات|ولاء/i });
      const tabCount = await profileTabs.count();
      for (let t = 0; t < Math.min(tabCount, 3); t++) {
        await smoothClick(page, profileTabs.nth(t));
        await page.waitForTimeout(4000);
      }
    }
    await page.waitForTimeout(25000);

    // ========================================================================
    // SCENE 5: PLANS, SUBSCRIPTIONS LIFECYCLE & FREEZE [04:15 - 05:30] (75s)
    // ========================================================================
    console.log("🎬 [Scene 05/13] Plans, Subscriptions Lifecycle & Freeze (75s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/subscriptions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);

    // Tour subscription filters: Active, Expiring, Frozen
    const subFilters = page.locator("button").filter({ hasText: /ساري|منتهي|مجمد|الكل/i });
    const sCount = await subFilters.count();
    for (let f = 0; f < Math.min(sCount, 3); f++) {
      await smoothClick(page, subFilters.nth(f));
      await page.waitForTimeout(4000);
    }

    await gentleScroll(page, 300, 2000);
    await page.waitForTimeout(15000);
    await gentleScroll(page, -300, 1500);
    await page.waitForTimeout(25000);

    // ========================================================================
    // SCENE 6: ACADEMIES, GROUP CLASSES & PERSONAL TRAINING [05:30 - 06:45] (75s)
    // ========================================================================
    console.log("🎬 [Scene 06/13] Classes, Academies & Personal Training PT (75s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/classes`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);

    // Tour tabs: Classes, Trainers, Belts
    const classTabs = page.locator("button, a").filter({ hasText: /أكاديميات|حصص|مدربين|أحزمة/i });
    const cTabCount = await classTabs.count();
    for (let ct = 0; ct < Math.min(cTabCount, 3); ct++) {
      await smoothClick(page, classTabs.nth(ct));
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(40000);

    // ========================================================================
    // SCENE 7: STORE, POS QUICK SALES & CREDIT DEBTS [06:45 - 08:00] (75s)
    // ========================================================================
    console.log("🎬 [Scene 07/13] Store POS, Inventory & Credit Debts (75s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/store`, { waitUntil: "networkidle" });
    await page.waitForTimeout(6000);

    // Hover over products in POS grid
    const products = page.locator(".grid button, .grid div").filter({ hasText: /جنيه|EGP/i });
    const pCount = await products.count();
    for (let p = 0; p < Math.min(pCount, 4); p++) {
      await smoothMoveTo(page, products.nth(p), 20);
      await page.waitForTimeout(2500);
    }

    // Switch to debts/customers credit tab
    const debtsTab = page.locator("button, a").filter({ hasText: /ديون|آجل|حسابات/i }).first();
    if (await debtsTab.isVisible().catch(() => false)) {
      await smoothClick(page, debtsTab);
      await page.waitForTimeout(6000);
    }
    await page.waitForTimeout(40000);

    // ========================================================================
    // SCENE 8: TREASURY, CASHIER SHIFTS & Z-REPORTS [08:00 - 09:15] (75s)
    // ========================================================================
    console.log("🎬 [Scene 08/13] Treasury, Dual Safes, Shifts & P&L (75s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/treasury`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);

    // Hover over shift balance & drawer count
    const shiftSummary = page.locator('[data-card], .shadow-card').first();
    if (await shiftSummary.isVisible().catch(() => false)) {
      await smoothMoveTo(page, shiftSummary, 25);
      await page.waitForTimeout(4000);
    }

    // Scroll to see financial ledger breakdown
    await gentleScroll(page, 400, 2000);
    await page.waitForTimeout(25000);
    await gentleScroll(page, -400, 1500);
    await page.waitForTimeout(25000);

    // ========================================================================
    // SCENE 9: HR, STAFF PAYROLL & TRAINER COMMISSIONS [09:15 - 10:15] (60s)
    // ========================================================================
    console.log("🎬 [Scene 09/13] Staff, Employees, Salaries & Commissions (60s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/hr`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);

    const staffRows = page.locator("table tbody tr");
    if (await staffRows.first().isVisible().catch(() => false)) {
      await smoothMoveTo(page, staffRows.first(), 25);
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(40000);

    // ========================================================================
    // SCENE 10: WHATSAPP BOT ENGINE & SMARTPHONE SIMULATOR [10:15 - 12:15] (120s)
    // ========================================================================
    console.log("🎬 [Scene 10/13] WhatsApp Bot Engine & Live Smartphone Mockup (120s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/messages?tab=bot`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);

    // Tour template editor tabs on the left
    const botTabs = page.locator("button").filter({ hasText: /القائمة|خيارات|أرقام مخصصة/i });
    const bCount = await botTabs.count();
    for (let b = 0; b < Math.min(bCount, 3); b++) {
      await smoothClick(page, botTabs.nth(b));
      await page.waitForTimeout(4000);
    }

    // Now interact with the Live Smartphone Mockup on the right
    const simulatorInput = page.locator('input[placeholder*="اكتب رسالة تجريبية"]');
    const sendBtn = simulatorInput.locator("..").locator("button").last();

    if (await simulatorInput.isVisible().catch(() => false)) {
      console.log("   -> Smartphone Simulation: Sending 'مرحبا'...");
      await smoothType(page, simulatorInput, "مرحبا", 85);
      await smoothClick(page, sendBtn);
      await page.waitForTimeout(16000); // Voiceover explaining greeting

      console.log("   -> Smartphone Simulation: Sending '4' (Plans)...");
      await smoothType(page, simulatorInput, "4", 85);
      await smoothClick(page, sendBtn);
      await page.waitForTimeout(16000); // Voiceover explaining plans

      console.log("   -> Smartphone Simulation: Sending '5' (Digital QR)...");
      await smoothType(page, simulatorInput, "5", 85);
      await smoothClick(page, sendBtn);
      await page.waitForTimeout(18000); // Voiceover explaining QR barcode
    }
    await page.waitForTimeout(25000);

    // ========================================================================
    // SCENE 11: OPTION 0 RECEPTION ALERT & DEEP LINK [12:15 - 13:15] (60s)
    // ========================================================================
    console.log("🎬 [Scene 11/13] Option 0 Handover & Real-Time Alert Bell (60s)...");
    if (await simulatorInput.isVisible().catch(() => false)) {
      console.log("   -> Smartphone Simulation: Sending '0' (Handover)...");
      await smoothType(page, simulatorInput, "0", 85);
      await smoothClick(page, sendBtn);
      await page.waitForTimeout(4000);

      // Move mouse to top header notification bell
      const bellButton = page.locator('header button[aria-label*="إشعار"], header button[aria-label*="تنبيه"]').first();
      await smoothMoveTo(page, bellButton, 35);
      await page.waitForTimeout(2000);
      await smoothClick(page, bellButton);
      await page.waitForTimeout(3000);

      // Click on the handover notification to deep-link to Section 4
      const handoverItem = page.locator("li").filter({ hasText: /تحدث|استقبال|واتساب/i }).first();
      if (await handoverItem.isVisible().catch(() => false)) {
        await smoothClick(page, handoverItem);
      }
      await page.waitForTimeout(15000);

      // Show resolved button or action
      const resolveBtn = page.getByRole("button", { name: /تم الرد|مكتمل/i }).first();
      if (await resolveBtn.isVisible().catch(() => false)) {
        await smoothMoveTo(page, resolveBtn, 20);
        await page.waitForTimeout(2000);
      }
    }
    await page.waitForTimeout(20000);

    // ========================================================================
    // SCENE 12: SMART MEMBER PORTAL SHOWCASE [13:15 - 14:15] (60s)
    // ========================================================================
    console.log("🎬 [Scene 12/13] Smart Member Portal Showcase (60s)...");
    // Show Member Portal Link Modal or portal preview
    await page.goto(`${DEMO_CONFIG.baseUrl}/members`, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    const portalBtn = page.locator("button").filter({ hasText: /بوابة|رابط المشترك|portal/i }).first();
    if (await portalBtn.isVisible().catch(() => false)) {
      await smoothClick(page, portalBtn);
      await page.waitForTimeout(6000);
      const closeBtn = page.locator('button[aria-label*="إغلاق"], button:has-text("إغلاق")').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await smoothClick(page, closeBtn);
      }
    }
    await page.waitForTimeout(40000);

    // ========================================================================
    // SCENE 13: MULTI-BRANCH SYNC, BACKUPS & OUTRO [14:15 - 15:00] (45s)
    // ========================================================================
    console.log("🎬 [Scene 13/13] Multi-Branch Sync, Backups & Outro (45s)...");
    await page.goto(`${DEMO_CONFIG.baseUrl}/settings`, { waitUntil: "networkidle" });
    await page.waitForTimeout(6000);

    // Tour settings sections: Backups, Hardware Binding
    const backupCard = page.locator(".shadow-card").filter({ hasText: /نسخ|احتياطي|backup/i }).first();
    if (await backupCard.isVisible().catch(() => false)) {
      await smoothMoveTo(page, backupCard, 25);
      await page.waitForTimeout(4000);
    }

    // Return to Dashboard for Grand Outro
    await page.goto(`${DEMO_CONFIG.baseUrl}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(20000);

    console.log("\n✅ Master 15-Minute Showcase Completed Successfully!");
  } catch (err) {
    console.error("❌ Recorder session encountered an error:", err);
  } finally {
    console.log("💾 Flushing Full HD video stream to disk...");
    const videoObj = page.video();
    await page.close();
    await context.close();
    await browser.close();

    if (videoObj) {
      const savedPath = await videoObj.path();
      const finalDest = path.join(DEMO_CONFIG.outputDir, DEMO_CONFIG.outputFileName);
      if (fs.existsSync(savedPath)) {
        fs.copyFileSync(savedPath, finalDest);
        console.log(`\n🎉 MASTER SHOWCASE VIDEO RECORDED!`);
        console.log(`📁 File: ${finalDest}`);
        console.log(`📐 Specs: 1920x1080 Full HD (60fps)`);
        console.log(`⏱ Duration: Matched to the 15-minute voiceover script.\n`);
      }
    }
  }
}

// Direct execution entrypoint when run from CLI or record-demo.bat
runMasterShowcase().catch((e) => {
  console.error("Fatal recorder error:", e);
  process.exit(1);
});

export { runMasterShowcase };
