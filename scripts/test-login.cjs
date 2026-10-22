const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8890");
  await page.waitForTimeout(1000);

  const userInput = await page.$("input[autocomplete='username'], input[type='text']");
  if (userInput) {
    await userInput.fill("owner");
    const passInput = await page.$("#login-password, input[type='password']");
    await passInput.fill("owner1234");
    await page.click("button[type='submit']");
    await page.waitForTimeout(2500);
  }

  console.log("Logged in URL:", page.url());
  await page.goto("http://127.0.0.1:8890/#/attendance");
  await page.waitForTimeout(1500);
  console.log("Attendance URL:", page.url());
  const header = await page.$eval("h1, h2", (el) => el.textContent).catch(() => "none");
  console.log("Heading on attendance:", header);

  await browser.close();
})().catch(console.error);
