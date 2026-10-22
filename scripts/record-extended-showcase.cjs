const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.resolve(__dirname, "../recordings");
const OUTPUT_EXTENDED_MP4 = path.join(RECORDINGS_DIR, "GymGate-Full-Length-Showcase.mp4");

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
        transition: transform 0.12s ease;
        box-shadow: 0 0 18px rgba(56, 189, 248, 0.85);
        transform: translate(-50%, -50%);
        display: block;
      }
      #demo-cursor.clicking {
        transform: translate(-50%, -50%) scale(0.7);
        background: rgba(234, 179, 8, 0.85);
        border-color: #eab308;
        box-shadow: 0 0 28px rgba(234, 179, 8, 1);
      }
      #scene-banner {
        position: fixed;
        bottom: 35px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.96));
        border: 1.5px solid rgba(56, 189, 248, 0.5);
        border-radius: 9999px;
        padding: 14px 36px;
        color: #f8fafc;
        font-family: 'Cairo', system-ui, -apple-system, sans-serif;
        font-size: 20px;
        font-weight: 700;
        z-index: 999998;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7), 0 0 25px rgba(56, 189, 248, 0.3);
        display: flex;
        align-items: center;
        gap: 14px;
        direction: rtl;
        transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        opacity: 0;
        pointer-events: none;
      }
      #scene-banner.show {
        opacity: 1;
        bottom: 45px;
      }
      #scene-banner .badge {
        background: #0284c7;
        color: white;
        padding: 5px 14px;
        border-radius: 9999px;
        font-size: 14px;
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
  console.log(`\n🎬 [EXTENDED SCENE] ${badgeText}: ${titleText}`);
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

async function moveMouseSmoothly(page, targetX, targetY, steps = 24) {
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
    await sleep(18);
  }
}

async function animatedClick(page, selectorOrCoords) {
  let targetX, targetY;
  if (typeof selectorOrCoords === "string") {
    const el = await page.$(selectorOrCoords);
    if (!el) return;
    const box = await el.boundingBox();
    if (!box) return;
    targetX = box.x + box.width / 2;
    targetY = box.y + box.height / 2;
  } else {
    targetX = selectorOrCoords.x;
    targetY = selectorOrCoords.y;
  }

  await moveMouseSmoothly(page, targetX, targetY);
  await sleep(150);

  await page.evaluate(() => {
    const cur = document.getElementById("demo-cursor");
    if (cur) cur.classList.add("clicking");
  });
  await sleep(160);

  await page.mouse.click(targetX, targetY);

  await page.evaluate(() => {
    const cur = document.getElementById("demo-cursor");
    if (cur) cur.classList.remove("clicking");
  });
  await sleep(350);
}

async function runExtendedRecording() {
  console.log("🚀 Starting GymGate Extended 3:45 Full-Length Commercial Recording...");

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
    // -------------------------------------------------------------
    // SCENE 1 (00:00 - 00:30): تسجيل الدخول ولوحة التحكم الذكية
    // -------------------------------------------------------------
    await page.goto("http://127.0.0.1:8890", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "البداية", "GymGate — النظام الذكي الأكثر استقراراً وأماناً للصالات الرياضية");
    await sleep(4000);

    const isLogin = await page.$("input[name='username'], input[type='text']");
    if (isLogin) {
      await updateScene(page, "المشهد 1: الدخول", "دخول محمي بتشفير قوي وصلاحيات دقيقة لكل موظف");
      const userBox = await isLogin.boundingBox();
      if (userBox) {
        await animatedClick(page, { x: userBox.x + 80, y: userBox.y + 20 });
        await isLogin.fill("owner");
      }
      await sleep(1000);

      const passInput = await page.$("input[type='password']");
      if (passInput) {
        const passBox = await passInput.boundingBox();
        if (passBox) {
          await animatedClick(page, { x: passBox.x + 80, y: passBox.y + 20 });
          await passInput.fill("Password123!");
        }
      }
      await sleep(1000);

      const loginBtn = await page.$("button[type='submit']");
      if (loginBtn) {
        await animatedClick(page, "button[type='submit']");
      }
      await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
      await sleep(2500);
      await injectVisualHelpers(page);
    }

    // Dashboard Overview (Duration ~22s)
    await updateScene(page, "المشهد 1: لوحة التحكم", "مؤشرات الأداء الحية — الإيرادات، الأرباح، وحالة استقرار النظام");
    await moveMouseSmoothly(page, 450, 260, 30);
    await sleep(4000);

    await moveMouseSmoothly(page, 850, 260, 30);
    await sleep(4000);

    // Scroll to charts & system health
    await page.evaluate(() => window.scrollBy({ top: 400, behavior: "smooth" }));
    await sleep(2000);
    await moveMouseSmoothly(page, 750, 600, 30);
    await sleep(5000);

    // Hover over System Health card
    await moveMouseSmoothly(page, 1500, 520, 25);
    await sleep(6000);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(2000);

    // -------------------------------------------------------------
    // SCENE 2 (00:30 - 01:15): كفاءة الاستقبال وحضور الباركود وتذكرة اليوم (~45s)
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 2: الاستقبال", "كفاءة الاستقبال في ساعات الذروة (7–10 مساءً) بدون أي تأخير");
    await page.goto("http://127.0.0.1:8890/attendance", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(3500);

    // Barcode Scan
    await updateScene(page, "المشهد 2: سرعة المسح", "مسح باركود فوري بالأجزاء من الثانية ومنع التكرار التلقائي");
    const searchInput = await page.$("input[placeholder*='كارت'], input[data-scanner-input='true'], input[type='text']");
    if (searchInput) {
      const sBox = await searchInput.boundingBox();
      if (sBox) {
        await animatedClick(page, { x: sBox.x + 100, y: sBox.y + sBox.height / 2 });
        await searchInput.fill("B1-MEM-000001");
        await sleep(1500);
        await page.keyboard.press("Enter");
        await sleep(6000);
      }
    }

    // Day Pass
    await updateScene(page, "المشهد 2: تذكرة اليوم", "إصدار تذكرة يوم واحد (Day Pass) سريعة وتحصيل النقدية فوراً");
    const dayPassBtn = await page.$("button:has-text('تذكرة يوم'), button:has-text('Day Pass'), button:has-text('يومي')");
    if (dayPassBtn) {
      await animatedClick(page, dayPassBtn);
      await sleep(3000);

      const nameInput = await page.$(".modal input[type='text'], [role='dialog'] input[type='text']");
      if (nameInput) {
        await nameInput.fill("أحمد إبراهيم (زائر اليوم)");
        await sleep(2000);
      }

      const confirmBtn = await page.$(".modal button:has-text('حفظ'), .modal button:has-text('تسجيل'), .modal button:has-text('تأكيد'), [role='dialog'] button[type='submit']");
      if (confirmBtn) {
        await animatedClick(page, confirmBtn);
      } else {
        await page.keyboard.press("Escape");
      }
      await sleep(5000);
    }

    // -------------------------------------------------------------
    // SCENE 3 (01:15 - 02:00): إدارة الأعضاء والاشتراكات والتجميد الذكي (~45s)
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 3: المشتركين", "ملف المشترك الرقمي — تاريخ الحضور، المدفوعات، والتقييمات");
    await page.goto("http://127.0.0.1:8890/members", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(3500);

    const memSearch = await page.$("input[placeholder*='بحث']");
    if (memSearch) {
      const mBox = await memSearch.boundingBox();
      if (mBox) {
        await animatedClick(page, { x: mBox.x + 80, y: mBox.y + mBox.height / 2 });
        await memSearch.fill("أحمد");
        await sleep(3000);
      }
    }

    const memberRow = await page.$("table tbody tr:first-child td a, table tbody tr:first-child");
    if (memberRow) {
      await animatedClick(page, memberRow);
      await sleep(6000);
      await injectVisualHelpers(page);
    }

    // Subscriptions Plans
    await updateScene(page, "المشهد 3: الباقات والتجميد", "باقات مرنة ونظام التجميد الذكي بقرار فوري لمنع إهدار الأيام");
    await page.goto("http://127.0.0.1:8890/subscriptions", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await moveMouseSmoothly(page, 500, 350, 30);
    await sleep(5000);
    await moveMouseSmoothly(page, 950, 350, 30);
    await sleep(6000);

    // -------------------------------------------------------------
    // SCENE 4 (02:00 - 02:40): المتجر ونقاط البيع السريعة POS (~40s)
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 4: متجر POS", "نقطة بيع سريعة للبار والمكملات — بيع نقدي أو آجل على حساب العضو");
    await page.goto("http://127.0.0.1:8890/store", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(3500);

    const prodBtn = await page.$("button:has-text('إضافة'), .product-card, table tbody tr:first-child button");
    if (prodBtn) {
      await animatedClick(page, prodBtn);
      await sleep(3000);
    }

    await moveMouseSmoothly(page, 1400, 400, 25);
    await sleep(5000);

    await updateScene(page, "المشهد 4: المخزون والديون", "خصم لحظي من المخزون، حدود ائتمانية، وسداد مجمع للديون");
    await sleep(7000);

    // -------------------------------------------------------------
    // SCENE 5 (02:40 - 03:20): الخزينة والورديات ومنع التلاعب (~40s)
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 5: الخزينة والورديات", "حماية أموال الصالة — دفتر أستاذ مالي غير قابل للتعديل بالخفاء");
    await page.goto("http://127.0.0.1:8890/cash", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(4000);

    await page.evaluate(() => window.scrollBy({ top: 320, behavior: "smooth" }));
    await moveMouseSmoothly(page, 800, 480, 25);
    await sleep(6000);

    await updateScene(page, "المشهد 5: إغلاق الوردية", "تسليم الوردية ومطابقة العهدة النقدية ورصد العجز أو الزيادة آلياً");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(6000);

    // -------------------------------------------------------------
    // SCENE 6 (03:20 - 03:50): كروت الواتساب الرقمية وقوة الأوفلاين (~30s)
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 6: كروت الواتساب", "إرسال كارت رقمي مشفر برمز QR على واتساب المشترك تلقائياً");
    await page.goto("http://127.0.0.1:8890/cards", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(4000);

    const waBtn = await page.$("button:has-text('واتساب'), button:has-text('إرسال'), button:has-text('QR')");
    if (waBtn) {
      await animatedClick(page, waBtn);
      await sleep(4000);
      await page.keyboard.press("Escape");
      await sleep(1500);
    }

    await updateScene(page, "المشهد 6: أمان أوفلاين 100%", "يعمل محلياً بدون إنترنت، وقاعدة بيانات مشفرة ومحفوظة احتياطياً");
    await page.goto("http://127.0.0.1:8890/settings", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(5000);

    // -------------------------------------------------------------
    // SCENE 7 (03:50 - 04:10): الشاشة الختامية والدعوة للتعاقد (~20s)
    // -------------------------------------------------------------
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
    await sleep(7000);

    console.log("✅ Extended screen tour completed. Transcoding video...");
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // Find the generated webm file that is newest
  const webmFiles = fs.readdirSync(RECORDINGS_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ name: f, time: fs.statSync(path.join(RECORDINGS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (webmFiles.length === 0) {
    throw new Error("No webm recording found!");
  }

  const rawWebmPath = path.join(RECORDINGS_DIR, webmFiles[0].name);
  console.log(`🎬 Transcoding ${webmFiles[0].name} to Full HD MP4 at:\n${OUTPUT_EXTENDED_MP4}`);

  const ffmpegCmd = `ffmpeg -y -i "${rawWebmPath}" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "${OUTPUT_EXTENDED_MP4}"`;
  execSync(ffmpegCmd, { stdio: "inherit" });

  console.log(`🎉 Extended video successfully produced at:\n${OUTPUT_EXTENDED_MP4}`);
}

runExtendedRecording().catch((err) => {
  console.error("❌ Extended recording failed:", err);
  process.exit(1);
});
