const { User } = require("../../../models/User/User");
const { Group } = require("../../../models/Group/Group");
const { MemberData } = require("../../../models/Group/MemberData");
const { Counter } = require("../../../models/Counter/Counter");
const { userUpdateBySolvedac } = require("../../../services/userUpdate");
const { checkRole } = require("../../../utils/checkRole");
const { formatDate } = require("../../../utils/formatDate");
const { groupRank } = require("../../../utils/checkRank");
const logger = require("../../../../logger");

const GROUP_LIMIT = 5;
const MEMBER_LIMIT = 30;

const get = {
  all: async (req, res) => {
    try {
      const groups = await Group.find({}).select(
        "groupName _id description score count maxStreak size"
      );
      return res.status(200).json({
        success: true,
        groups,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  info: async (req, res) => {
    try {
      const { groupId } = req.params;
      let token = req.cookies.token;
      let user = { _id: -1 };

      if (token) {
        const foundUser = await User.findByToken(token);
        if (foundUser) {
          user = foundUser;
        } else {
          res.clearCookie("token");
        }
      }

      const { role } = await checkRole(groupId, user._id);

      let group = await Group.findOne({ _id: groupId }, "-__v -members")
        .populate({
          path: "memberData",
          select: "-_id initialStreak score count",
          populate: {
            path: "user",
            select: "name handle currentStreak imgSrc tier",
          },
        })
        .populate("admin", "-_id handle name")
        .populate("applications", "-_id name handle")
        .lean();

      if (!group) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      group = await groupRank(group);

      if (role !== "admin") {
        delete group.applications;
      }

      group.createdAt = formatDate(group.createdAt);
      group.updatedAt = formatDate(group.updatedAt);
      group.isMember = role !== "none";

      group.memberData = group.memberData.map((member) => ({
        name: member.user.name,
        handle: member.user.handle,
        imgSrc: member.user.imgSrc,
        tier: member.user.tier,
        maxStreak: member.user.currentStreak - member.initialStreak,
        score: member.score,
        count: member.count,
        todaySolved: group.todaySolvedMembers.some(
          (solvedMember) =>
            solvedMember._id.toString() === member.user._id.toString()
        ),
      }));

      return res.status(200).json({
        success: true,
        group,
        userRole: role,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
};

const post = {
  create: async (req, res) => {
    try {
      if (req.user.joinedGroupList.length >= GROUP_LIMIT) {
        return res.status(200).json({
          success: false,
          message: `그룹은 최대 ${GROUP_LIMIT}개 까지 참가 가능합니다.`,
        });
      }

      // 유저 추가 전 정보 업데이트
      const user = await userUpdateBySolvedac(req.user.handle);

      // 유저 정보 저장
      const memberData = new MemberData({
        user: user._id,
        initialStreak: user.currentStreak,
        initialCount: user.currentCount,
        initial: user.current,
      });

      await memberData.save();

      const counter = await Counter.findByIdAndUpdate(
        "groupId",
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      const groupId = await counter.seq;

      const group = await new Group({
        _id: groupId,
        groupName: req.body.groupName,
        description: req.body.description,
        admin: user._id,
        memberData: [memberData._id],
      });

      await group.save();

      await User.findOneAndUpdate(
        { handle: user.handle },
        { $push: { joinedGroupList: groupId } }
      );

      return res.status(200).json({
        success: true,
        group,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  edit: async (req, res) => {
    try {
      const { groupId } = req.params;
      const { success, role } = await checkRole(
        req.params.groupId,
        req.user._id
      );

      if (!success) {
        return res
          .status(404)
          .json({ success: false, error: "그룹을 찾을 수 없습니다." });
      }

      if (role !== "admin") {
        return res.status(200).json({
          success: false,
          message: "권한이 없습니다.",
        });
      }

      const group = await Group.findByIdAndUpdate(
        groupId,
        {
          $set: {
            groupName: req.body.groupName,
            description: req.body.description,
          },
        },
        { new: true }
      );

      if (!group) {
        return res
          .status(404)
          .json({ success: false, error: "그룹을 찾을 수 없습니다." });
      }

      return res.status(200).json({
        success: true,
        group,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  apply: async (req, res) => {
    try {
      if (req.user.joinedGroupList.length >= GROUP_LIMIT) {
        return res.status(200).json({
          success: false,
          message: `그룹은 최대 ${GROUP_LIMIT}개 까지 참가 가능합니다.`,
        });
      }

      const { groupId } = req.params;

      // 그룹 가져오기
      const group = await Group.findById(groupId).lean();

      if (!group) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (group.isEnd) {
        return res
          .status(200)
          .json({ success: false, message: "활동을 종료한 그룹입니다." });
      }

      // 그룹 정원 초과
      if (group.size >= MEMBER_LIMIT) {
        return res.status(200).json({
          success: false,
          message: `멤버는 ${MEMBER_LIMIT}명을 초과할 수 없습니다.`,
        });
      }

      const { success, role } = await checkRole(
        req.params.groupId,
        req.user._id
      );

      if (!success) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (role !== "none") {
        return res.status(200).json({
          success: false,
          message: "이미 가입 신청을 하였습니다.",
        });
      }

      const updatedGroup = await Group.findByIdAndUpdate(
        groupId,
        { $addToSet: { applications: req.user._id } },
        { new: true }
      );

      if (!updatedGroup) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      return res.status(200).json({
        success: true,
        group: updatedGroup,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  accept: async (req, res) => {
    try {
      const { groupId, handle } = req.params;

      // 그룹 가져오기
      const group = await Group.findById(groupId);

      if (!group) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (group.isEnd) {
        return res
          .status(200)
          .json({ success: false, message: "활동을 종료한 그룹입니다." });
      }

      // 그룹 정원 초과
      if (group.size >= MEMBER_LIMIT) {
        return res.status(200).json({
          success: false,
          message: `멤버는 ${MEMBER_LIMIT}명을 초과할 수 없습니다.`,
        });
      }

      const check = await User.findOne({ handle })
        .select("joinedGroupList")
        .lean();

      if (check.joinedGroupList.length >= GROUP_LIMIT) {
        return res.status(200).json({
          success: false,
          message: `해당 유저는 이미 ${GROUP_LIMIT}개의 그룹에 참가하였습니다.`,
        });
      }

      const { success, role } = await checkRole(groupId, req.user._id);

      if (!success) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (role !== "admin") {
        return res.status(200).json({
          success: false,
          message: "권한이 없습니다.",
        });
      }

      // 유저 추가 전 정보 업데이트
      const user = await userUpdateBySolvedac(handle);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "유저를 찾을 수 없습니다." });
      }

      // 신청 목록에 있는지 확인
      const isApplied = await group.applications.some(
        (app) => app.toString() === user._id.toString()
      );

      if (!isApplied) {
        return res
          .status(400)
          .json({ success: false, message: "유저가 신청 목록에 없습니다." });
      }

      // MemberData 생성 및 저장
      const memberData = new MemberData({
        user: user._id,
        initialStreak: user.currentStreak,
        initialCount: user.currentCount,
        initial: user.current,
      });
      await memberData.save();

      // 그룹 업데이트
      const updatedGroup = await Group.findByIdAndUpdate(
        groupId,
        {
          $pull: { applications: user._id },
          $addToSet: {
            memberData: memberData._id,
          },
          $inc: { size: 1 },
        },
        { new: true }
      );

      // 유저 정보에 그룹 저장
      await User.findOneAndUpdate(
        { handle: handle },
        { $push: { joinedGroupList: groupId } }
      );

      return res.status(200).json({
        success: true,
        group: updatedGroup,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  reject: async (req, res) => {
    try {
      const { groupId, handle } = req.params;
      const { success, role } = await checkRole(groupId, req.user._id);

      if (!success) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (role !== "admin") {
        return res.status(200).json({
          success: false,
          message: "권한이 없습니다.",
        });
      }

      const user = await User.findOne({ handle }, "_id").lean();

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "유저를 찾을 수 없습니다." });
      }

      const group = await Group.findByIdAndUpdate(
        groupId,
        {
          $pull: { applications: user._id },
        },
        { new: true }
      );

      return res.status(200).json({
        success: true,
        group,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  kick: async (req, res) => {
    try {
      const userId = req.user._id;
      const userHandle = req.user.handle;
      const { groupId, handle } = req.params;
      const { success, role } = await checkRole(groupId, userId);

      if (!success) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (
        (role !== "member" && role !== "admin") ||
        (role === "member" && handle !== userHandle)
      ) {
        return res.status(200).json({
          success: false,
          message: "권한이 없습니다.",
        });
      }

      if (role === "admin" && handle === userHandle) {
        return res.status(200).json({
          success: false,
          message: "관리자는 추방 할 수 없습니다.",
        });
      }

      const group = await Group.findById(groupId).select("memberData");
      const user = await User.findOne({ handle }).select("_id");

      const member = await MemberData.findOne({
        user: user._id,
        _id: { $in: group.memberData },
      });

      // 그룹에서 멤버 데이터, 유저 삭제
      await Group.findByIdAndUpdate(groupId, {
        $pull: {
          memberData: member._id,
          todaySolvedMembers: user._id,
        },
        $inc: {
          size: -1,
        },
      });

      // 멤버 데이터 삭제
      await MemberData.findByIdAndDelete(member._id);

      // 유저에서 그룹 삭제
      await User.findByIdAndUpdate(user._id, {
        $pull: { joinedGroupList: groupId },
      });

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  delete: async (req, res) => {
    try {
      const userId = req.user._id;
      const { groupId } = req.params;
      const { success, role } = await checkRole(groupId, userId);

      if (!success) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (role !== "admin") {
        return res.status(200).json({
          success: false,
          message: "권한이 없습니다.",
        });
      }

      const group = await Group.findById(groupId).populate({
        path: "memberData",
        select: "_id",
        populate: {
          path: "user",
          select: "_id",
        },
      });

      for (let member of group.memberData) {
        // 유저에서 그룹 삭제
        await User.findByIdAndUpdate(member.user._id, {
          $pull: { joinedGroupList: groupId },
        });

        // 멤버 데이터 삭제
        await MemberData.findByIdAndDelete(member._id);
      }

      await Group.deleteOne({ _id: groupId });

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  end: async (req, res) => {
    try {
      const userId = req.user._id;
      const { groupId } = req.params;
      const { success, role } = await checkRole(groupId, userId);

      if (!success) {
        return res
          .status(404)
          .json({ success: false, message: "그룹을 찾을 수 없습니다." });
      }

      if (role !== "admin") {
        return res.status(200).json({
          success: false,
          message: "권한이 없습니다.",
        });
      }

      const curTime = moment(new Date()).tz("Asia/Seoul").format();

      const group = await Group.findByIdAndUpdate(groupId, {
        $set: {
          endedAt: curTime,
          isEnd: true,
        },
      }).populate({
        path: "memberData",
        select: "_id",
        populate: {
          path: "user",
          select: "_id",
        },
      });

      for (let member of group.memberData) {
        // 유저에서 그룹 삭제
        await User.findByIdAndUpdate(member.user._id, {
          $pull: { joinedGroupList: groupId },
        });
      }

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
};

module.exports = {
  get,
  post,
};
