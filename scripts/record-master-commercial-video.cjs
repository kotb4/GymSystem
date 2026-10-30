const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.resolve(__dirname, "../recordings");
const OUTPUT_MP4 = path.join(RECORDINGS_DIR, "GymGate_Master_Commercial_Showcase.mp4");
const DESKTOP_MP4 = "C:\\Users\\KOTB\\Desktop\\GymGate_Master_Commercial_Showcase.mp4";
const VOICEOVER_WAV = "C:\\Users\\KOTB\\.gemini\\antigravity\\brain\\24544496-ce86-4841-8fcf-092d64789551\\.user_uploaded\\uploaded_media_1793170219503.wav";
const SNAPSHOTS_DIR = "C:\\Users\\KOTB\\.gemini\\antigravity\\brain\\24544496-ce86-4841-8fcf-092d64789551";

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Clean old recordings
try {
  const oldWebms = fs.readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith(".webm"));
  for (const f of oldWebms) {
    fs.unlinkSync(path.join(RECORDINGS_DIR, f));
  }
} catch (e) {}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let VIDEO_START_TIME = Date.now();

async function syncToSecond(targetSec) {
  const elapsed = (Date.now() - VIDEO_START_TIME) / 1000;
  const waitMs = Math.round((targetSec - elapsed) * 1000);
  if (waitMs > 15) {
    console.log(`⏱️ [SYNC] Current: ${elapsed.toFixed(1)}s -> Waiting ${(waitMs / 1000).toFixed(1)}s to reach ${targetSec.toFixed(1)}s`);
    await sleep(waitMs);
  } else {
    console.log(`⏱️ [SYNC] Current: ${elapsed.toFixed(1)}s already at/near target ${targetSec.toFixed(1)}s (drift: ${-waitMs}ms)`);
  }
}

async function injectVisualHelpers(page) {
  await page.addStyleTag({
    content: `
      #demo-cursor {
        position: fixed;
        width: 24px;
        height: 24px;
        border: 2.5px solid #38bdf8;
        background: rgba(56, 189, 248, 0.35);
        border-radius: 50%;
        pointer-events: none;
        z-index: 9999999;
        transition: transform 0.12s ease;
        box-shadow: 0 0 16px rgba(56, 189, 248, 0.8), inset 0 0 6px rgba(255, 255, 255, 0.6);
        transform: translate(-50%, -50%);
        display: block;
      }
      #demo-cursor.clicking {
        transform: translate(-50%, -50%) scale(0.6);
        background: rgba(34, 197, 94, 0.85);
        border-color: #22c55e;
        box-shadow: 0 0 24px rgba(34, 197, 94, 1);
      }
      #scene-banner {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, rgba(10, 15, 30, 0.94), rgba(15, 23, 42, 0.94));
        border: 1.5px solid rgba(56, 189, 248, 0.4);
        border-radius: 9999px;
        padding: 10px 28px;
        color: #f8fafc;
        font-family: 'Cairo', system-ui, -apple-system, sans-serif;
        font-size: 16px;
        font-weight: 700;
        z-index: 9999998;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.75), 0 0 20px rgba(56, 189, 248, 0.2);
        display: flex;
        align-items: center;
        gap: 12px;
        direction: rtl;
        transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        opacity: 0;
        pointer-events: none;
      }
      #scene-banner.show {
        opacity: 1;
        bottom: 32px;
      }
      #scene-banner .badge {
        background: linear-gradient(135deg, #0284c7, #2563eb);
        color: white;
        padding: 4px 14px;
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
      banner.innerHTML = `<span class="badge">GymGate</span> <span id="scene-text">نظام إدارة الصالات الرياضية الذكي</span>`;
      document.body.appendChild(banner);
    }
  });
}

async function updateScene(page, badgeText, titleText) {
  console.log(`🎬 [SCENE] [${badgeText}]: ${titleText}`);
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
  await sleep(80);

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
  await sleep(200);
  return true;
}

async function smoothScroll(page, targetY, steps = 15) {
  const currentY = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = 1 - Math.pow(1 - t, 3);
    const y = currentY + (targetY - currentY) * ease;
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "auto" }), y);
    await sleep(18);
  }
}

async function animatedType(page, selector, text) {
  const el = await page.$(selector);
  if (!el) return;
  await animatedClick(page, el);
  await sleep(100);
  await el.fill("");
  for (const char of text) {
    await page.keyboard.type(char, { delay: 35 + Math.random() * 25 });
  }
  await sleep(150);
}

async function captureSnapshot(page, name) {
  try {
    const filePath = path.join(SNAPSHOTS_DIR, `${name}.png`);
    await page.screenshot({ path: filePath });
    console.log(`📸 Saved snapshot: ${filePath}`);
  } catch (e) {
    console.warn(`Snapshot failed for ${name}:`, e.message);
  }
}

async function runMasterCommercial() {
  console.log("🌟 Seeding realistic showcase data before recording...");
  execSync("node scripts/seed-rich-showcase-data.cjs", { stdio: "inherit" });

  console.log("🚀 Launching Edge for Full HD Master Commercial Recording (1920x1080)...");
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
  VIDEO_START_TIME = Date.now();

  try {
    // =========================================================================
    // المشهد 1: الصدمة وافتتاحية الأمان والأوفلاين التام (00:00 – 00:26.0) [26.0s]
    // =========================================================================
    console.log("🎬 SCENE 1: Introduction & 100% Offline Power (00:00 - 00:26.0)");
    await page.goto("http://127.0.0.1:8890/#/login", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "GymGate", "نظام إدارة الصالات الرياضية الذكي — أمان تام واستقرار أوفلاين 100%");

    await sleep(1200);
    const userInput = await page.$("input[autocomplete='username'], input[type='text']");
    if (userInput) {
      await updateScene(page, "تسجيل الدخول", "دخول سريع ومحمي بأعلى معايير التشفير والأمان");
      await animatedType(page, "input[autocomplete='username'], input[type='text']", "owner");
      await sleep(300);

      const passInput = await page.$("input[type='password']");
      if (passInput) {
        await animatedType(page, "input[type='password']", "OwnerPassword123!");
      }
      await sleep(300);
      await animatedClick(page, "button[type='submit']");
      await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
      await sleep(1000);
      await injectVisualHelpers(page);
    } else {
      await page.goto("http://127.0.0.1:8890/#/", { waitUntil: "networkidle" });
      await injectVisualHelpers(page);
    }

    // Dashboard Overview (10.0s – 26.0s)
    await updateScene(page, "لوحة التحكم الحية", "نظرة شاملة ومؤشرات حية — الإيرادات، الأعضاء النشطين، ونسبة الإشغال");
    await moveMouseSmoothly(page, 460, 240, 20);
    await sleep(2200);
    await moveMouseSmoothly(page, 820, 240, 20);
    await sleep(2200);
    await moveMouseSmoothly(page, 1180, 240, 20);
    await sleep(2200);

    // Scroll to show system health & offline assurance
    await smoothScroll(page, 380);
    await sleep(1000);
    await updateScene(page, "أمان واستقرار محلي 100%", "يعمل بدون إنترنت نهائياً، قاعدة بياناتك مشفرة ومحفوظة على جهازك");
    await moveMouseSmoothly(page, 1420, 520, 22);
    await sleep(3000);

    await captureSnapshot(page, "frame_scene1_dashboard_offline");
    await smoothScroll(page, 0);
    await sleep(800);

    // Exact synchronization to Scene 2 (26.0s)
    await syncToSecond(26.0);

    // =========================================================================
    // المشهد 2: حماية فلوس الدرج وتقفيل الوردية الذكي Z-Report (00:26.0 – 00:52.0) [26.0s]
    // =========================================================================
    console.log("🎬 SCENE 2: Treasury & Cash Protection (Z-Report) (00:26.0 - 00:52.0)");
    await updateScene(page, "حماية الخزينة والدرج", "⚡ تقفيل الوردية Z-Report — كشف العجز والزيادة لحظياً وبدون مليم تلاعب");

    const treasuryLink = await page.$("a[href*='treasury'], nav a:has-text('الخزينة')");
    if (treasuryLink) {
      await animatedClick(page, treasuryLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/treasury", { waitUntil: "networkidle" });
    }
    await sleep(1400);
    await injectVisualHelpers(page);

    // Hover over cash summary
    await moveMouseSmoothly(page, 480, 260, 20);
    await sleep(2000);

    // Click Z-Report button
    const zReportBtn = await page.$("button:has-text('Z-Report'), button:has-text('تقفيل الوردية')");
    if (zReportBtn) {
      await animatedClick(page, zReportBtn);
      await sleep(1500);
      await injectVisualHelpers(page);

      // Open Denomination Calculator
      const calcToggle = await page.$("button:has-text('حاسبة'), button:has-text('عد الفئات')");
      if (calcToggle) {
        await animatedClick(page, calcToggle);
        await sleep(1200);
      }

      // Type Counted Cash matching expected (7650) to show zero discrepancy
      const countedInput = await page.$(".modal input[type='number'], [role='dialog'] input[type='number']");
      if (countedInput) {
        await updateScene(page, "مطابقة دقيقة بالقرش", "السيستم يحسب الرصيد المتوقع ويقارنه بالعد الفعلي لحظياً");
        await animatedType(page, ".modal input[type='number'], [role='dialog'] input[type='number']", "7650");
        await sleep(2500);
      }

      await captureSnapshot(page, "frame_scene2_z_report");

      // Smooth hover over Close Shift button / Note
      await moveMouseSmoothly(page, 960, 680, 22);
      await sleep(3500);

      // Close modal cleanly
      await page.keyboard.press("Escape");
      await sleep(1000);
    }

    // Exact synchronization to Scene 3 (52.0s)
    await syncToSecond(52.0);

    // =========================================================================
    // المشهد 3: كارت العضوية الذكي على الواتساب (00:52.0 – 01:10.5) [18.5s]
    // =========================================================================
    console.log("🎬 SCENE 3: Smart WhatsApp QR Cards (00:52.0 - 01:10.5)");
    await updateScene(page, "كروت الواتساب الرقمية", "إرسال كارت العضوية الذكي برمز QR فخم مباشرة على واتساب المشترك");

    const cardsLink = await page.$("a[href*='cards'], nav a:has-text('الكروت')");
    if (cardsLink) {
      await animatedClick(page, cardsLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/cards", { waitUntil: "networkidle" });
    }
    await sleep(1400);
    await injectVisualHelpers(page);

    // Table search or hover first card
    await moveMouseSmoothly(page, 520, 380, 20);
    await sleep(1800);

    // Open QR Delivery Modal for the member
    const sendCardBtn = await page.$("table tbody tr button:has(svg.lucide-send), table tbody tr button[aria-label*='إرسال'], table tbody tr button[aria-label*='QR']");
    if (sendCardBtn) {
      await animatedClick(page, sendCardBtn);
      await sleep(2000);
      await injectVisualHelpers(page);

      await updateScene(page, "كارت رقمي على الموبايل", "توفير آلاف الجنيهات في الكروت البلاستيكية ودخول فوري بمسح الـ QR");
      await moveMouseSmoothly(page, 960, 500, 22);
      await sleep(3500);

      await captureSnapshot(page, "frame_scene3_whatsapp_card");

      await page.keyboard.press("Escape");
      await sleep(1000);
    }

    // Exact synchronization to Scene 4 (70.5s)
    await syncToSecond(70.5);

    // =========================================================================
    // المشهد 4: سرعة الاستقبال وتذكرة اليوم الواحد Day Pass (01:10.5 – 01:31.5) [21.0s]
    // =========================================================================
    console.log("🎬 SCENE 4: Peak-Hours Reception & Day Pass (01:10.5 - 01:31.5)");
    await updateScene(page, "سرعة الاستقبال والذروة", "تسجيل حضور فوري بالباركود وتذكرة الزائر السريع F3 بضغطة زر واحدة");

    const receptionLink = await page.$("a[href*='attendance'], nav a:has-text('الاستقبال')");
    if (receptionLink) {
      await animatedClick(page, receptionLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/attendance", { waitUntil: "networkidle" });
    }
    await sleep(1400);
    await injectVisualHelpers(page);

    // Barcode scan check-in
    const barcodeInput = await page.$("input[data-scanner-input='true']");
    if (barcodeInput) {
      await animatedClick(page, barcodeInput);
      await sleep(300);
      await animatedType(page, "input[data-scanner-input='true']", "B1-CRD-000001");
      await sleep(200);
      await page.keyboard.press("Enter");
      await sleep(1800);
    }

    // Green member verification badge
    await updateScene(page, "عضوية سارية ومعتمدة", "ظهور فوري لبيانات المشترك، نوع الاشتراك، والرصيد بأجزاء من الثانية");
    await moveMouseSmoothly(page, 650, 420, 20);
    await sleep(2500);

    // Click Day Pass (F3) button
    await updateScene(page, "تذكرة Day Pass الفورية", "تسجيل الزائر السريع في ثوانٍ وإيداع النقدية في الخزينة فوراً");
    const dayPassBtn = await page.$("button:has-text('Day Pass'), button:has-text('تذكرة يوم'), button:has-text('F3')");
    if (dayPassBtn) {
      await animatedClick(page, dayPassBtn);
      await sleep(1200);
      await injectVisualHelpers(page);

      // Type guest name
      const guestInput = await page.$(".modal input[placeholder*='اسم'], [role='dialog'] input[placeholder*='اسم']");
      if (guestInput) {
        await animatedType(page, ".modal input[placeholder*='اسم'], [role='dialog'] input[placeholder*='اسم']", "أحمد مصطفى (زائر حر)");
        await sleep(1000);
      }

      await captureSnapshot(page, "frame_scene4_daypass");

      // Submit Day Pass
      const submitDayPassBtn = await page.$(".modal button[type='submit'], [role='dialog'] button[type='submit']");
      if (submitDayPassBtn) {
        await animatedClick(page, submitDayPassBtn);
        await sleep(1500);
      } else {
        await page.keyboard.press("Escape");
        await sleep(800);
      }
    }

    // Exact synchronization to Scene 5 (91.5s)
    await syncToSecond(91.5);

    // =========================================================================
    // المشهد 5: ملفات المشتركين والتجميد الذكي (01:31.5 – 01:51.0) [19.5s]
    // =========================================================================
    console.log("🎬 SCENE 5: Member CRM & Smart Freeze (01:31.5 - 01:51.0)");
    await updateScene(page, "إدارة المشتركين الشاملة", "ملف رقمي لكل عضو — سجل الحضور، قياسات الـ InBody، والتجميد الذكي");

    const membersLink = await page.$("a[href*='members'], nav a:has-text('المشتركون')");
    if (membersLink) {
      await animatedClick(page, membersLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/members", { waitUntil: "networkidle" });
    }
    await sleep(1400);
    await injectVisualHelpers(page);

    // Table search
    const searchInput = await page.$("input[placeholder*='بحث'], input[type='search'], input[type='text']");
    if (searchInput) {
      await animatedType(page, "input[placeholder*='بحث'], input[type='search'], input[type='text']", "الشناوي");
      await sleep(1000);
    }

    // Click member profile link
    const memberLink = await page.$("table a:has-text('الشناوي'), a[href*='members/mem-01']");
    if (memberLink) {
      await animatedClick(page, memberLink);
      await sleep(1800);
      await injectVisualHelpers(page);

      // Scroll inside profile to show InBody and History
      await updateScene(page, "ملف العضو الشامل والتجميد", "نظام التجميد الذكي (Smart Freeze) يمدد تاريخ الانتهاء تلقائياً وبدقة");
      await smoothScroll(page, 320);
      await sleep(2200);
      await moveMouseSmoothly(page, 680, 480, 20);
      await sleep(2500);

      await captureSnapshot(page, "frame_scene5_member_profile");

      await smoothScroll(page, 0);
      await sleep(800);
    }

    // Exact synchronization to Scene 6 (111.0s)
    await syncToSecond(111.0);

    // =========================================================================
    // المشهد 6: متجر المكملات ونقاط البيع السريعة POS (01:51.0 – 02:08.2) [17.2s]
    // =========================================================================
    console.log("🎬 SCENE 6: Store POS & Member Accounts (01:51.0 - 02:08.2)");
    await updateScene(page, "متجر المكملات POS", "نقطة بيع سريعة للمكملات والبار — بيع نقدي أو آجل على حساب المشترك");

    const storeLink = await page.$("a[href*='store'], nav a:has-text('المتجر')");
    if (storeLink) {
      await animatedClick(page, storeLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/store", { waitUntil: "networkidle" });
    }
    await sleep(1400);
    await injectVisualHelpers(page);

    // Click product 1 (Protein bar)
    const product1 = await page.$("button:has-text('بروتين بار'), button:has-text('بار'), button:has-text('جولد ستاندرد')");
    if (product1) {
      await animatedClick(page, product1);
      await sleep(1000);
    }

    // Click product 2 (Energy drink)
    const product2 = await page.$("button:has-text('مشروب طاقة'), button:has-text('مياه معدنية'), button:has-text('كرياتين')");
    if (product2) {
      await animatedClick(page, product2);
      await sleep(1200);
    }

    // Show Cart and checkout options
    await updateScene(page, "سلة المشتريات والائتمان", "خصم لحظي من المخزون، ودعم البيع الآجل بحساب المشترك وسداد فوري");
    await moveMouseSmoothly(page, 1420, 380, 20);
    await sleep(2500);
    await moveMouseSmoothly(page, 1420, 620, 20);
    await sleep(2500);

    await captureSnapshot(page, "frame_scene6_store_pos");

    // Exact synchronization to Scene 7 (128.2s)
    await syncToSecond(128.2);

    // =========================================================================
    // المشهد 7: التقارير المالية وصافي الأرباح المبسطة (02:08.2 – 02:27.8) [19.6s]
    // =========================================================================
    console.log("🎬 SCENE 7: Clean Financial Intelligence & Net Profit (02:08.2 - 02:27.8)");
    await updateScene(page, "التقارير المالية وصافي الأرباح", "رؤية مالية واضحة بنظرة واحدة — الإيرادات، المصروفات، وصافي أرباحك الصافية");

    const reportsLink = await page.$("a[href*='reports'], nav a:has-text('التقارير')");
    if (reportsLink) {
      await animatedClick(page, reportsLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/reports", { waitUntil: "networkidle" });
    }
    await sleep(1400);
    await injectVisualHelpers(page);

    // Hover over 4 clean KPI Cards
    await moveMouseSmoothly(page, 460, 260, 20);
    await sleep(2000);
    await moveMouseSmoothly(page, 820, 260, 20);
    await sleep(2000);
    await moveMouseSmoothly(page, 1180, 260, 20);
    await sleep(2000);

    // Scroll to Monthly P&L table & chart
    await updateScene(page, "الخلاصة المالية وتصدير إكسيل", "بدون جداول معقدة ولا لخبطة محاسبية — كل مليم واضح قدام عينيك");
    await smoothScroll(page, 360);
    await sleep(2000);
    await moveMouseSmoothly(page, 780, 520, 20);
    await sleep(2500);

    await captureSnapshot(page, "frame_scene7_financial_reports");

    await smoothScroll(page, 0);
    await sleep(800);

    // Exact synchronization to Scene 8 start (147.8s)
    await syncToSecond(147.8);

    // =========================================================================
    // المشهد 8: الشاشة الختامية الأنيقة وهوية الشركة الأم (02:27.8 – 02:54.64) [26.84s]
    // =========================================================================
    console.log("🎬 SCENE 8: Grand Outro & Parent Company Signature (02:27.8 - 02:54.64)");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:radial-gradient(ellipse at 50% 40%, #0d1b3e 0%, #060914 100%);color:white;font-family:'Cairo',system-ui,sans-serif;direction:rtl;text-align:center;padding:40px;position:relative;overflow:hidden;box-sizing:border-box;">
          
          <!-- Ambient glowing background lights -->
          <div style="position:absolute;top:-50px;width:750px;height:750px;background:rgba(56, 189, 248, 0.12);border-radius:50%;filter:blur(140px);pointer-events:none;"></div>
          <div style="position:absolute;bottom:-120px;width:800px;height:500px;background:rgba(99, 102, 241, 0.14);border-radius:50%;filter:blur(150px);pointer-events:none;"></div>
          <div style="position:absolute;left:-80px;top:200px;width:400px;height:400px;background:rgba(34, 197, 94, 0.08);border-radius:50%;filter:blur(120px);pointer-events:none;"></div>

          <!-- Top Brand Signature Pill -->
          <div style="display:inline-flex;align-items:center;gap:12px;background:linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(99, 102, 241, 0.15));border:1.5px solid rgba(56, 189, 248, 0.4);padding:10px 32px;border-radius:9999px;font-size:18px;color:#38bdf8;font-weight:800;margin-bottom:20px;letter-spacing:0.8px;box-shadow:0 0 35px rgba(56, 189, 248, 0.25);">
            <span>⚡ تطوير وبرمجة:</span>
            <span style="color:#ffffff;font-weight:900;">شركة قُطب للحلول الرقمية</span>
            <span style="color:#818cf8;font-size:15px;letter-spacing:1px;font-family:sans-serif;">(KOTB Digital Solutions)</span>
          </div>

          <!-- Master Title -->
          <h1 style="font-size:96px;font-weight:900;margin:0 0 10px 0;background:linear-gradient(135deg, #38bdf8 0%, #818cf8 45%, #c084fc 80%, #34d399 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 20px 50px rgba(0,0,0,0.85);letter-spacing:2px;line-height:1.1;">
            GymGate
          </h1>

          <p style="font-size:25px;color:#cbd5e1;margin:0 0 32px 0;max-width:920px;line-height:1.5;font-weight:700;">
            بوابتك لإدارة رياضية ذكية، حماية أرباحك وخزينتك، وراحة بالك على مدار الساعة.
          </p>

          <!-- 4 Core Value Cards -->
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:16px;max-width:1200px;width:100%;margin-bottom:30px;">
            <div style="background:rgba(255,255,255,0.04);border:1.5px solid rgba(56, 189, 248, 0.3);padding:18px 20px;border-radius:18px;text-align:center;backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,0.4);">
              <div style="font-size:28px;margin-bottom:6px;">⚡</div>
              <div style="font-size:17px;color:#38bdf8;font-weight:800;margin-bottom:4px;">أوفلاين 100%</div>
              <div style="font-size:12px;color:#94a3b8;line-height:1.4;">يعمل بدون إنترنت نهائياً وبياناتك مشفرة ومحفوظة محلياً</div>
            </div>

            <div style="background:rgba(255,255,255,0.04);border:1.5px solid rgba(250, 204, 21, 0.3);padding:18px 20px;border-radius:18px;text-align:center;backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,0.4);">
              <div style="font-size:28px;margin-bottom:6px;">🔒</div>
              <div style="font-size:17px;color:#facc15;font-weight:800;margin-bottom:4px;">تقفيل الوردية Z-Report</div>
              <div style="font-size:12px;color:#94a3b8;line-height:1.4;">حساب النقدية بالقرش ومنع أي عجز أو تلاعب في الدرج</div>
            </div>

            <div style="background:rgba(255,255,255,0.04);border:1.5px solid rgba(34, 197, 94, 0.3);padding:18px 20px;border-radius:18px;text-align:center;backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,0.4);">
              <div style="font-size:28px;margin-bottom:6px;">📲</div>
              <div style="font-size:17px;color:#4ade80;font-weight:800;margin-bottom:4px;">كروت واتساب QR</div>
              <div style="font-size:12px;color:#94a3b8;line-height:1.4;">إرسال كارت ذكي فخم برمز QR على واتساب المشترك مباشرة</div>
            </div>

            <div style="background:rgba(255,255,255,0.04);border:1.5px solid rgba(192, 132, 252, 0.3);padding:18px 20px;border-radius:18px;text-align:center;backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,0.4);">
              <div style="font-size:28px;margin-bottom:6px;">🚀</div>
              <div style="font-size:17px;color:#c084fc;font-weight:800;margin-bottom:4px;">سرعة الذروة & Day Pass</div>
              <div style="font-size:12px;color:#94a3b8;line-height:1.4;">تسجيل حضور بثوانٍ وتذاكر زائر حر سريعة بدون تعطيل</div>
            </div>
          </div>

          <!-- Commercial Guarantee Strip -->
          <div style="display:flex;gap:24px;margin-bottom:30px;font-size:15px;color:#e2e8f0;font-weight:700;">
            <span style="display:flex;align-items:center;gap:6px;">💎 ترخيص دائم مدى الحياة (بدون اشتراك شهري)</span>
            <span style="color:#475569;">•</span>
            <span style="display:flex;align-items:center;gap:6px;">🛠️ ضمان شامل ودعم فني متواصل</span>
            <span style="color:#475569;">•</span>
            <span style="display:flex;align-items:center;gap:6px;">🧑‍🏫 تدريب كامل مجاني لفريق العمل</span>
          </div>

          <!-- Grand Call to Action Contact -->
          <div style="display:inline-flex;align-items:center;gap:18px;background:linear-gradient(135deg, rgba(34, 197, 94, 0.22), rgba(16, 185, 129, 0.22));border:2px solid rgba(34, 197, 94, 0.6);padding:16px 44px;border-radius:20px;box-shadow:0 0 45px rgba(34, 197, 94, 0.35);backdrop-filter:blur(10px);">
            <span style="font-size:32px;">📞</span>
            <div style="text-align:start;">
              <div style="font-size:14px;color:#86efac;font-weight:800;">للحجز والطلب المباشر وتنسيق المعاينة التجريبية:</div>
              <div dir="ltr" style="font-size:36px;font-weight:900;color:#ffffff;letter-spacing:2px;font-family:monospace;text-shadow:0 0 20px rgba(34,197,94,0.8);">
                01288536381
              </div>
            </div>
            <span style="background:#22c55e;color:#052e16;padding:8px 18px;border-radius:9999px;font-size:15px;font-weight:900;letter-spacing:0.5px;box-shadow:0 4px 15px rgba(34,197,94,0.5);">
              واتساب ومكالمات 24/7
            </span>
          </div>

        </div>
      `;
    });

    await captureSnapshot(page, "frame_scene8_outro_kotb_digital");

    // Hold outro until exactly the end of the audio track (174.64s)
    await syncToSecond(174.64);
    console.log("✅ Recording timeline completed exactly at 174.64s!");
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // Find the generated webm
  const webmFiles = fs.readdirSync(RECORDINGS_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ name: f, time: fs.statSync(path.join(RECORDINGS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (webmFiles.length === 0) {
    throw new Error("No webm recording found in recordings directory!");
  }

  const rawWebmPath = path.join(RECORDINGS_DIR, webmFiles[0].name);
  console.log(`🎬 Transcoding & Merging Video + Voiceover into:\n${OUTPUT_MP4}`);

  // Merge video and voiceover perfectly with FFmpeg
  const ffmpegCmd = `ffmpeg -y -i "${rawWebmPath}" -i "${VOICEOVER_WAV}" -c:v libx264 -preset fast -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -shortest "${OUTPUT_MP4}"`;
  execSync(ffmpegCmd, { stdio: "inherit" });

  fs.copyFileSync(OUTPUT_MP4, DESKTOP_MP4);
  console.log(`🎉 Master Video Showcase successfully generated and copied to Desktop:\n${DESKTOP_MP4}`);
}

runMasterCommercial().catch((err) => {
  console.error("❌ Master commercial recording failed:", err);
  process.exit(1);
});
