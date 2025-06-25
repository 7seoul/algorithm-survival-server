const { User } = require("../../../models/User/User");
const { UserVerification } = require("../../../models/User/UserVerification");
const { userRank } = require("../../../utils/checkRank");
const { formatDate } = require("../../../utils/formatDate");
const solvedac = require("../../../apis/solvedac");
const crypto = require("crypto");
const logger = require("../../../../logger");

const get = {
  me: async (req, res) => {
    try {
      const handle = req.user.handle;
      let user = await User.findOne({ handle })
        .select("-password -initial -current -initialCount -currentCount -__v")
        .populate(
          "joinedGroupList",
          "groupName _id description score maxStreak size"
        )
        .lean();

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "찾을 수 없는 아이디 입니다." });
      }

      user = await userRank(user);

      user.createdAt = formatDate(user.createdAt);
      user.updatedAt = formatDate(user.updatedAt);
      user.currentStreak = user.currentStreak - user.initialStreak;

      delete user.initialStreak;

      return res.status(200).json({ success: true, user });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
};

const post = {
  login: async (req, res) => {
    try {
      const user = await User.findOne({ handle: req.body.handle });

      if (!user) {
        return res.status(200).json({
          success: false,
          message: "존재하지 않는 id 입니다.",
        });
      }

      // 비밀번호 비교
      const isMatch = await user.comparePassword(req.body.password);
      if (!isMatch) {
        return res.status(200).json({
          success: false,
          message: "비밀번호가 틀렸습니다.",
        });
      }

      // 토큰 생성
      const token = await user.generateToken();

      // 쿠키에 토큰 저장
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 365 * 24 * 60 * 60 * 1000,
        sameSite: "Strict",
      });

      return res.status(200).json({
        success: true,
        user: {
          handle: user.handle,
          name: user.name,
        },
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  code: async (req, res) => {
    try {
      const existingVerification = await UserVerification.findOne({
        handle: req.body.handle,
      }).lean();

      if (existingVerification?.isVerified) {
        return res.status(409).json({
          success: false,
          message: "이미 등록된 아이디 입니다.",
        });
      }

      const code = await crypto
        .randomBytes(Math.ceil(16))
        .toString("hex")
        .slice(0, 32);

      if (existingVerification) {
        await UserVerification.findOneAndUpdate(
          { handle: req.body.handle },
          {
            $set: {
              verificationCode: code,
            },
          }
        );
        return res.status(200).json({
          success: true,
          verificationCode: code,
        });
      }

      const newVerification = new UserVerification({
        handle: req.body.handle,
        verificationCode: code,
      });

      await newVerification.save();

      return res.status(200).json({
        success: true,
        verificationCode: code,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  reset: async (req, res) => {
    try {
      const existingVerification = await UserVerification.findOne({
        handle: req.body.handle,
      }).lean();

      if (!existingVerification?.isVerified) {
        return res.status(200).json({
          success: false,
          message: "가입하지 않은 유저 입니다.",
        });
      }

      const code = await crypto
        .randomBytes(Math.ceil(16))
        .toString("hex")
        .slice(0, 32);

      await UserVerification.findOneAndUpdate(
        { handle: req.body.handle },
        {
          $set: {
            verificationCode: code,
          },
        }
      );

      return res.status(200).json({
        success: true,
        verificationCode: code,
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  register: async (req, res) => {
    try {
      const userVerification = await UserVerification.findOne({
        handle: req.body.handle,
      }).lean();

      if (!userVerification) {
        return res.status(409).json({
          success: false,
          message: "인증 코드를 발급해 주세요.",
        });
      }

      if (userVerification?.isVerified) {
        return res.status(409).json({
          success: false,
          message: "이미 등록된 아이디 입니다.",
        });
      }

      // 여기서 과요청 방지 가능

      // solved.ac api 사용
      let profile;
      let streak;
      let initial;
      try {
        profile = await solvedac.profile(req.body.handle);

        logger.warn("--register--");
        logger.warn(`스크랩한 bio: ${profile.bio}`);
        logger.warn(`db의 코드: ${userVerification.verificationCode}`);
        logger.warn(
          `결과: ${profile.bio === userVerification.verificationCode}`
        );

        // 개발용 스킵
        if (!userVerification.verificationCode) {
          return res.status(200).json({
            success: false,
            message: "인증 코드를 새로 발급해 주세요.",
          });
        }
        if (profile.bio !== userVerification.verificationCode) {
          return res.status(200).json({
            success: false,
            message: "인증 코드가 일치하지 않습니다.",
          });
        }

        streak = await solvedac.grass(req.body.handle);
        initial = await solvedac.problem(req.body.handle);

        if (streak === undefined || initial === undefined || !profile) {
          return res.status(424).json({
            success: false,
            message: "정보를 불러오는데 실패했습니다.",
          });
        }
      } catch (error) {
        logger.error(`${error}`);
        return res.status(404).json({
          success: false,
          message: "solved.ac에 가입되지 않은 ID입니다.",
        });
      }

      const newUser = new User({
        handle: req.body.handle,
        name: req.body.name,
        password: req.body.password,
        initialStreak: streak,
        currentStreak: streak,
        initialCount: profile.solvedCount,
        currentCount: profile.solvedCount,
        tier: profile.tier,
        imgSrc: profile.profileImageUrl
          ? profile.profileImageUrl
          : "https://static.solved.ac/misc/360x360/default_profile.png",
        initial,
        current: initial,
      });

      await newUser.save();

      await UserVerification.findOneAndUpdate(
        { handle: req.body.handle },
        {
          $set: {
            verificationCode: "",
            isVerified: true,
          },
        }
      );

      // 토큰 생성
      const token = await newUser.generateToken();

      // 쿠키에 토큰 저장
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 365 * 24 * 60 * 60 * 1000,
        sameSite: "Strict",
      });

      return res.status(200).json({
        success: true,
        user: {
          handle: newUser.handle,
          name: newUser.name,
        },
      });
    } catch (error) {
      logger.error(`${error}`);
      return res
        .status(500)
        .json({ success: false, message: "서버 오류 발생" });
    }
  },
  logout: async (req, res) => {
    try {
      // 쿠키 삭제
      res.clearCookie("token");

      return res.status(200).json({
        success: true,
        message: "로그아웃 성공",
      });
    } catch (error) {
      logger.error(`${error}`);
      return res.status(500).json({
        success: false,
        message: "서버 오류 발생",
      });
    }
  },
  password: async (req, res) => {
    try {
      const { newPassword, handle } = req.body;

      const user = await User.findOne({ handle: handle });

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "아이디를 찾을 수 없습니다." });
      }

      const userVerification = await UserVerification.findOne({
        handle: handle,
      }).lean();

      if (!userVerification.verificationCode) {
        return res.status(200).json({
          success: false,
          message: "인증 코드를 새로 발급해 주세요.",
        });
      }
      // 개발용 스킵
      const profile = await solvedac.profile(handle);
      if (profile.bio !== userVerification.verificationCode) {
        return res.status(200).json({
          success: false,
          message: "인증 코드가 일치하지 않습니다.",
        });
      }

      // 새로운 비밀번호 설정
      user.password = newPassword;
      await user.save();

      await UserVerification.findOneAndUpdate(
        { handle: req.body.handle },
        {
          $set: {
            verificationCode: "",
          },
        }
      );

      return res.status(200).json({
        success: true,
        message: "비밀번호 변경 완료",
      });
    } catch (error) {
      logger.error(`${error}`);
      return res.status(500).json({
        success: false,
        message: "서버 오류 발생",
      });
    }
  },
};

module.exports = {
  get,
  post,
};
