const { chromium } = require("playwright");

(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:8890");
  await p.waitForTimeout(1000);
  await p.fill("input[autocomplete='username'], input[type='text']", "owner");
  await p.fill("#login-password, input[type='password']", "owner1234");
  await p.click("button[type='submit']");
  await p.waitForTimeout(2000);

  // Navigate via clicking on the sidebar item "الاستقبال"
  const attendanceLink = await p.$("a[href*='attendance'], nav a:has-text('الاستقبال')");
  console.log("Found attendance link in sidebar:", !!attendanceLink);
  if (attendanceLink) {
    await attendanceLink.click();
    await p.waitForTimeout(1500);
  } else {
    await p.goto("http://127.0.0.1:8890/#/attendance");
  }

  // Target the exact input inside main:
  const attendanceSearchInput = await p.$("main input[data-scanner-input='true']");
  console.log("Found attendance search input inside page:", !!attendanceSearchInput);

  if (attendanceSearchInput) {
    const box = await attendanceSearchInput.boundingBox();
    console.log("Box coordinates:", box);
    await attendanceSearchInput.click();
    await attendanceSearchInput.fill("B1-CRD-000001");
    await p.waitForTimeout(500);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(2500);

    // Check what is rendered
    const successCard = await p.$eval("main", (el) => el.innerText);
    console.log(
      "Main text after search (first 300 chars):",
      successCard.slice(0, 300).replace(/\n+/g, " "),
    );
  }

  await b.close();
})();
