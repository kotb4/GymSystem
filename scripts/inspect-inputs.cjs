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
  await p.goto("http://127.0.0.1:8890/#/attendance");
  await p.waitForTimeout(1500);

  const inputs = await p.$$eval("input", (els) =>
    els.map((el) => ({
      placeholder: el.placeholder,
      scanner: el.getAttribute("data-scanner-input"),
      y: el.getBoundingClientRect().y,
      x: el.getBoundingClientRect().x,
    })),
  );
  console.log("Inputs found on attendance page:\n", JSON.stringify(inputs, null, 2));
  await b.close();
})();
