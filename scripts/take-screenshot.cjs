const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto("http://127.0.0.1:8890");
  await p.waitForTimeout(1000);
  await p.fill("input[autocomplete='username'], input[type='text']", "owner");
  await p.fill("#login-password, input[type='password']", "owner1234");
  await p.click("button[type='submit']");
  await p.waitForTimeout(2000);

  await p.goto("http://127.0.0.1:8890/#/attendance");
  await p.waitForTimeout(2500);

  const screenshotPath = path.resolve(
    __dirname,
    "../screenshot_attendance_fixed.png",
  );
  await p.screenshot({ path: screenshotPath, fullPage: false });
  console.log("Screenshot saved to:", screenshotPath);

  await b.close();
})();
