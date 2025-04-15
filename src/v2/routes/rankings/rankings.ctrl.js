const { User } = require("../../../models/User/User");
const { Group } = require("../../../models/Group/Group");
const logger = require("../../../../logger");

const get = {
  usersScore: async (req, res) => {
    try {
      const users = await User.find({})
        .select("-_id name handle tier score imgSrc")
        .lean();

      const result = users
        .map((user) => ({
          name: user.name,
          handle: user.handle,
          score: user.score,
          imgSrc: user.imgSrc,
        }))
        .sort((a, b) => b.score - a.score);

      return res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      logger.error(error);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  usersCount: async (req, res) => {
    try {
      const users = await User.find({})
        .select("-_id name handle tier count imgSrc")
        .lean();

      const result = users
        .map((user) => ({
          name: user.name,
          handle: user.handle,
          count: user.count,
          imgSrc: user.imgSrc,
        }))
        .sort((a, b) => b.count - a.count);

      return res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      logger.error(error);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  usersStreak: async (req, res) => {
    try {
      const users = await User.find({})
        .select("-_id name handle tier maxStreak imgSrc")
        .lean();

      const result = users
        .map((user) => ({
          name: user.name,
          handle: user.handle,
          streak: user.maxStreak,
          imgSrc: user.imgSrc,
        }))
        .sort((a, b) => b.streak - a.streak);

      return res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      logger.error(error);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  groupsScore: async (req, res) => {
    try {
      const groups = await Group.find({})
        .select("groupName handle tier score currentStreak maxStreak")
        .lean();

      const result = groups
        .map((group) => ({
          _id: group._id,
          groupName: group.groupName,
          score: group.score,
        }))
        .sort((a, b) => b.score - a.score);

      return res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      logger.error(error);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  groupsCount: async (req, res) => {
    try {
      const groups = await Group.find({})
        .select("groupName handle tier count currentStreak maxStreak")
        .lean();

      const result = groups
        .map((group) => ({
          _id: group._id,
          groupName: group.groupName,
          count: group.count,
        }))
        .sort((a, b) => b.count - a.count);

      return res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      logger.error(error);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  groupsStreak: async (req, res) => {
    try {
      const groups = await Group.find({})
        .select("groupName handle tier score currentStreak maxStreak")
        .lean();

      const result = groups
        .map((group) => ({
          _id: group._id,
          groupName: group.groupName,
          maxStreak: group.maxStreak,
        }))
        .sort((a, b) => b.maxStreak - a.maxStreak);

      return res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      logger.error(error);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  groupsMain: async (req, res) => {
    const groups = await Group.find({})
      .select("groupName _id description score maxStreak size")
      .lean();

    const score = groups.sort((a, b) => b.score - a.score).slice(0, 3);

    const streak = groups.sort((a, b) => b.maxStreak - a.maxStreak).slice(0, 3);

    return res.status(200).json({
      success: true,
      score,
      streak,
    });
  },
};

module.exports = {
  get,
};
