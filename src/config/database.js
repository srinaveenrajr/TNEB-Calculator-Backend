const mongoose = require("mongoose");

const connectDb = async () => {
  await mongoose.connect(
    "mongodb+srv://srinaveenrajr:gEmQiGzdSYZ44oeB@try2.ya15ig1.mongodb.net/",
  );
};

module.exports = { connectDb };
