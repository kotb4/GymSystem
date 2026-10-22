const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.resolve(__dirname, "../recordings");
const OUTPUT_MP4 = path.join(RECORDINGS_DIR, "GymGate-Commercial-Showcase.mp4");

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Clean old webm/mp4 files in recordings
fs.readdirSync(RECORDINGS_DIR).forEach((file) => {
  if (file.endsWith(".webm") || file.endsWith(".mp4")) {
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
      /* Custom glowing cursor */
      #demo-cursor {
        position: fixed;
        width: 24px;
        height: 24px;
        border: 2px solid #38bdf8;
        background: rgba(56, 189, 248, 0.35);
        border-radius: 50%;
        pointer-events: none;
        z-index: 999999;
        transition: transform 0.08s ease, width 0.15s ease, height 0.15s ease, background 0.15s ease;
        box-shadow: 0 0 15px rgba(56, 189, 248, 0.7);
        transform: translate(-50%, -50%);
        display: block;
      }
      #demo-cursor.clicking {
        transform: translate(-50%, -50%) scale(0.75);
        background: rgba(234, 179, 8, 0.7);
        border-color: #eab308;
        box-shadow: 0 0 25px rgba(234, 179, 8, 1);
      }
      /* Scene Banner Overlay */
      #scene-banner {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 9999px;
        padding: 12px 32px;
        color: #f8fafc;
        font-family: 'Cairo', system-ui, -apple-system, sans-serif;
        font-size: 18px;
        font-weight: 700;
        z-index: 999998;
        box-shadow: 0 10px 35px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.2);
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
        letter-spacing: 0.5px;
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
  console.log(`\n🎬 [SCENE] ${badgeText}: ${titleText}`);
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

async function moveMouseSmoothly(page, targetX, targetY, steps = 18) {
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
    // Ease out cubic
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
  await sleep(100);

  // Trigger click animation
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
  await sleep(250);
}

async function runShowcaseRecording() {
  console.log("🚀 Starting GymGate 1080p Commercial Video Showcase Automation...");

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
    await updateScene(page, "البداية", "GymGate — النظام الذكي لإدارة الصالات الرياضية");
    await sleep(2000);

    // If login is shown, log in
    const isLogin = await page.$("input[name='username'], input[type='text']");
    if (isLogin) {
      await updateScene(page, "تسجيل الدخول", "دخول سريع ومحمي بأعلى معايير الأمان");
      const userBox = await isLogin.boundingBox();
      if (userBox) {
        await animatedClick(page, { x: userBox.x + 80, y: userBox.y + 20 });
        await isLogin.fill("owner");
      }
      await sleep(500);

      const passInput = await page.$("input[type='password']");
      if (passInput) {
        const passBox = await passInput.boundingBox();
        if (passBox) {
          await animatedClick(page, { x: passBox.x + 80, y: passBox.y + 20 });
          await passInput.fill("Password123!");
        }
      }
      await sleep(600);

      const loginBtn = await page.$("button[type='submit']");
      if (loginBtn) {
        await animatedClick(page, "button[type='submit']");
      }
      await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
      await sleep(1500);
      await injectVisualHelpers(page);
    }

    // Now on Dashboard
    await updateScene(page, "المشهد 1", "لوحة التحكم الحية — مؤشرات الأداء والأرباح وصحة النظام");
    await moveMouseSmoothly(page, 960, 320, 25);
    await sleep(2500);

    // Smooth scroll down dashboard
    await page.evaluate(() => window.scrollBy({ top: 350, behavior: "smooth" }));
    await moveMouseSmoothly(page, 700, 520, 20);
    await sleep(3500);

    // Point to System Health Card
    await moveMouseSmoothly(page, 1450, 480, 20);
    await sleep(2500);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1500);

    // -------------------------------------------------------------
    // SCENE 2 (00:30 - 01:15): كفاءة الاستقبال وحضور الباركود وتذكرة اليوم
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 2", "الاستقبال والريسبشن — سرعة مسح الباركود وقت الذروة");

    // Click Reception / Attendance menu link
    await page.goto("http://127.0.0.1:8890/attendance", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "المشهد 2", "تسجيل الحضور الفوري ومنع التكرار بأجزاء من الثانية");
    await sleep(2000);

    // Type barcode for member
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

    // Demonstrate Quick Day Pass (F3)
    await updateScene(page, "المشهد 2", "تذكرة اليوم الواحد السريعة (Day Pass) بنقرة زر واحدة");
    const dayPassBtn = await page.$("button:has-text('تذكرة يوم'), button:has-text('Day Pass'), button:has-text('يومي')");
    if (dayPassBtn) {
      await animatedClick(page, dayPassBtn);
      await sleep(1500);

      // Fill visitor name if modal opened
      const nameInput = await page.$(".modal input[type='text'], [role='dialog'] input[type='text']");
      if (nameInput) {
        await nameInput.fill("محمود شريف (زائر)");
        await sleep(600);
      }

      // Close or submit day pass modal
      const confirmBtn = await page.$(".modal button:has-text('حفظ'), .modal button:has-text('تسجيل'), .modal button:has-text('تأكيد'), [role='dialog'] button[type='submit']");
      if (confirmBtn) {
        await animatedClick(page, confirmBtn);
      } else {
        await page.keyboard.press("Escape");
      }
      await sleep(2500);
    }

    // -------------------------------------------------------------
    // SCENE 3 (01:15 - 02:00): إدارة الأعضاء، الاشتراكات، والتجميد الذكي
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 3", "إدارة الأعضاء والاشتراكات — ملف رقمي متكامل ونظام تجميد دقيق");
    await page.goto("http://127.0.0.1:8890/members", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "المشهد 3", "قاعدة بيانات الأعضاء — بحث سريع وتفاصيل الاشتراكات والمديونيات");
    await sleep(2000);

    // Search for a member
    const memSearch = await page.$("input[placeholder*='بحث']");
    if (memSearch) {
      const mBox = await memSearch.boundingBox();
      if (mBox) {
        await animatedClick(page, { x: mBox.x + 80, y: mBox.y + mBox.height / 2 });
        await memSearch.fill("أحمد");
        await sleep(1500);
      }
    }

    // View member profile link/button
    const memberRow = await page.$("table tbody tr:first-child td a, table tbody tr:first-child");
    if (memberRow) {
      await animatedClick(page, memberRow);
      await sleep(2500);
      await injectVisualHelpers(page);
    }

    // Navigate to Subscriptions plans
    await page.goto("http://127.0.0.1:8890/subscriptions", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "المشهد 3", "خطط وباقات مرنة — بالمدة، أو بعدد الحصص، أو باقات مشتركة");
    await sleep(3000);

    // -------------------------------------------------------------
    // SCENE 4 (02:00 - 02:40): المتجر السريع ونقاط البيع (POS)
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 4", "متجر المكملات والبار (POS) — بيع سريع وربط مباشر بالمخزون");
    await page.goto("http://127.0.0.1:8890/store", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "المشهد 4", "نقطة بيع متطورة — بيع بالباركود، خصم المخزون، والبيع الآجل");
    await sleep(2500);

    // Click on a product card or add to cart
    const prodBtn = await page.$("button:has-text('إضافة'), .product-card, table tbody tr:first-child button");
    if (prodBtn) {
      await animatedClick(page, prodBtn);
      await sleep(1500);
    }
    await moveMouseSmoothly(page, 1500, 450, 15);
    await sleep(2500);

    // -------------------------------------------------------------
    // SCENE 5 (02:40 - 03:20): الخزينة الصارمة، الورديات، ومنع التلاعب
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 5", "الخزينة والورديات — حصانة كاملة ضد التلاعب والعجز المالي");
    await page.goto("http://127.0.0.1:8890/cash", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "المشهد 5", "دفتر أستاذ مالي دقيق — مطابقة العهدة النقدية ورصد الفروقات");
    await sleep(3000);

    // Scroll to see session history
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: "smooth" }));
    await sleep(2500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1500);

    // -------------------------------------------------------------
    // SCENE 6 (03:20 - 03:50): أتمتة الواتساب والكارت الرقمي QR وقوة الأوفلاين
    // -------------------------------------------------------------
    await updateScene(page, "المشهد 6", "كروت واتساب الرقمية الذكية (QR) — أتمتة تواصل كاملة مع المشترك");
    await page.goto("http://127.0.0.1:8890/cards", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await sleep(2500);

    // Open WhatsApp delivery or virtual card preview if present
    const waBtn = await page.$("button:has-text('واتساب'), button:has-text('إرسال'), button:has-text('QR')");
    if (waBtn) {
      await animatedClick(page, waBtn);
      await sleep(2500);
      await page.keyboard.press("Escape");
      await sleep(1000);
    }

    // Show Backup & Offline resilience
    await page.goto("http://127.0.0.1:8890/settings", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "المشهد 6", "أمان أوفلاين 100% — لا يتوقف عند انقطاع الإنترنت مع نسخ احتياطي فوري");
    await sleep(3000);

    // -------------------------------------------------------------
    // SCENE 7 (03:50 - 04:05): الشاشة الختامية والدعوة للتعاقد
    // -------------------------------------------------------------
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:linear-gradient(135deg, #090d16 0%, #0f172a 100%);color:white;font-family:'Cairo',sans-serif;direction:rtl;text-align:center;">
          <div style="background:rgba(56, 189, 248, 0.1);border:1px solid rgba(56, 189, 248, 0.3);padding:10px 24px;border-radius:9999px;font-size:16px;color:#38bdf8;font-weight:700;margin-bottom:24px;letter-spacing:1px;box-shadow:0 0 30px rgba(56, 189, 248, 0.2);">
            النظام الأكثر تكاملاً واستقراراً للصالات الرياضية
          </div>
          <h1 style="font-size:72px;font-weight:900;margin:0 0 16px 0;background:linear-gradient(90deg, #38bdf8, #818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 10px 30px rgba(0,0,0,0.5);">
            GymGate
          </h1>
          <p style="font-size:26px;color:#94a3b8;margin:0 0 36px 0;max-width:700px;line-height:1.6;">
            بوابتك لإدارة رياضية ذكية، حماية أرباحك، وراحة بالك على مدار الساعة.
          </p>
          <div style="display:flex;gap:20px;">
            <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:14px 28px;border-radius:12px;font-size:18px;color:#f8fafc;font-weight:600;">
              ⚡ يعمل بدون إنترنت 100%
            </div>
            <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:14px 28px;border-radius:12px;font-size:18px;color:#f8fafc;font-weight:600;">
              🔒 حماية كاملة للخزينة
            </div>
            <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:14px 28px;border-radius:12px;font-size:18px;color:#f8fafc;font-weight:600;">
              📲 كروت واتساب الذكية
            </div>
          </div>
        </div>
      `;
    });
    await sleep(4000);

    console.log("✅ Automated screen tour completed. Finalizing video recording...");
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // Find the generated webm file
  const webmFiles = fs.readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith(".webm"));
  if (webmFiles.length === 0) {
    throw new Error("No webm recording found!");
  }

  const rawWebmPath = path.join(RECORDINGS_DIR, webmFiles[0]);
  console.log(`🎬 Transcoding ${webmFiles[0]} to Full HD MP4 with ffmpeg...`);

  // Transcode to clean H.264 MP4
  const ffmpegCmd = `ffmpeg -y -i "${rawWebmPath}" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "${OUTPUT_MP4}"`;
  execSync(ffmpegCmd, { stdio: "inherit" });

  console.log(`🎉 Final video successfully produced at:\n${OUTPUT_MP4}`);
}

runShowcaseRecording().catch((err) => {
  console.error("❌ Recording failed:", err);
  process.exit(1);
});
