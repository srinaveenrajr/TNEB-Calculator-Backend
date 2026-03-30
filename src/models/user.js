const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    /** Base LMR for the next billing period (updated after each calc & on billing reset) */
    billingBaseLMR: { type: Number, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
