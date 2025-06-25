const moment = require("moment-timezone");

const formatDate = (date) => {
  return moment(date).tz("Asia/Seoul").format();
};

module.exports = { formatDate };
