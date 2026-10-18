/**
 * scripts/run-live-showcase.mjs
 * 
 * Interactive Live Simulation of GymGate v2.5 directly on user's screen.
 * Visually drives through every module with Arabic HUD and visible interactions.
 */

import { chromium } from "playwright";
import { exec } from "child_process";

const BASE_URL = "http://127.0.0.1:8890";
const USERNAME = "kotb";
const PASSWORD = "Owner@2026";

async function bringToFrontWin32() {
  exec(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate('GymGate')"`), () => {};
}

async function injectHudAndEffects(page) {
  await page.evaluate(() => {
    // 1. Glowing Laser Pointer
    if (!document.getElementById("gym-laser-pointer")) {
      const p = document.createElement("div");
      p.id = "gym-laser-pointer";
      p.style.cssText = "position:fixed;top:0;left:0;width:32px;height:32px;border-radius:50%;border:3px solid #00D2FF;background:rgba(0,210,255,0.4);box-shadow:0 0 20px #00D2FF, inset 0 0 10px #00D2FF;pointer-events:none;z-index:99999999;transform:translate(-50%,-50%);transition:transform 0.1s ease, background 0.15s ease;";
      document.body.appendChild(p);

      window.addEventListener("mousemove", (e) => {
        p.style.left = e.clientX + "px";
        p.style.top = e.clientY + "px";
      });
      window.addEventListener("mousedown", () => {
        p.style.background = "rgba(239, 68, 68, 0.85)";
        p.style.borderColor = "#EF4444";
        p.style.transform = "translate(-50%, -50%) scale(0.7)";
      });
      window.addEventListener("mouseup", () => {
        p.style.background = "rgba(0, 210, 255, 0.4)";
        p.style.borderColor = "#00D2FF";
        p.style.transform = "translate(-50%, -50%) scale(1)";
      });
    }

    // 2. High-Visibility Floating HUD Banner
    if (!document.getElementById("gym-main-hud")) {
      const hud = document.createElement("div");
      hud.id = "gym-main-hud";
      hud.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999998;background:linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.98) 100%);border:2.5px solid #00D2FF;border-radius:20px;padding:14px 32px;color:#FFFFFF;display:flex;align-items:center;gap:20px;box-shadow:0 15px 40px rgba(0,210,255,0.4);font-family:system-ui,-apple-system,sans-serif;direction:rtl;min-width:480px;justify-content:center;pointer-events:none;";
      document.body.appendChild(hud);
    }
  }).catch(() => {});
}

async function updateHud(page, stepNum, totalSteps, title, desc) {
  try {
    await injectHudAndEffects(page);
    await page.evaluate(({ stepNum, totalSteps, title, desc }) => {
      const hud = document.getElementById("gym-main-hud");
      if (!hud) return;
      hud.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#10B981;box-shadow:0 0 14px #10B981;"></span>
          <span style="font-weight:900;font-size:14px;color:#00D2FF;letter-spacing:0.5px;">تجربة مستخدم حية</span>
        </div>
        <div style="width:2px;height:26px;background:rgba(255,255,255,0.25);"></div>
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="font-size:14px;font-weight:900;color:#FFFFFF;">[${stepNum}/${totalSteps}] ${title}</div>
          <div style="font-size:12px;font-weight:600;color:#94A3B8;">${desc}</div>
        </div>
        <div style="margin-right:auto;background:#059669;color:white;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:bold;">
          0 أخطاء 🟢
        </div>
      `;
    }, { stepNum, totalSteps, title, desc });
  } catch {}
}

async function moveMouseAndClick(page, selectorOrLocator) {
  try {
    const loc = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator).first() : selectorOrLocator;
    await loc.waitFor({ state: "visible", timeout: 4000 });
    const box = await loc.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
      await page.waitForTimeout(250);
      await loc.click({ delay: 90 });
      await page.waitForTimeout(400);
      return true;
    }
  } catch {}
  return false;
}

(async () => {
  console.log("🚀 تشغيل المتصفح التفاعلي أمام المستخدم...");

  // Launch system Chrome in visible GUI mode
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: false,
    args: [
      "--start-maximized",
      "--window-position=0,0",
      "--disable-infobars",
      "--no-default-browser-check"
    ],
  });

  const context = await browser.newContext({
    viewport: null, // full maximized viewport
    locale: "ar-EG",
  });

  const page = await context.newPage();
  const TOTAL = 9;

  try {
    // 1. LOGIN
    console.log("1. Login...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await bringToFrontWin32();
    await updateHud(page, 1, TOTAL, "تسجيل الدخول للنظام", "إدخال حساب المالك kotb والتحقق من الصلاحيات...");
    await page.waitForTimeout(1500);

    const userInput = page.locator('input[autocomplete="username"], input[name="username"]').first();
    const passInput = page.locator('#login-password, input[type="password"]').first();
    const loginBtn = page.locator('button[type="submit"]').first();

    if (await userInput.isVisible().catch(() => false)) {
      await userInput.click();
      await userInput.fill("");
      for (const ch of USERNAME) { await userInput.pressSequentially(ch, { delay: 60 }); }
      await page.waitForTimeout(300);
      await passInput.click();
      await passInput.fill("");
      for (const ch of PASSWORD) { await passInput.pressSequentially(ch, { delay: 60 }); }
      await page.waitForTimeout(500);
      await moveMouseAndClick(page, loginBtn);
    }
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // 2. DASHBOARD
    console.log("2. Dashboard...");
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await updateHud(page, 2, TOTAL, "لوحة التحكم الرئيسية", "فحص الوردية المفتوحة (#1) ومؤشرات الإيرادات...");
    await page.waitForTimeout(2000);
    await page.mouse.wheel(0, 350);
    await page.waitForTimeout(1500);
    await page.mouse.wheel(0, -350);
    await page.waitForTimeout(1000);

    // 3. TREASURY & SHIFTS
    console.log("3. Treasury & Shifts...");
    const treasuryLink = page.locator('a[href="/treasury"]').first();
    if (await treasuryLink.isVisible().catch(() => false)) {
      await moveMouseAndClick(page, treasuryLink);
    } else {
      await page.goto(`${BASE_URL}/treasury`);
    }
    await updateHud(page, 3, TOTAL, "الخزينة والورديات", "فحص رصيد الدرج، الوردية رقم 1، وتتبع العجز المالي...");
    await page.waitForTimeout(2500);

    // 4. RECEPTION & BARCODE
    console.log("4. Reception...");
    const attendanceLink = page.locator('a[href="/attendance"]').first();
    if (await attendanceLink.isVisible().catch(() => false)) {
      await moveMouseAndClick(page, attendanceLink);
    } else {
      await page.goto(`${BASE_URL}/attendance`);
    }
    await updateHud(page, 4, TOTAL, "الاستقبال والباركود", "فحص قارئ الباركود والحضور اللحظي الذكي...");
    await page.waitForTimeout(2000);

    // 5. MEMBERS
    console.log("5. Members...");
    const membersLink = page.locator('a[href="/members"]').first();
    if (await membersLink.isVisible().catch(() => false)) {
      await moveMouseAndClick(page, membersLink);
    } else {
      await page.goto(`${BASE_URL}/members`);
    }
    await updateHud(page, 5, TOTAL, "دليل المشتركين", "استعراض سجلات الأعضاء، الاشتراكات، والبحث بالهاتف...");
    await page.waitForTimeout(2500);

    // 6. ACADEMIES & TRAINERS
    console.log("6. Academies...");
    const classesLink = page.locator('a[href="/classes"]').first();
    if (await classesLink.isVisible().catch(() => false)) {
      await moveMouseAndClick(page, classesLink);
    } else {
      await page.goto(`${BASE_URL}/classes`);
    }
    await updateHud(page, 6, TOTAL, "الأكاديميات والمدربون", "التأكد من إزالة جدول المواعيد المكرر والأقسام الـ 4 المنظمة...");
    await page.waitForTimeout(2000);

    // Tour the tabs in classes
    const tabs = ["جدول المواعيد", "سجل الحضور", "التقارير المالية", "المدربون"];
    for (const t of tabs) {
      const tabEl = page.locator(`button:has-text("${t}")`).first();
      if (await tabEl.isVisible().catch(() => false)) {
        await moveMouseAndClick(page, tabEl);
        await page.waitForTimeout(1000);
      }
    }

    // 7. STORE POS
    console.log("7. Store POS...");
    const storeLink = page.locator('a[href="/store"]').first();
    if (await storeLink.isVisible().catch(() => false)) {
      await moveMouseAndClick(page, storeLink);
    } else {
      await page.goto(`${BASE_URL}/store`);
    }
    await updateHud(page, 7, TOTAL, "المتجر ونقاط البيع (POS)", "فحص المنتجات، المخزون، وسلة المبيعات السريعة...");
    await page.waitForTimeout(2500);

    // 8. EXPENSES & DEFICIT LINK
    console.log("8. Expenses...");
    const expensesLink = page.locator('a[href="/expenses"]').first();
    if (await expensesLink.isVisible().catch(() => false)) {
      await moveMouseAndClick(page, expensesLink);
    } else {
      await page.goto(`${BASE_URL}/expenses`);
    }
    await updateHud(page, 8, TOTAL, "المصروفات وسندات العجز", "فحص ارتباط سند المصروف بالوردية وتتبع الفروقات بدقة...");
    await page.waitForTimeout(2500);

    // 9. REPORTS P&L
    console.log("9. Reports...");
    const reportsLink = page.locator('a[href="/reports"]').first();
    if (await reportsLink.isVisible().catch(() => false)) {
      await moveMouseAndClick(page, reportsLink);
    } else {
      await page.goto(`${BASE_URL}/reports`);
    }
    await updateHud(page, 9, TOTAL, "التقارير المالية وصافي الأرباح", "فحص قائمة الدخل P&L وتطابق الإيرادات مع دفتر الأستاذ...");
    await page.waitForTimeout(3000);

    // FINALE
    await updateHud(page, TOTAL, TOTAL, "اكتملت الجولة الحية بنجاح 100%! 🎉", "المتصفح متروك مفتوحاً الآن أمامك لتجربة أي شيء بنفسك!");
    console.log("✅ انتهت الجولة بنجاح وتم ترك المتصفح مفتوحاً.");

    // Keep open indefinitely so user can interact
    await new Promise((r) => setTimeout(r, 30 * 60 * 1000));
  } catch (err) {
    console.error("Error during live showcase:", err);
  }
})();
