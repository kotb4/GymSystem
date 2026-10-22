const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8890/#/login", { waitUntil: "networkidle" });
  await page.fill("input[autocomplete='username']", "owner");
  await page.fill("input[type='password']", "owner1234");
  await page.click("button[type='submit']");
  await page.waitForTimeout(1000);

  await page.goto("http://127.0.0.1:8890/#/cards", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Look for Send icon button in table row
  const sendBtn = await page.$("table tbody tr button:has(svg.lucide-send), table tbody tr button[aria-label*='إرسال'], table tbody tr button[aria-label*='QR'], table tbody tr button[aria-label*='Send']");
  console.log("Send button found in cards table:", !!sendBtn);
  if (sendBtn) {
    await sendBtn.click();
    await page.waitForTimeout(1000);
    const modalText = await page.evaluate(() => document.body.innerText);
    console.log("Modal contains 'WhatsApp' or 'QR':", modalText.includes("WhatsApp") || modalText.includes("واتساب") || modalText.includes("QR"));
  }

  await browser.close();
})();
