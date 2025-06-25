const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const { tierList } = require("../utils/tier");
const logger = require("../../logger");

const PQueue = require("p-queue").default;
const queue = new PQueue({ concurrency: 5 });
const MAX_USAGE = 100;

let browserInstance;
let usageCount = 0;
let initializing = null;

const initBrowser = async () => {
  if (
    browserInstance &&
    browserInstance.isConnected() &&
    usageCount < MAX_USAGE
  ) {
    usageCount++;
    return browserInstance;
  }

  if (!initializing) {
    initializing = (async () => {
      if (browserInstance) {
        try {
          await browserInstance.close();
          logger.info("Old browser closed.");
        } catch (error) {
          logger.error(`Failed to close browser: ${error}`);
        }
      }

      logger.info("Initializing new browser...");
      browserInstance = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      usageCount = 0;
      initializing = null;
      return browserInstance;
    })();
  }

  await initializing;
  usageCount++;
  return browserInstance;
};

const profile = async (handle) => {
  return queue.add(async () => {
    let page;
    try {
      const browser = await initBrowser();
      page = await browser.newPage();

      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const resourceType = request.resourceType();
        if (["image", "font", "media"].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      try {
        await page.goto(
          `https://solved.ac/profile/${encodeURIComponent(handle)}`,
          {
            waitUntil: "networkidle0",
            timeout: 30000,
          }
        );
      } catch (timeoutError) {
        logger.warn("Timeout occurred, proceeding with current page state...");
      }

      // 버튼 클릭
      await page.click("button.css-1u44z18");

      const html = await page.content();
      const $ = cheerio.load(html);

      // tier
      const tier = $("img.css-19222jw").first().attr("alt") || undefined;

      // img
      const profileImageUrl =
        $("img.css-1q631t7").first().attr("src") || undefined;

      // solved
      const solvedElement = $(`a[href="/profile/${handle}/solved"]`).first();
      const solvedCount = solvedElement.length
        ? parseInt(solvedElement.find("b").text().replace(/,/g, ""), 10)
        : undefined;

      // streak
      const streakElement = $(
        "#__next > div.css-axxp2y > div > div > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div > div > b"
      );
      const streakText = streakElement.text();
      const streak = streakText
        ? parseInt(streakText.replace(/,/g, ""), 10)
        : undefined;

      // level
      const current = new Array(31).fill(0);

      $("table tbody tr").each((i, tr) => {
        if (i >= 31) return false;

        const $tds = $(tr).find("td");
        const countText = $tds.eq(1).find("b").text().trim().replace(/,/g, "");
        const count = parseInt(countText, 10);
        current[i] = isNaN(count) ? 0 : count;
      });

      const success =
        tier !== undefined &&
        solvedCount !== undefined &&
        profileImageUrl !== undefined &&
        streak !== undefined;

      return {
        success,
        tier: tier ? tierList[tier] : undefined,
        solvedCount,
        profileImageUrl,
        streak,
        current,
      };
    } catch (error) {
      logger.error(`Failed to scrape profile: ${error}`);
      return { success: false };
    } finally {
      if (page && !page.isClosed?.()) {
        try {
          await page.close();
        } catch (error) {
          logger.error(`Page close failed: ${error}`);
        }
      }
    }
  });
};

// 브라우저 종료
const closeBrowser = async () => {
  if (browserInstance && browserInstance.isConnected()) {
    await browserInstance.close();
    browserInstance = null;
    logger.info("Browser closed.");
  }
};

module.exports = {
  profile,
  closeBrowser,
};
