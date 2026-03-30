const mongoose = require("mongoose");

const historySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: { type: String, required: true },
    /** Current meter reading */
    reading: { type: Number, required: true },
    /** Base LMR used for this row */
    baseLMR: { type: Number, required: true },
    units: { type: Number, required: true },
    billAmount: { type: Number, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("History", historySchema);
