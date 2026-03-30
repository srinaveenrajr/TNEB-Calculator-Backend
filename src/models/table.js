const mongoose = require("mongoose");

const tablesSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false,
    index: true,
  },
  // Slab range (units)
  from: { type: Number },
  to: { type: Number },
  maxUnits: { type: Number, default: 9999 },
  // Slab rate (per unit)
  rate: { type: mongoose.Schema.Types.Decimal128 },
  // Default slabs live as separate rows with isDefault=true
  isDefault: { type: Boolean, default: false, index: true },
});

module.exports = mongoose.model("Tables", tablesSchema);
