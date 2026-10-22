const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.resolve(__dirname, "../recordings");
const OUTPUT_MP4 = path.join(RECORDINGS_DIR, "GymGate-Trial-Demo.mp4");

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Clean old files
fs.readdirSync(RECORDINGS_DIR).forEach((file) => {
  if (file.includes("Trial") || file.endsWith(".webm")) {
    try {
      fs.unlinkSync(path.join(RECORDINGS_DIR, file));
    } catch (_) {}
  }
});

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function injectVisualHelpers(page) {
  await page.addStyleTag({
    content: `
      #demo-cursor {
        position: fixed;
        width: 24px;
        height: 24px;
        border: 2px solid #38bdf8;
        background: rgba(56, 189, 248, 0.4);
        border-radius: 50%;
        pointer-events: none;
        z-index: 999999;
        transition: transform 0.08s ease;
        box-shadow: 0 0 16px rgba(56, 189, 248, 0.8);
        transform: translate(-50%, -50%);
        display: block;
      }
      #demo-cursor.clicking {
        transform: translate(-50%, -50%) scale(0.7);
        background: rgba(234, 179, 8, 0.8);
        border-color: #eab308;
        box-shadow: 0 0 25px rgba(234, 179, 8, 1);
      }
      #scene-banner {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 9999px;
        padding: 10px 28px;
        color: #f8fafc;
        font-family: 'Cairo', system-ui, -apple-system, sans-serif;
        font-size: 17px;
        font-weight: 700;
        z-index: 999998;
        box-shadow: 0 10px 35px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.2);
        display: flex;
        align-items: center;
        gap: 10px;
        direction: rtl;
        transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        opacity: 0;
        pointer-events: none;
      }
      #scene-banner.show {
        opacity: 1;
        bottom: 38px;
      }
      #scene-banner .badge {
        background: #0284c7;
        color: white;
        padding: 3px 10px;
        border-radius: 9999px;
        font-size: 12px;
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

async function moveMouseSmoothly(page, targetX, targetY, steps = 16) {
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
    await sleep(14);
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
  await sleep(80);

  await page.evaluate(() => {
    const cur = document.getElementById("demo-cursor");
    if (cur) cur.classList.add("clicking");
  });
  await sleep(100);

  await page.mouse.click(targetX, targetY);

  await page.evaluate(() => {
    const cur = document.getElementById("demo-cursor");
    if (cur) cur.classList.remove("clicking");
  });
  await sleep(200);
}

async function runTrialDemoRecording() {
  console.log("🚀 Starting GymGate Quick Trial Video Recording (1080p)...");

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
    // 1. Login Page
    await page.goto("http://127.0.0.1:8890", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "تسجيل الدخول", "دخول سريع ومحمي للنظام — اسم المستخدم وكلمة المرور");
    await sleep(1500);

    const userInput = await page.$("input[autocomplete='username'], input[type='text']");
    if (userInput) {
      const uBox = await userInput.boundingBox();
      if (uBox) {
        await animatedClick(page, { x: uBox.x + 80, y: uBox.y + uBox.height / 2 });
        await userInput.fill("owner");
      }
      await sleep(400);

      const passInput = await page.$("#login-password, input[type='password']");
      if (passInput) {
        const pBox = await passInput.boundingBox();
        if (pBox) {
          await animatedClick(page, { x: pBox.x + 80, y: pBox.y + pBox.height / 2 });
          await passInput.fill("owner1234");
        }
      }
      await sleep(500);

      await animatedClick(page, "button[type='submit']");
      await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
      await sleep(1800);
      await injectVisualHelpers(page);
    }

    // 2. Dashboard Screen
    await updateScene(page, "لوحة التحكم", "مؤشرات الأداء الحية — الإيرادات، الأرباح، وصحة النظام");
    await moveMouseSmoothly(page, 550, 260, 20);
    await sleep(1500);
    await moveMouseSmoothly(page, 950, 260, 20);
    await sleep(1500);

    // Scroll down to charts & system health
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: "smooth" }));
    await moveMouseSmoothly(page, 1400, 500, 20);
    await sleep(2500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1000);

    // 3. Reception & Attendance
    await updateScene(page, "الاستقبال والحضور", "سرعة مسح الباركود وقت الذروة وتسجيل الحضور الفوري");
    await page.goto("http://127.0.0.1:8890/#/attendance", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(1500);

    const searchInput = await page.$("input[placeholder*='كارت'], input[data-scanner-input='true'], input[type='text']");
    if (searchInput) {
      const sBox = await searchInput.boundingBox();
      if (sBox) {
        await animatedClick(page, { x: sBox.x + 100, y: sBox.y + sBox.height / 2 });
        await searchInput.fill("B1-MEM-000001");
        await sleep(500);
        await page.keyboard.press("Enter");
        await sleep(2500);
      }
    }

    // Day Pass demonstration
    const dayPassBtn = await page.$("button:has-text('تذكرة يوم'), button:has-text('Day Pass'), button:has-text('يومي')");
    if (dayPassBtn) {
      await updateScene(page, "تذكرة اليوم الواحد", "إصدار تذكرة يومية سريعة وتحصيل النقدية فوراً");
      await animatedClick(page, dayPassBtn);
      await sleep(1800);
      await page.keyboard.press("Escape");
      await sleep(800);
    }

    // 4. Members List
    await updateScene(page, "إدارة المشتركين", "ملفات الأعضاء والبحث الذكي وسجل الاشتراكات");
    await page.goto("http://127.0.0.1:8890/#/members", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(1500);

    const memSearch = await page.$("input[placeholder*='بحث']");
    if (memSearch) {
      const mBox = await memSearch.boundingBox();
      if (mBox) {
        await animatedClick(page, { x: mBox.x + 80, y: mBox.y + mBox.height / 2 });
        await memSearch.fill("أحمد");
        await sleep(1200);
      }
    }

    // 5. Store & POS
    await updateScene(page, "متجر المكملات POS", "نقطة بيع سريعة للمكملات والبار مع إدارة المخزون");
    await page.goto("http://127.0.0.1:8890/#/store", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(1800);
    await moveMouseSmoothly(page, 700, 400, 18);
    await sleep(1500);

    // 6. Treasury & Cash Sessions
    await updateScene(page, "الخزينة والورديات", "حماية أموال الصالة — إغلاق الورديات ورصد الفروقات");
    await page.goto("http://127.0.0.1:8890/#/cash", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(1800);
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: "smooth" }));
    await sleep(1500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1000);

    // 7. Cards & WhatsApp QR Delivery
    await updateScene(page, "كروت الواتساب الرقمية", "إرسال كارت رقمي ذكي برمز QR للمشترك عبر واتساب");
    await page.goto("http://127.0.0.1:8890/#/cards", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(1800);

    // 8. Outro Screen
    await updateScene(page, "الختام", "GymGate — بوابتك لإدارة رياضية ذكية وأكثر أماناً");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:linear-gradient(135deg, #090d16 0%, #0f172a 100%);color:white;font-family:'Cairo',sans-serif;direction:rtl;text-align:center;">
          <div style="background:rgba(56, 189, 248, 0.12);border:1.5px solid rgba(56, 189, 248, 0.4);padding:10px 24px;border-radius:9999px;font-size:16px;color:#38bdf8;font-weight:700;margin-bottom:24px;letter-spacing:1px;box-shadow:0 0 30px rgba(56, 189, 248, 0.2);">
            النظام الأكثر استقراراً وقوة للصالات الرياضية
          </div>
          <h1 style="font-size:74px;font-weight:900;margin:0 0 16px 0;background:linear-gradient(90deg, #38bdf8, #818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 10px 30px rgba(0,0,0,0.5);">
            GymGate
          </h1>
          <p style="font-size:26px;color:#94a3b8;margin:0 0 36px 0;max-width:750px;line-height:1.6;">
            بوابتك لإدارة رياضية ذكية، حماية أرباحك، وراحة بالك على مدار الساعة.
          </p>
          <div style="display:flex;gap:20px;">
            <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:14px 28px;border-radius:12px;font-size:18px;color:#f8fafc;font-weight:600;">
              ⚡ يعمل بدون إنترنت 100%
            </div>
            <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:14px 28px;border-radius:12px;font-size:18px;color:#f8fafc;font-weight:600;">
              🔒 حماية كاملة للخزينة والورديات
            </div>
            <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);padding:14px 28px;border-radius:12px;font-size:18px;color:#f8fafc;font-weight:600;">
              📲 كروت واتساب الذكية برمز QR
            </div>
          </div>
        </div>
      `;
    });
    await sleep(4000);

    console.log("✅ Trial demo completed. Finalizing video...");
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
  console.log(`🎬 Transcoding ${webmFiles[0].name} to Full HD MP4 at:\n${OUTPUT_MP4}`);

  const ffmpegCmd = `ffmpeg -y -i "${rawWebmPath}" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "${OUTPUT_MP4}"`;
  execSync(ffmpegCmd, { stdio: "inherit" });

  console.log(`🎉 Trial video successfully produced at:\n${OUTPUT_MP4}`);
}

runTrialDemoRecording().catch((err) => {
  console.error("❌ Trial demo failed:", err);
  process.exit(1);
});
