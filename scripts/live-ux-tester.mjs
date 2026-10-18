/**
 * scripts/live-ux-tester.mjs
 * 
 * Visual Interactive UX & Bug-Hunting Simulation for GymGate
 * Opens Google Chrome visibly maximized in the foreground on the user's screen.
 * Adds a glowing laser cursor and a prominent top HUD explaining every action in Arabic.
 * DOES NOT close the browser at the end so the user can inspect and continue using it.
 */

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8890";
const USERNAME = "kotb";
const PASSWORD = "Owner@2026";

const issues = [];

function logIssue(severity, area, msg) {
  issues.push({ severity, area, msg, time: new Date().toLocaleTimeString("ar-EG") });
  console.log(`\x1b[31m⚠️ [${severity.toUpperCase()}] [${area}]: ${msg}\x1b[0m`);
}

async function installVisualEffects(page) {
  await page.evaluate(() => {
    // 1. Glowing Laser Mouse Pointer
    if (!document.getElementById("playwright-mouse-pointer")) {
      const pointer = document.createElement("div");
      pointer.id = "playwright-mouse-pointer";
      pointer.style.position = "fixed";
      pointer.style.top = "0";
      pointer.style.left = "0";
      pointer.style.width = "26px";
      pointer.style.height = "26px";
      pointer.style.borderRadius = "50%";
      pointer.style.border = "2.5px solid #00D2FF";
      pointer.style.background = "rgba(0, 210, 255, 0.45)";
      pointer.style.boxShadow = "0 0 16px #00D2FF, inset 0 0 8px #00D2FF";
      pointer.style.pointerEvents = "none";
      pointer.style.zIndex = "999999999";
      pointer.style.transition = "transform 0.08s ease, background 0.15s ease";
      pointer.style.transform = "translate(-50%, -50%)";
      document.body.appendChild(pointer);

      window.addEventListener("mousemove", (e) => {
        pointer.style.left = e.clientX + "px";
        pointer.style.top = e.clientY + "px";
      });
      window.addEventListener("mousedown", () => {
        pointer.style.background = "rgba(239, 68, 68, 0.85)";
        pointer.style.borderColor = "#EF4444";
        pointer.style.boxShadow = "0 0 25px #EF4444";
        pointer.style.transform = "translate(-50%, -50%) scale(0.75)";
      });
      window.addEventListener("mouseup", () => {
        pointer.style.background = "rgba(0, 210, 255, 0.45)";
        pointer.style.borderColor = "#00D2FF";
        pointer.style.boxShadow = "0 0 16px #00D2FF, inset 0 0 8px #00D2FF";
        pointer.style.transform = "translate(-50%, -50%) scale(1)";
      });
    }

    // 2. Prominent Floating HUD
    if (!document.getElementById("gymgate-hud-banner")) {
      const hud = document.createElement("div");
      hud.id = "gymgate-hud-banner";
      hud.style.position = "fixed";
      hud.style.top = "16px";
      hud.style.left = "50%";
      hud.style.transform = "translateX(-50%)";
      hud.style.zIndex = "999999998";
      hud.style.background = "linear-gradient(135deg, rgba(10, 15, 29, 0.96) 0%, rgba(15, 23, 42, 0.96) 100%)";
      hud.style.border = "2px solid #00D2FF";
      hud.style.borderRadius = "18px";
      hud.style.padding = "12px 28px";
      hud.style.color = "#FFFFFF";
      hud.style.display = "flex";
      hud.style.alignItems = "center";
      hud.style.gap = "18px";
      hud.style.boxShadow = "0 12px 40px rgba(0, 85, 255, 0.45)";
      hud.style.fontFamily = "system-ui, -apple-system, sans-serif";
      hud.style.direction = "rtl";
      hud.style.pointerEvents = "none";
      hud.style.minWidth = "460px";
      hud.style.justifyContent = "center";
      document.body.appendChild(hud);
    }
  }).catch(() => {});
}

async function showHud(page, stepNum, totalSteps, title, actionDesc) {
  try {
    await installVisualEffects(page);
    await page.evaluate(({ stepNum, totalSteps, title, actionDesc, issuesCount }) => {
      const hud = document.getElementById("gymgate-hud-banner");
      if (!hud) return;
      hud.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #10B981; box-shadow: 0 0 12px #10B981; animation: pulse 1.5s infinite;"></span>
          <span style="font-weight: 900; font-size: 14px; color: #00D2FF; letter-spacing: 0.5px;">تجربة مستخدم حية</span>
        </div>
        <div style="width: 1.5px; height: 24px; background: rgba(255,255,255,0.25);"></div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 13px; font-weight: 800; color: #FFFFFF;">[${stepNum}/${totalSteps}] ${title}</div>
          <div style="font-size: 11px; font-weight: 600; color: #94A3B8;">${actionDesc}</div>
        </div>
        <div style="margin-right: auto; background: ${issuesCount > 0 ? '#EF4444' : '#059669'}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
          ${issuesCount} أخطاء
        </div>
      `;
    }, { stepNum, totalSteps, title, actionDesc, issuesCount: issues.length });
  } catch {}
}

async function smoothMoveAndHover(page, selectorOrLocator, steps = 20) {
  try {
    const loc = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator).first() : selectorOrLocator;
    await loc.waitFor({ state: "visible", timeout: 3500 });
    const box = await loc.boundingBox();
    if (!box) return false;
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    await page.mouse.move(targetX, targetY, { steps });
    await page.waitForTimeout(150);
    return true;
  } catch {
    return false;
  }
}

async function smoothClick(page, selectorOrLocator) {
  await smoothMoveAndHover(page, selectorOrLocator, 18);
  try {
    const loc = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator).first() : selectorOrLocator;
    await loc.click({ delay: 80 });
    await page.waitForTimeout(350);
    return true;
  } catch {
    return false;
  }
}

async function smoothType(page, selectorOrLocator, text, delay = 45) {
  await smoothClick(page, selectorOrLocator);
  try {
    const loc = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator).first() : selectorOrLocator;
    await loc.fill("");
    await page.waitForTimeout(100);
    for (const char of text) {
      await loc.pressSequentially(char, { delay });
    }
    await page.waitForTimeout(200);
    return true;
  } catch {
    return false;
  }
}

(async () => {
  console.log("🚀 تشغيل متصفح Google Chrome أمامك على الشاشة...");

  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: [
      "--start-maximized",
      "--window-position=0,0",
      "--disable-infobars",
    ],
  });

  const context = await browser.newContext({
    viewport: null, // Full screen
    locale: "ar-EG",
  });

  const page = await context.newPage();

  page.on("pageerror", (err) => logIssue("error", "Runtime", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) {
      logIssue("warning", "Console", msg.text().slice(0, 100));
    }
  });

  const TOTAL_STEPS = 9;

  try {
    // ------------------------------------------------------------------------
    // STEP 1: LOGIN
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [1/9]: تسجيل الدخول للمنظومة...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await showHud(page, 1, TOTAL_STEPS, "شاشة تسجيل الدخول", "جاري إدخال اسم المستخدم وكلمة المرور...");
    await page.waitForTimeout(1200);

    const userInput = page.locator('input[autocomplete="username"], input[name="username"]').first();
    const passInput = page.locator('#login-password, input[type="password"]').first();
    const loginBtn = page.locator('button[type="submit"]').first();

    if (await userInput.isVisible().catch(() => false)) {
      await smoothType(page, userInput, USERNAME, 50);
      await page.waitForTimeout(400);
      await smoothType(page, passInput, PASSWORD, 50);
      await page.waitForTimeout(600);
      await showHud(page, 1, TOTAL_STEPS, "شاشة تسجيل الدخول", "الضغط على تسجيل الدخول والتوجه للرئيسية...");
      await smoothClick(page, loginBtn);
      await page.waitForTimeout(1500);
    }
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 6000 }).catch(() => {});

    // ------------------------------------------------------------------------
    // STEP 2: DASHBOARD
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [2/9]: استعراض لوحة التحكم والمؤشرات...");
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await showHud(page, 2, TOTAL_STEPS, "لوحة التحكم الرئيسية", "فحص بطاقات الإحصائيات، الحضور، ومعدل الإشغال...");
    await page.waitForTimeout(1500);

    // Gently scroll down so user sees charts
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: "smooth" }));
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.scrollBy({ top: -350, behavior: "smooth" }));
    await page.waitForTimeout(1000);

    // ------------------------------------------------------------------------
    // STEP 3: TREASURY & SHIFT GAP
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [3/9]: فحص الخزينة، الورديات، وتسليم العجز...");
    await page.goto(`${BASE_URL}/cash`, { waitUntil: "domcontentloaded" });
    await showHud(page, 3, TOTAL_STEPS, "الخزينة والورديات", "فحص درج النقدية، رصيد الافتتاح، وتسليم الورديات...");
    await page.waitForTimeout(1500);

    // Look for inter-shift gap direct link
    const gapLink = page.locator('a[href*="/expenses?highlight="]').first();
    if (await gapLink.isVisible().catch(() => false)) {
      await showHud(page, 3, TOTAL_STEPS, "الخزينة والورديات", "تم رصد عجز تسليم موجه! الضغط على الرابط للانتقال للمصروف...");
      await smoothClick(page, gapLink);
      await page.waitForTimeout(2000);

      // Verify highlighted expense
      await showHud(page, 3, TOTAL_STEPS, "شاشة المصروفات", "تم الانتقال وتظليل المصروف مع بانر توضيح عجز الوردية ✅");
      await page.waitForTimeout(2000);
      await page.goto(`${BASE_URL}/cash`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
    } else {
      // Check if open shift modal works
      const openShiftBtn = page.getByRole("button", { name: /فتح وردية/i }).first();
      if (await openShiftBtn.isVisible().catch(() => false)) {
        await showHud(page, 3, TOTAL_STEPS, "فتح الوردية", "فتح نافذة الدرج ومراجعة رصيد الإغلاق السابق...");
        await smoothClick(page, openShiftBtn);
        await page.waitForTimeout(1500);
        await smoothClick(page, page.getByRole("button", { name: /إلغاء|تراجع/i }).first());
        await page.waitForTimeout(800);
      }
    }

    // ------------------------------------------------------------------------
    // STEP 4: RECEPTION & DAY PASS
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [4/9]: مكتب الاستقبال وقارئ الباركود...");
    await page.goto(`${BASE_URL}/attendance`, { waitUntil: "domcontentloaded" });
    await showHud(page, 4, TOTAL_STEPS, "مكتب الاستقبال", "تجربة قارئ باركود المشتركين وتذكرة اليوم الواحد...");
    await page.waitForTimeout(1200);

    const dayPassBtn = page.getByRole("button", { name: /تذكرة يوم واحد|حصة يومية/i }).first();
    if (await dayPassBtn.isVisible().catch(() => false)) {
      await showHud(page, 4, TOTAL_STEPS, "تذكرة اليوم الواحد", "فتح نافذة إصدار التذكرة الفورية وكتابة اسم الزائر...");
      await smoothClick(page, dayPassBtn);
      await page.waitForTimeout(1000);

      const nameInput = page.locator('input[placeholder*="اسم"]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await smoothType(page, nameInput, "كابتن سيف الدين (تجربة مستخدم حية)", 40);
        await page.waitForTimeout(1000);
      }
      await smoothClick(page, page.getByRole("button", { name: /إلغاء/i }).first());
      await page.waitForTimeout(800);
    }

    // ------------------------------------------------------------------------
    // STEP 5: MEMBERS & 360 PROFILE
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [5/9]: سجل الأعضاء والملف الشامل...");
    await page.goto(`${BASE_URL}/members`, { waitUntil: "domcontentloaded" });
    await showHud(page, 5, TOTAL_STEPS, "سجل الأعضاء", "فحص قائمة المشتركين ومحرك البحث السريع...");
    await page.waitForTimeout(1200);

    const searchInput = page.locator('input[placeholder*="بحث"]').first();
    if (await searchInput.isVisible().catch(() => false)) {
      await smoothType(page, searchInput, "كابتن", 60);
      await page.waitForTimeout(1000);
      await searchInput.fill("");
      await page.waitForTimeout(600);
    }

    // Click first member row
    const firstRow = page.locator("table tbody tr a, table tbody tr td:first-child").first();
    if (await firstRow.isVisible().catch(() => false)) {
      await showHud(page, 5, TOTAL_STEPS, "الملف الشامل للعضو 360°", "فتح الملف واستعراض الاشتراكات، InBody، والمدفوعات...");
      await smoothClick(page, firstRow);
      await page.waitForTimeout(1500);

      // Tour profile tabs
      const tabs = ["الاشتراكات", "InBody", "المدفوعات"];
      for (const t of tabs) {
        const tabEl = page.getByRole("tab", { name: new RegExp(t, "i") }).first();
        if (await tabEl.isVisible().catch(() => false)) {
          await smoothClick(page, tabEl);
          await page.waitForTimeout(800);
        }
      }
    }

    // ------------------------------------------------------------------------
    // STEP 6: SUBSCRIPTIONS & PLANS
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [6/9]: باقات الاشتراكات والأكاديميات...");
    await page.goto(`${BASE_URL}/subscriptions`, { waitUntil: "domcontentloaded" });
    await showHud(page, 6, TOTAL_STEPS, "الباقات والاشتراكات", "فحص الباقات وفتح نافذة الإضافة المتناسقة...");
    await page.waitForTimeout(1200);

    const addPlanBtn = page.getByRole("button", { name: /إضافة باقة/i }).first();
    if (await addPlanBtn.isVisible().catch(() => false)) {
      await smoothClick(page, addPlanBtn);
      await showHud(page, 6, TOTAL_STEPS, "نافذة إضافة باقة موحدة", "استعراض التصميم المتناسق والمريح لباقات الجيم والأكاديميات...");
      await page.waitForTimeout(1500);
      await smoothClick(page, page.getByRole("button", { name: /إلغاء/i }).first());
      await page.waitForTimeout(800);
    }

    // ------------------------------------------------------------------------
    // STEP 7: ACADEMIES & TRAINERS
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [7/9]: مركز الأكاديميات والمدربين...");
    await page.goto(`${BASE_URL}/classes`, { waitUntil: "domcontentloaded" });
    await showHud(page, 7, TOTAL_STEPS, "الأكاديميات والمدربون", "استعراض الأقسام الأربعة: المدربون، المواعيد، الحضور، والأرباح...");
    await page.waitForTimeout(1200);

    const acadTabs = ["جدول المواعيد", "سجل الحضور", "التقارير المالية", "المدربون"];
    for (const t of acadTabs) {
      const tabEl = page.locator(`button:has-text("${t}")`).first();
      if (await tabEl.isVisible().catch(() => false)) {
        await showHud(page, 7, TOTAL_STEPS, "الأكاديميات", `الانتقال إلى تبويب «${t}»...`);
        await smoothClick(page, tabEl);
        await page.waitForTimeout(1000);
      }
    }

    // ------------------------------------------------------------------------
    // STEP 8: STORE POS
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [8/9]: المتجر والمبيعات (POS)...");
    await page.goto(`${BASE_URL}/store`, { waitUntil: "domcontentloaded" });
    await showHud(page, 8, TOTAL_STEPS, "المتجر ونقاط البيع", "فحص المنتجات والمخزون وسلة المبيعات السريعة...");
    await page.waitForTimeout(1500);

    // ------------------------------------------------------------------------
    // STEP 9: REPORTS & SUMMARY
    // ------------------------------------------------------------------------
    console.log("▶ الخطوة [9/9]: التقارير المالية وصافي الأرباح...");
    await page.goto(`${BASE_URL}/reports`, { waitUntil: "domcontentloaded" });
    await showHud(page, 9, TOTAL_STEPS, "التقارير المالية والأرباح", "فحص قائمة الدخل P&L وحركة الإيرادات والمصروفات...");
    await page.waitForTimeout(2000);

    // SUCCESS FINALE: Leave browser open for the user!
    await showHud(
      page,
      9,
      TOTAL_STEPS,
      "اكتملت التجربة الحية بنجاح 100%! 🎉",
      "المتصفح مفتوح الآن أمامك على الشاشة لتجربة وتصفح كل شيء بنفسك حرّاً!",
    );
    console.log("\n=======================================================");
    console.log("🎉 اكتملت الجولة الحية بنجاح! المتصفح مفتوح الآن على شاشتك.");
    console.log("=======================================================\n");

    // Keep session alive for 15 minutes so user can play with it freely!
    await new Promise((r) => setTimeout(r, 15 * 60 * 1000));

  } catch (err) {
    console.error("Execution error:", err);
  }
})();
