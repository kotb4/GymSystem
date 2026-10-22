const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RECORDINGS_DIR = path.resolve(__dirname, "../recordings");
const OUTPUT_MP4 = path.join(RECORDINGS_DIR, "GymGate_Master_Commercial_Showcase.mp4");
const DESKTOP_MP4 = "C:\\Users\\KOTB\\Desktop\\GymGate_Master_Commercial_Showcase.mp4";
const VOICEOVER_WAV = "C:\\Users\\KOTB\\.gemini\\antigravity\\brain\\24544496-ce86-4841-8fcf-092d64789551\\.user_uploaded\\uploaded_media_1792550787235.wav";

if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let VIDEO_START_TIME = Date.now();

async function syncToSecond(targetSec) {
  const elapsed = (Date.now() - VIDEO_START_TIME) / 1000;
  const waitMs = Math.round((targetSec - elapsed) * 1000);
  if (waitMs > 10) {
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
    await page.keyboard.type(char, { delay: 40 + Math.random() * 30 });
  }
  await sleep(150);
}

async function runMasterShowcase() {
  console.log("🌟 Seeding fresh realistic showcase data before recording...");
  execSync("node scripts/seed-rich-showcase-data.cjs", { stdio: "inherit" });

  console.log("🚀 Launching Edge for Full HD Master Video Recording (1920x1080)...");
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
    // المشهد 1: المقدمة ولوحة التحكم الذكية (00:00 – 00:33.4) [33.4s]
    // =========================================================================
    console.log("🎬 SCENE 1: Introduction & Smart Dashboard");
    await page.goto("http://127.0.0.1:8890/#/login", { waitUntil: "networkidle" });
    await injectVisualHelpers(page);
    await updateScene(page, "GymGate", "نظام إدارة الصالات الرياضية الذكي — تحكم كامل وراحة بال");

    // Move to username and type 'owner'
    await sleep(1500);
    const userInput = await page.$("input[autocomplete='username'], input[type='text']");
    if (userInput) {
      await updateScene(page, "تسجيل الدخول", "دخول سريع ومحمي بأعلى معايير الأمان");
      await animatedType(page, "input[autocomplete='username'], input[type='text']", "owner");
      await sleep(400);

      const passInput = await page.$("input[type='password']");
      if (passInput) {
        await animatedType(page, "input[type='password']", "owner1234");
      }
      await sleep(400);
      await animatedClick(page, "button[type='submit']");
      await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
      await sleep(1000);
      await injectVisualHelpers(page);
    } else {
      await page.goto("http://127.0.0.1:8890/#/", { waitUntil: "networkidle" });
      await injectVisualHelpers(page);
    }

    // Dashboard Overview (11.0s – 19.4s)
    await updateScene(page, "لوحة التحكم", "نظرة شاملة ومؤشرات أداء حية — الإيرادات، الأرباح، والأعضاء النشطين");
    await moveMouseSmoothly(page, 460, 240, 22);
    await sleep(2500);
    await moveMouseSmoothly(page, 820, 240, 22);
    await sleep(2500);
    await moveMouseSmoothly(page, 1180, 240, 22);
    await sleep(2500);

    // Scroll down to show analytics and system health (19.4s – 33.4s)
    await smoothScroll(page, 400);
    await sleep(1000);
    await moveMouseSmoothly(page, 720, 560, 20);
    await sleep(3500);

    // Highlight System Health Card
    await updateScene(page, "صحة وأمان النظام", "مراقبة مستمرة، نسخ احتياطي محلي، واستقرار تام");
    await moveMouseSmoothly(page, 1420, 520, 22);
    await sleep(3000);

    await smoothScroll(page, 0);
    await sleep(1000);

    // Exact synchronization to Scene 2 start (33.4s)
    await syncToSecond(33.4);

    // =========================================================================
    // المشهد 2: سرعة الاستقبال ومسح الباركود (00:33.4 – 01:03.9) [30.5s]
    // =========================================================================
    console.log("🎬 SCENE 2: Reception & Barcode Scan");
    await updateScene(page, "الاستقبال والحضور", "تسجيل حضور سريع في أجزاء من الثانية ومنع التكرار تلقائياً");

    const receptionLink = await page.$("a[href*='attendance'], nav a:has-text('الاستقبال')");
    if (receptionLink) {
      await animatedClick(page, receptionLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/attendance", { waitUntil: "networkidle" });
    }
    await sleep(1500);
    await injectVisualHelpers(page);

    // Scanner input focus & scan (40.6s)
    const barcodeInput = await page.$("input[data-scanner-input='true']");
    if (barcodeInput) {
      await animatedClick(page, barcodeInput);
      await sleep(400);
      await animatedType(page, "input[data-scanner-input='true']", "B1-CRD-000001");
      await sleep(300);
      await page.keyboard.press("Enter");
      await sleep(2000);
    }

    // Green member card is displayed
    await updateScene(page, "عضوية معتمدة", "ظهور فوري لبيانات العضو، الاشتراك الفعال، الرصيد، والصورة");
    await moveMouseSmoothly(page, 650, 420, 22);
    await sleep(4500);

    // Scroll down to Live Occupants table
    await updateScene(page, "المتواجدون حالياً", "متابعة دقيقة وفورية للمتدربين داخل الصالة الرياضية الآن");
    await smoothScroll(page, 380);
    await sleep(1000);
    await moveMouseSmoothly(page, 750, 580, 20);
    await sleep(4000);

    await smoothScroll(page, 0);
    await sleep(1000);

    // Exact synchronization to Scene 3 start (63.9s)
    await syncToSecond(63.9);

    // =========================================================================
    // المشهد 3: تذكرة اليوم الواحد السريعة (01:03.9 – 01:21.5) [17.6s]
    // =========================================================================
    console.log("🎬 SCENE 3: Quick Day Pass Ticket");
    await updateScene(page, "تذكرة اليوم الواحد", "تسجيل الزائر السريع بضغطة زر واحدة (Day Pass) وتحصيل النقدية");

    // Press F3 or click Day Pass button
    await animatedClick(page, "button:has-text('Day Pass'), button:has-text('تذكرة يوم'), button:has-text('يومي')");
    await sleep(1200);
    await injectVisualHelpers(page);

    // Type guest name
    const guestInput = await page.$("input[placeholder*='اسم']");
    if (guestInput) {
      await animatedType(page, "input[placeholder*='اسم']", "محمود شريف (زائر)");
      await sleep(800);
    }

    // Submit Day Pass
    const submitDayPassBtn = await page.$(".modal button[type='submit'], [role='dialog'] button[type='submit']");
    if (submitDayPassBtn) {
      await animatedClick(page, submitDayPassBtn);
      await sleep(2000);
    } else {
      await page.keyboard.press("Escape");
      await sleep(1000);
    }

    // Exact synchronization to Scene 4 start (81.5s)
    await syncToSecond(81.5);

    // =========================================================================
    // المشهد 4: المشتركون، الاشتراكات، والتجميد الذكي (01:21.5 – 01:58.8) [37.3s]
    // =========================================================================
    console.log("🎬 SCENE 4: Members Directory, Profiles & Subscriptions");
    await updateScene(page, "إدارة المشتركين", "ملفات الأعضاء الرقمية — بحث بالاسم أو الهاتف والوصول لملف العضو");

    const membersLink = await page.$("a[href*='members'], nav a:has-text('المشتركون')");
    if (membersLink) {
      await animatedClick(page, membersLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/members", { waitUntil: "networkidle" });
    }
    await sleep(1500);
    await injectVisualHelpers(page);

    // Table search
    const searchInput = await page.$("input[placeholder*='بحث'], input[type='search'], input[type='text']");
    if (searchInput) {
      await animatedType(page, "input[placeholder*='بحث'], input[type='search'], input[type='text']", "الشناوي");
      await sleep(1200);
    }

    // Click member profile link
    const memberLink = await page.$("table a:has-text('الشناوي'), a[href*='members/mem-01']");
    if (memberLink) {
      await animatedClick(page, memberLink);
      await sleep(2000);
      await injectVisualHelpers(page);

      // Scroll inside profile to show InBody and History
      await updateScene(page, "ملف العضو الشامل", "سجل الحضور، المدفوعات، الباقات الفعالة، وقياسات InBody");
      await smoothScroll(page, 320);
      await sleep(2500);
      await moveMouseSmoothly(page, 680, 480, 20);
      await sleep(2000);
      await smoothScroll(page, 0);
      await sleep(1000);
    }

    // Navigate to Subscriptions
    await updateScene(page, "باقات الاشتراكات والتجميد", "باقات مرنة ونظام التجميد الذكي بقرار فوري يحمي الأيام");
    const subsLink = await page.$("a[href*='subscriptions'], nav a:has-text('الاشتراكات')");
    if (subsLink) {
      await animatedClick(page, subsLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/subscriptions", { waitUntil: "networkidle" });
    }
    await sleep(1500);
    await injectVisualHelpers(page);

    // Glide across subscription packages
    await moveMouseSmoothly(page, 460, 360, 20);
    await sleep(2500);
    await moveMouseSmoothly(page, 880, 360, 20);
    await sleep(2500);

    // Exact synchronization to Scene 5 start (118.8s)
    await syncToSecond(118.8);

    // =========================================================================
    // المشهد 5: متجر المكملات ونقاط البيع السريعة POS (01:58.8 – 02:28.0) [29.2s]
    // =========================================================================
    console.log("🎬 SCENE 5: Store POS & Debt Handling");
    await updateScene(page, "متجر المكملات POS", "نقطة بيع سريعة للمكملات والبار — بيع نقدي أو آجل على حساب المشترك");

    const storeLink = await page.$("a[href*='store'], nav a:has-text('المتجر')");
    if (storeLink) {
      await animatedClick(page, storeLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/store", { waitUntil: "networkidle" });
    }
    await sleep(1500);
    await injectVisualHelpers(page);

    // Click product 1 (Protein bar)
    const product1 = await page.$("button:has-text('بروتين bar'), button:has-text('بروتين بار'), button:has-text('جولد ستاندرد')");
    if (product1) {
      await animatedClick(page, product1);
      await sleep(1200);
    }

    // Click product 2 (Energy drink)
    const product2 = await page.$("button:has-text('مشروب طاقة'), button:has-text('مياه معدنية'), button:has-text('كرياتين')");
    if (product2) {
      await animatedClick(page, product2);
      await sleep(1500);
    }

    // Show Cart and checkout options
    await updateScene(page, "سلة المشتريات والائتمان", "خصم لحظي من المخزون، ودعم البيع الآجل بحساب المشترك وسداد فوري");
    await moveMouseSmoothly(page, 1420, 380, 22);
    await sleep(4000);
    await moveMouseSmoothly(page, 1420, 620, 20);
    await sleep(3500);

    // Exact synchronization to Scene 6 start (148.0s)
    await syncToSecond(148.0);

    // =========================================================================
    // المشهد 6: الخزينة والورديات وحماية الفلوس (02:28.0 – 02:57.3) [29.3s]
    // =========================================================================
    console.log("🎬 SCENE 6: Treasury & Shift Handover");
    await updateScene(page, "الخزينة والورديات", "حماية أموال الصالة — إغلاق الورديات بالثانية ومطابقة العهدة النقدية");

    const treasuryLink = await page.$("a[href*='treasury'], a[href*='cash'], nav a:has-text('الخزينة')");
    if (treasuryLink) {
      await animatedClick(page, treasuryLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/treasury", { waitUntil: "networkidle" });
    }
    await sleep(1500);
    await injectVisualHelpers(page);

    // Hover over current cash summary
    await moveMouseSmoothly(page, 480, 260, 20);
    await sleep(2500);

    // Scroll to ledger transactions
    await updateScene(page, "دفتر الأستاذ المالي المشفر", "تسجيل محاسبي صارم غير قابل للتعديل لكل حركة نقدية");
    await smoothScroll(page, 340);
    await sleep(1500);
    await moveMouseSmoothly(page, 780, 480, 20);
    await sleep(4500);

    await smoothScroll(page, 0);
    await sleep(1500);

    // Exact synchronization to Scene 7 start (177.3s)
    await syncToSecond(177.3);

    // =========================================================================
    // المشهد 7: كروت الواتساب الرقمية وقوة العمل أوفلاين (02:57.3 – 03:27.6) [30.3s]
    // =========================================================================
    console.log("🎬 SCENE 7: Digital WhatsApp Cards & 100% Offline Power");
    await updateScene(page, "كروت الواتساب الرقمية", "إرسال كارت رقمي ذكي برمز QR للمشترك عبر واتساب تلقائياً");

    const cardsLink = await page.$("a[href*='cards'], nav a:has-text('الكروت')");
    if (cardsLink) {
      await animatedClick(page, cardsLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/cards", { waitUntil: "networkidle" });
    }
    await sleep(1500);
    await injectVisualHelpers(page);

    // Open QR Delivery Modal
    const sendCardBtn = await page.$("table tbody tr button:has(svg.lucide-send), table tbody tr button[aria-label*='إرسال'], table tbody tr button[aria-label*='QR']");
    if (sendCardBtn) {
      await animatedClick(page, sendCardBtn);
      await sleep(4000);
      await page.keyboard.press("Escape");
      await sleep(1200);
    }

    // Navigate to Settings to show Offline Architecture & Backup
    await updateScene(page, "أمان واستقرار أوفلاين 100%", "يعمل بدون إنترنت تماماً، وقاعدة بياناتك مشفرة ومحفوظة بنسخ فوري");
    const settingsLink = await page.$("a[href*='settings'], nav a:has-text('الإعدادات')");
    if (settingsLink) {
      await animatedClick(page, settingsLink);
    } else {
      await page.goto("http://127.0.0.1:8890/#/settings", { waitUntil: "networkidle" });
    }
    await sleep(1500);
    await injectVisualHelpers(page);

    // Scroll to Backup Section
    await smoothScroll(page, 380);
    await sleep(1500);
    await moveMouseSmoothly(page, 820, 520, 20);
    await sleep(3500);

    // Exact synchronization to Scene 8 start (207.6s)
    await syncToSecond(207.6);

    // =========================================================================
    // المشهد 8: الشاشة الختامية الأنيقة (03:27.6 – 03:43.6) [16.0s]
    // =========================================================================
    console.log("🎬 SCENE 8: Outro & Brand Signature");
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:radial-gradient(circle at center, #0e172a 0%, #070a13 100%);color:white;font-family:'Cairo',system-ui,sans-serif;direction:rtl;text-align:center;padding:40px;position:relative;overflow:hidden;">
          <div style="position:absolute;width:600px;height:600px;background:rgba(56, 189, 248, 0.08);border-radius:50%;filter:blur(120px);pointer-events:none;"></div>
          <div style="position:absolute;bottom:-100px;width:700px;height:400px;background:rgba(129, 140, 248, 0.08);border-radius:50%;filter:blur(140px);pointer-events:none;"></div>
          
          <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(56, 189, 248, 0.12);border:1.5px solid rgba(56, 189, 248, 0.35);padding:10px 28px;border-radius:9999px;font-size:17px;color:#38bdf8;font-weight:800;margin-bottom:28px;letter-spacing:0.8px;box-shadow:0 0 35px rgba(56, 189, 248, 0.25);">
            ⚡ النظام الأذكى والأقوى لإدارة الصالات الرياضية
          </div>
          
          <h1 style="font-size:92px;font-weight:900;margin:0 0 16px 0;background:linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 15px 40px rgba(0,0,0,0.8);letter-spacing:1.5px;">
            GymGate
          </h1>
          
          <p style="font-size:26px;color:#cbd5e1;margin:0 0 36px 0;max-width:850px;line-height:1.6;font-weight:600;">
            بوابتك لإدارة رياضية ذكية، حماية أرباحك، وراحة بالك على مدار الساعة.
          </p>
          
          <div style="display:flex;gap:20px;margin-bottom:44px;flex-wrap:wrap;justify-content:center;">
            <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);padding:14px 26px;border-radius:14px;font-size:18px;color:#f8fafc;font-weight:700;backdrop-blur:10px;box-shadow:0 10px 25px rgba(0,0,0,0.4);">
              ⚡ يعمل أوفلاين 100% بدون إنترنت
            </div>
            <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);padding:14px 26px;border-radius:14px;font-size:18px;color:#f8fafc;font-weight:700;backdrop-blur:10px;box-shadow:0 10px 25px rgba(0,0,0,0.4);">
              🔒 حماية كاملة للخزينة والورديات
            </div>
            <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);padding:14px 26px;border-radius:14px;font-size:18px;color:#f8fafc;font-weight:700;backdrop-blur:10px;box-shadow:0 10px 25px rgba(0,0,0,0.4);">
              📲 كروت واتساب الذكية برمز QR
            </div>
          </div>

          <div style="display:inline-flex;align-items:center;gap:12px;background:rgba(34, 197, 94, 0.12);border:1.5px solid rgba(34, 197, 94, 0.4);padding:12px 32px;border-radius:14px;font-size:20px;color:#4ade80;font-weight:800;letter-spacing:1px;box-shadow:0 0 30px rgba(34, 197, 94, 0.2);">
            📞 تواصل معنا الآن: 01288536381
          </div>
        </div>
      `;
    });

    // Hold outro until exactly the end of the audio track (223.56s)
    await syncToSecond(223.56);
    console.log("✅ Recording timeline completed exactly at 223.56s!");
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

runMasterShowcase().catch((err) => {
  console.error("❌ Master recording failed:", err);
  process.exit(1);
});
