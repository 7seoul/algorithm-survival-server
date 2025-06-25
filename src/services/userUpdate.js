const { User } = require("../models/User/User");
const { Group } = require("../models/Group/Group");
const { MemberData } = require("../models/Group/MemberData");
const { conversionScore } = require("../utils/calculator");
const scrap = require("../apis/scrap");
const solvedac = require("../apis/solvedac");
const logger = require("../../logger");
const timer = require("../utils/timer");

const userUpdateCore = async (handle, profile) => {
  const initUser = await User.findOne({ handle: handle });

  let down = 0;
  let newStreak = initUser.initialStreak;
  if (initUser.initialStreak > profile.streak) {
    down = 1;
    newStreak = profile.streak;
  }

  const scrapScore = conversionScore(profile.current);
  const initScore = conversionScore(initUser.initial);
  const totalScore = scrapScore - initScore;

  const updateFields = {
    initialStreak: newStreak,
    currentStreak: profile.streak,
    currentCount: profile.solvedCount,
    score: totalScore,
    count: profile.solvedCount - initUser.initialCount,
    current: profile.current,
    imgSrc: profile.profileImageUrl,
    tier: profile.tier,
  };

  // maxStreak 갱신 조건
  if (
    !initUser.maxStreak ||
    profile.streak - initUser.initialStreak > initUser.maxStreak
  ) {
    updateFields.maxStreak = profile.streak - initUser.initialStreak;
  }

  const saved = await User.findOneAndUpdate(
    { handle: handle },
    { $set: updateFields },
    { new: true }
  )
    .select("-__v -password -token")
    .populate("joinedGroupList", "groupName _id memberData score count");

  logger.info(`[UPDATE CORE] "${handle}" profile updated`);

  const groups = saved.joinedGroupList;
  // 그룹에 유저 업데이트 정보 반영
  for (let group of groups) {
    const member = await MemberData.findOne({
      user: initUser._id,
      _id: { $in: group.memberData },
    });

    const newCount = profile.solvedCount - member.initialCount;
    const memberScore = conversionScore(member.initial);
    const newScore = scrapScore - memberScore;

    // 유저 정보 업데이트
    const memberUpdateResult = await MemberData.updateOne(
      {
        _id: member._id,
      },
      {
        $set: {
          initialStreak: newStreak,
          count: newCount,
          score: newScore,
        },
        $inc: {
          downs: down,
        },
      }
    );

    const allMembers = await MemberData.find({
      _id: { $in: group.memberData },
    }).select("score count");

    const groupScore = allMembers.reduce((sum, m) => sum + (m.score || 0), 0);
    const groupCount = allMembers.reduce((sum, m) => sum + (m.count || 0), 0);

    // 그룹 점수 업데이트
    if (memberUpdateResult.modifiedCount > 0) {
      const updatedGroup = await Group.findByIdAndUpdate(
        group._id,
        {
          $set: {
            score: groupScore,
            count: groupCount,
          },
          $addToSet: {
            todaySolvedMembers: initUser._id,
          },
        },
        { new: true }
      ).select(
        "todayAllSolved todaySolvedMembers currentStreak maxStreak size"
      );

      const totalMembers = updatedGroup.size;
      const solvedCount = updatedGroup.todaySolvedMembers.length;

      if (solvedCount === totalMembers && !updatedGroup.todayAllSolved) {
        // streak 증가
        const newGroupStreak = updatedGroup.currentStreak + 1;
        const newMaxStreak = Math.max(newGroupStreak, updatedGroup.maxStreak);

        await Group.findByIdAndUpdate(group._id, {
          $set: {
            currentStreak: newGroupStreak,
            maxStreak: newMaxStreak,
            todayAllSolved: true,
          },
        });

        logger.info(`[UPDATE CORE] 그룹 "${group.groupName}" streak 증가`);
      }
    }
  }
  return saved;
};

const userUpdateByScrap = async (handle) => {
  const label = `[USE SCRAP] "${handle}"`;
  timer.start(label);
  const profile = await scrap.profile(handle);
  timer.end(label, logger);

  if (profile.success === true) {
    try {
      // 코어
      return await userUpdateCore(handle, profile);
    } catch (error) {
      logger.error(`[USE SCRAP] "${handle}" Error updating user:`, error);
    }
  } else {
    logger.warn(`[USE SCRAP] "${handle}" FAIL TO SCRAPING.`);
  }
};

const userUpdateBySolvedac = async (handle) => {
  const label = `[USE SOLVEDAC API] "${handle}"`;
  timer.start(label);
  const profile = await solvedac.profile(handle);
  const streak = await solvedac.grass(handle);
  const current = await solvedac.problem(handle);
  profile.streak = await streak;
  profile.current = await current;
  timer.end(label, logger);

  if (profile && streak !== undefined) {
    try {
      // 코어
      return await userUpdateCore(handle, profile);
    } catch (error) {
      logger.error(
        `[USE SOLVEDAC API] "${handle}" Error updating user:`,
        error
      );
    }
  } else {
    logger.warn(`[USE SOLVEDAC API] "${handle}" FAIL TO SCRAPING.`);
  }
};

module.exports = {
  userUpdateByScrap,
  userUpdateBySolvedac,
};
