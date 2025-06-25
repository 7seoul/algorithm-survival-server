const { Group } = require("../models/Group/Group");
const cron = require("node-cron");
const logger = require("../../logger");

const initGroupResetJob = async () => {
  // 매일 오전 6시에 실행
  cron.schedule(
    "0 6 * * *",
    async () => {
      try {
        await Group.updateMany(
          { isEnd: false },
          {
            $set: {
              todaySolvedMembers: [],
              todayAllSolved: false,
            },
          }
        );
        logger.info(
          "[CRON] 그룹 todaySolvedMembers, todayAllSolved 초기화 완료"
        );
      } catch (error) {
        logger.error(`[CRON] 그룹 초기화 실패: ${error}`);
      }
    },
    {
      timezone: "Asia/Seoul",
    }
  );

  logger.info("[CRON] 그룹 초기화 스케줄러 등록 완료");
};

module.exports = { initGroupResetJob };
