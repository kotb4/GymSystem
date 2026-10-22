const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.resolve(__dirname, "../recordings");
const OUTPUT_MP4 = path.join(RECORDINGS_DIR, "GymGate-Authentic-Demo.mp4");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function injectVisualHelpers(page) {
  await page.addStyleTag({
    content: `
      #demo-cursor {
        position: fixed;
        width: 26px;
        height: 26px;
        border: 2.5px solid #38bdf8;
        background: rgba(56, 189, 248, 0.4);
        border-radius: 50%;
        pointer-events: none;
        z-index: 999999;
        transition: transform 0.1s ease;
        box-shadow: 0 0 16px rgba(56, 189, 248, 0.85);
        transform: translate(-50%, -50%);
        display: block;
      }
      #demo-cursor.clicking {
        transform: translate(-50%, -50%) scale(0.65);
        background: rgba(234, 179, 8, 0.85);
        border-color: #eab308;
        box-shadow: 0 0 25px rgba(234, 179, 8, 1);
      }
      #scene-banner {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
        border: 1.5px solid rgba(56, 189, 248, 0.45);
        border-radius: 9999px;
        padding: 12px 32px;
        color: #f8fafc;
        font-family: 'Cairo', system-ui, -apple-system, sans-serif;
        font-size: 18px;
        font-weight: 700;
        z-index: 999998;
        box-shadow: 0 10px 35px rgba(0, 0, 0, 0.7), 0 0 20px rgba(56, 189, 248, 0.25);
        display: flex;
        align-items: center;
        gap: 12px;
        direction: rtl;
        transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        opacity: 0;
        pointer-events: none;
      }
      #scene-banner.show {
        opacity: 1;
        bottom: 40px;
      }
      #scene-banner .badge {
        background: #0284c7;
        color: white;
        padding: 4px 12px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 800;
      }
    `,
  });

  await page.evaluate(() => {
    if (!document.getElementById("demo-cursor")) {
      const cursor = document.createElement("div");
      cursor.id = "demo-cursor";
      cursor.style.left = "960px";
      cursor.style.top = "540px";
      document.body.appendChild(cursor);
    }
    if (!document.getElementById("scene-banner")) {
      const banner = document.createElement("div");
      banner.id = "scene-banner";
      banner.innerHTML = `<span class="badge">GymGate</span> <span id="scene-text">نظام إدارة الجيم الذكي</span>`;
      document.body.appendChild(banner);
    }
  });
}

async function updateScene(page, badgeText, titleText) {
  console.log(`🎬 [DEMO] ${badgeText}: ${titleText}`);
  await page.evaluate(
    ({ badgeText, titleText }) => {
      const banner = document.getElementById("scene-banner");
      if (banner) {
        banner.innerHTML = `<span class="badge">${badgeText}</span> <span id="scene-text">${titleText}</span>`;
        banner.classList.add("show");
      }
    },
    { badgeText, titleText },
  );
}

async function moveMouseSmoothly(page, targetX, targetY, steps = 20) {
  const currentPos = await page.evaluate(() => {
    const cur = document.getElementById("demo-cursor");
    if (!cur) return { x: 960, y: 540 };
    return {
      x: parseFloat(cur.style.left) || 960,
      y: parseFloat(cur.style.top) || 540,
    };
  });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = 1 - Math.pow(1 - t, 3);
    const x = currentPos.x + (targetX - currentPos.x) * ease;
    const y = currentPos.y + (targetY - currentPos.y) * ease;

    await page.evaluate(
      ({ x, y }) => {
        const cur = document.getElementById("demo-cursor");
        if (cur) {
          cur.style.left = `${x}px`;
          cur.style.top = `${y}px`;
        }
      },
      { x, y },
    );
    await sleep(15);
  }
}

async function animatedClick(page, selectorOrCoords) {
  let targetX, targetY;
  if (typeof selectorOrCoords === "string") {
    const el = await page.$(selectorOrCoords);
    if (!el) return false;
    const box = await el.boundingBox();
    if (!box) return false;
    targetX = box.x + box.width / 2;
    targetY = box.y + box.height / 2;
  } else if (selectorOrCoords && typeof selectorOrCoords.boundingBox === "function") {
    const box = await selectorOrCoords.boundingBox();
    if (!box) return false;
    targetX = box.x + box.width / 2;
    targetY = box.y + box.height / 2;
  } else if (selectorOrCoords && typeof selectorOrCoords.x === "number") {
    targetX = selectorOrCoords.x;
    targetY = selectorOrCoords.y;
  } else {
    return false;
  }

  await moveMouseSmoothly(page, targetX, targetY);
  await sleep(100);

  await page.evaluate(() => {
    const cur = document.getElementById("demo-cursor");
    if (cur) cur.classList.add("clicking");
  });
  await sleep(120);

  await page.mouse.click(targetX, targetY);

  await page.evaluate(() => {
    const cur = document.getElementById("demo-cursor");
    if (cur) cur.classList.remove("clicking");
  });
  await sleep(300);
  return true;
}

async function runAuthenticDemo() {
  console.log("🚀 Starting Authentic Realistic Showcase Recording...");

  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });

  const context = await browser.newContext({
    recordVideo: {
      dir: RECORDINGS_DIR,
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: "ar-EG",
  });

  const page = await context.newPage();

  try {
    // -----------------------------------------------------------------
    // 1. تسجيل الدخول
    // -----------------------------------------------------------------
    await page.goto("http://127.0.0.1:8890", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "تسجيل الدخول", "دخول سريع ومحمي للنظام — اسم المستخدم وكلمة المرور");
    await sleep(2000);

    const userInput = await page.$("input[autocomplete='username'], input[type='text']");
    if (userInput) {
      await animatedClick(page, userInput);
      await userInput.fill("owner");
      await sleep(500);

      const passInput = await page.$("#login-password, input[type='password']");
      if (passInput) {
        await animatedClick(page, passInput);
        await passInput.fill("owner1234");
      }
      await sleep(600);

      await animatedClick(page, "button[type='submit']");
      await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
      await sleep(2000);
      await injectVisualHelpers(page);
    }

    // -----------------------------------------------------------------
    // 2. لوحة التحكم الحية (Dashboard)
    // -----------------------------------------------------------------
    await updateScene(page, "لوحة التحكم", "نظرة شاملة ومؤشرات أداء حية — الأعضاء النشطين، الإيرادات وصحة النظام");
    await sleep(2000);

    // Hover over KPI cards
    await moveMouseSmoothly(page, 450, 240, 25);
    await sleep(2000);
    await moveMouseSmoothly(page, 800, 240, 25);
    await sleep(2000);

    // Scroll down to view the charts and the System Health card
    await page.evaluate(() => window.scrollBy({ top: 380, behavior: "smooth" }));
    await sleep(1500);
    await moveMouseSmoothly(page, 1450, 520, 25); // System health card
    await sleep(3500);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1200);

    // -----------------------------------------------------------------
    // 3. الاستقبال والحضور بالباركود (عبر النقر على القائمة الجانبية)
    // -----------------------------------------------------------------
    await updateScene(page, "الاستقبال والحضور", "سرعة مسح الكروت في ساعات الذروة (7–10 مساءً) بدون أي تأخير");

    // Click on "الاستقبال" in the sidebar
    const attendanceLink = await page.$("a[href*='attendance'], nav a:has-text('الاستقبال')");
    if (attendanceLink) {
      await animatedClick(page, attendanceLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/attendance");
    }
    await sleep(2200);
    await injectVisualHelpers(page);

    // Click inside the REAL search box inside the attendance page (NOT the sidebar search on the right!)
    const barcodeInput = await page.$("main input[data-scanner-input='true']");
    if (barcodeInput) {
      await animatedClick(page, barcodeInput);
      await sleep(500);

      // Type the real member card barcode: B1-CRD-000001
      await barcodeInput.fill("B1-CRD-000001");
      await sleep(800);

      // Click the check-in button next to it
      const checkinSubmitBtn = await page.$("main form button[type='submit']");
      if (checkinSubmitBtn) {
        await animatedClick(page, checkinSubmitBtn);
      } else {
        await page.keyboard.press("Enter");
      }
      await sleep(4000); // Leave the green member card visible on screen
    }

    // Quick Day Pass Demonstration
    const dayPassBtn = await page.$("main button:has-text('تذكرة يوم'), main button:has-text('Day Pass'), main button:has-text('يومي')");
    if (dayPassBtn) {
      await updateScene(page, "تذكرة يوم واحد", "إصدار تذكرة يومية فورية لزائر الصالة وتحصيل النقدية بنقرة واحدة");
      await animatedClick(page, dayPassBtn);
      await sleep(2200);

      const nameInput = await page.$(".modal input[type='text'], [role='dialog'] input[type='text']");
      if (nameInput) {
        await animatedClick(page, nameInput);
        await nameInput.fill("محمود شريف (زائر)");
        await sleep(1500);
      }

      await page.keyboard.press("Escape");
      await sleep(1000);
    }

    // -----------------------------------------------------------------
    // 4. المشتركون (النقر على القائمة الجانبية واستعراض ملف العضو)
    // -----------------------------------------------------------------
    await updateScene(page, "إدارة المشتركين", "ملفات الأعضاء الرقمية — بحث بالاسم أو الهاتف والوصول لملف العضو");

    const membersLink = await page.$("a[href*='members'], nav a:has-text('المشتركون')");
    if (membersLink) {
      await animatedClick(page, membersLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/members");
    }
    await sleep(2200);
    await injectVisualHelpers(page);

    // Search for a real existing member inside the MAIN page table (NOT the sidebar search on the right!):
    const memberSearchInput = await page.$("main input[placeholder*='بحث'], main input[type='text']");
    if (memberSearchInput) {
      await animatedClick(page, memberSearchInput);
      await memberSearchInput.fill("الشناوي");
      await sleep(2200); // Show filtered table
    }

    // Click on the member row in the table to open their profile
    const memberProfileLink = await page.$("main table tbody tr:first-child a, main table tbody tr:first-child");
    if (memberProfileLink) {
      await animatedClick(page, memberProfileLink);
      await sleep(4000);
      await injectVisualHelpers(page);
    }

    // -----------------------------------------------------------------
    // 5. باقات الاشتراكات (Subscriptions)
    // -----------------------------------------------------------------
    await updateScene(page, "باقات الاشتراكات", "باقات مرنة — اشتراكات بالمدة أو بعدد الحصص أو باقات مختلطة");

    const subsLink = await page.$("a[href*='subscriptions'], nav a:has-text('الاشتراكات')");
    if (subsLink) {
      await animatedClick(page, subsLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/subscriptions");
    }
    await sleep(2000);
    await injectVisualHelpers(page);

    // Hover over plans
    await moveMouseSmoothly(page, 500, 340, 25);
    await sleep(2000);
    await moveMouseSmoothly(page, 900, 340, 25);
    await sleep(2000);

    // -----------------------------------------------------------------
    // 6. متجر المكملات ونقاط البيع السريعة (POS)
    // -----------------------------------------------------------------
    await updateScene(page, "متجر المكملات POS", "نقطة بيع سريعة للمكملات والبار مع جرد لحظي للمخزون");

    const storeLink = await page.$("a[href*='store'], nav a:has-text('المتجر')");
    if (storeLink) {
      await animatedClick(page, storeLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/store");
    }
    await sleep(2000);
    await injectVisualHelpers(page);

    // Add product to cart
    const addProductBtn = await page.$(".product-card button, table tbody tr:first-child button, button:has-text('إضافة')");
    if (addProductBtn) {
      await animatedClick(page, addProductBtn);
      await sleep(1500);
    }

    // Move to cart / checkout section
    await moveMouseSmoothly(page, 1500, 420, 20);
    await sleep(2500);

    // -----------------------------------------------------------------
    // 7. الخزينة والورديات (Treasury & Cash Sessions)
    // -----------------------------------------------------------------
    await updateScene(page, "الخزينة والورديات", "حماية أموال الصالة — إغلاق الورديات بالثانية ومطابقة العهدة النقدية");

    const treasuryLink = await page.$("a[href*='treasury'], a[href*='cash'], nav a:has-text('الخزينة')");
    if (treasuryLink) {
      await animatedClick(page, treasuryLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/treasury");
    }
    await sleep(2000);
    await injectVisualHelpers(page);

    // Scroll to see shift and cash balance
    await page.evaluate(() => window.scrollBy({ top: 250, behavior: "smooth" }));
    await sleep(2000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1200);

    // -----------------------------------------------------------------
    // 8. الشاشة الختامية
    // -----------------------------------------------------------------
    await updateScene(page, "الختام", "GymGate — بوابتك لإدارة رياضية ذكية وأكثر أماناً");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:linear-gradient(135deg, #090d16 0%, #0f172a 100%);color:white;font-family:'Cairo',sans-serif;direction:rtl;text-align:center;">
          <div style="background:rgba(56, 189, 248, 0.12);border:1.5px solid rgba(56, 189, 248, 0.4);padding:12px 30px;border-radius:9999px;font-size:18px;color:#38bdf8;font-weight:700;margin-bottom:28px;letter-spacing:1px;box-shadow:0 0 35px rgba(56, 189, 248, 0.25);">
            النظام الأكثر استقراراً وقوة واحترافية للصالات الرياضية
          </div>
          <h1 style="font-size:84px;font-weight:900;margin:0 0 20px 0;background:linear-gradient(90deg, #38bdf8, #818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 12px 35px rgba(0,0,0,0.6);">
            GymGate
          </h1>
          <p style="font-size:28px;color:#94a3b8;margin:0 0 40px 0;max-width:850px;line-height:1.6;">
            بوابتك لإدارة رياضية ذكية، حماية أرباحك، وراحة بالك على مدار الساعة.
          </p>
          <div style="display:flex;gap:24px;">
            <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);padding:16px 32px;border-radius:14px;font-size:20px;color:#f8fafc;font-weight:700;">
              ⚡ يعمل بدون إنترنت 100%
            </div>
            <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);padding:16px 32px;border-radius:14px;font-size:20px;color:#f8fafc;font-weight:700;">
              🔒 حماية كاملة للخزينة والورديات
            </div>
            <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);padding:16px 32px;border-radius:14px;font-size:20px;color:#f8fafc;font-weight:700;">
              📲 كروت واتساب الذكية برمز QR
            </div>
          </div>
        </div>
      `;
    });
    await sleep(4000);

    console.log("✅ Authentic demo completed. Finalizing video...");
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  const webmFiles = fs.readdirSync(RECORDINGS_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ name: f, time: fs.statSync(path.join(RECORDINGS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (webmFiles.length === 0) {
    throw new Error("No webm recording found!");
  }

  const rawWebmPath = path.join(RECORDINGS_DIR, webmFiles[0].name);
  console.log(`🎬 Transcoding to Full HD MP4 at:\n${OUTPUT_MP4}`);

  const ffmpegCmd = `ffmpeg -y -i "${rawWebmPath}" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "${OUTPUT_MP4}"`;
  execSync(ffmpegCmd, { stdio: "inherit" });

  console.log(`🎉 Authentic video produced at:\n${OUTPUT_MP4}`);
}

runAuthenticDemo().catch((err) => {
  console.error("❌ Recording failed:", err);
  process.exit(1);
});
