const { User } = require("../models/User/User");
const { Group } = require("../models/Group/Group");

const userRank = async (user) => {
  const userIdStr = user._id.toString();

  const [usersScore, usersCount, usersStreak] = await Promise.all([
    User.find({}).sort({ score: -1 }).select("_id").lean(),
    User.find({}).sort({ count: -1 }).select("_id").lean(),
    User.find({}).sort({ maxStreak: -1 }).select("_id").lean(),
  ]);

  const scoreRank =
    usersScore.findIndex((u) => u._id.toString() === userIdStr) + 1;
  const countRank =
    usersCount.findIndex((u) => u._id.toString() === userIdStr) + 1;
  const streakRank =
    usersStreak.findIndex((u) => u._id.toString() === userIdStr) + 1;

  user.scoreRank = scoreRank;
  user.countRank = countRank;
  user.streakRank = streakRank;

  return user;
};

const groupRank = async (group) => {
  const groupIdStr = group._id.toString();

  const [groupsScore, groupsCount, groupsStreak] = await Promise.all([
    Group.find({}).sort({ score: -1 }).select("_id").lean(),
    Group.find({}).sort({ count: -1 }).select("_id").lean(),
    Group.find({}).sort({ maxStreak: -1 }).select("_id").lean(),
  ]);

  const scoreRank =
    groupsScore.findIndex((u) => u._id.toString() === groupIdStr) + 1;
  const countRank =
    groupsCount.findIndex((u) => u._id.toString() === groupIdStr) + 1;
  const streakRank =
    groupsStreak.findIndex((u) => u._id.toString() === groupIdStr) + 1;

  group.scoreRank = scoreRank;
  group.countRank = countRank;
  group.streakRank = streakRank;

  return group;
};

module.exports = {
  userRank,
  groupRank,
};
