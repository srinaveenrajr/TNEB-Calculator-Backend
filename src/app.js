const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
});

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");

const { connectDb } = require("./config/database");
const Tables = require("./models/table");
const History = require("./models/history");
const User = require("./models/user");
const { authenticate } = require("./middleware/auth");
const { sortSlabsForDisplay } = require("./utils/sortSlabs");
const { computeBillAmount } = require("./utils/billCompute");

const app = express();
const SALT_ROUNDS = 10;

// ✅ SECURITY
app.use(helmet());
app.use(morgan("combined"));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  }),
);

// ✅ CORS (ENV BASED)
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// This forces the backend to respond with a "200 OK" to the browser's hidden check
app.options("/:any*", cors());
app.use(express.json());

// ✅ JWT
function signToken(userId) {
  return jwt.sign({ userId: String(userId) }, process.env.JWT_SECRET, {
    expiresIn: "14d",
  });
}
// ─── Auth (public) ─────────────────────────────────────

app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
      return res
        .status(400)
        .json({ error: "Valid email and password (6+ chars) required" });
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists)
      return res.status(400).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash,
    });

    // Create the default slabs copy for this new user.
    await ensureUserTablesExist(user._id);

    const token = signToken(user._id);
    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        billingBaseLMR: user.billingBaseLMR,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || "").toLowerCase() });
    if (!user)
      return res.status(401).json({ error: "Invalid email or password" });
    const ok = await bcrypt.compare(password || "", user.passwordHash);
    if (!ok)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken(user._id);
    res.status(200).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        billingBaseLMR: user.billingBaseLMR,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/auth/me", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-passwordHash");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json({
      id: user._id,
      email: user.email,
      billingBaseLMR: user.billingBaseLMR,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── User billing reset (does not delete history) ──────

app.post("/user/billing-reset", authenticate, async (req, res) => {
  try {
    const latest = await History.findOne({ userId: req.userId }).sort({
      createdAt: -1,
    });
    if (!latest) {
      return res.status(400).json({ error: "No history to reset from" });
    }
    await User.findByIdAndUpdate(req.userId, {
      billingBaseLMR: latest.reading,
    });
    const user = await User.findById(req.userId).select("-passwordHash");
    res.status(200).json({
      message: "Billing base updated to latest reading",
      billingBaseLMR: user.billingBaseLMR,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Tables (protected) ─────────────────────────────────

function parseInfinityNumber(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "" || s === "none" || s === "null") return NaN;
  if (s === "∞" || s === "infinity") return 9999;
  const n = parseFloat(s);
  return Number.isNaN(n) ? NaN : n;
}

async function ensureUserTablesExist(userId) {
  const existing = await Tables.findOne({ userId, isDefault: false });
  if (existing) return;

  const defaults = await Tables.find({ isDefault: true }).lean();
  if (!defaults.length) return;

  const copies = defaults.map((t) => ({
    from: t.from,
    to: t.to,
    rate: t.rate,
    maxUnits: t.maxUnits,
    userId,
    isDefault: false,
  }));
  await Tables.insertMany(copies);
}

async function ensureDefaultTablesSeed() {
  const count = await Tables.countDocuments({ isDefault: true });
  if (count > 0) return;

  const planA = [
    { from: 1, to: 100, rate: 0, maxUnits: 500 },
    { from: 101, to: 200, rate: 2.35, maxUnits: 500 },
    { from: 201, to: 400, rate: 4.7, maxUnits: 500 },
    { from: 401, to: 500, rate: 6.3, maxUnits: 500 },
  ];

  const planB = [
    { from: 1, to: 100, rate: 0, maxUnits: 9999 },
    { from: 101, to: 400, rate: 4.7, maxUnits: 9999 },
    { from: 401, to: 500, rate: 6.3, maxUnits: 9999 },
    { from: 501, to: 600, rate: 8.4, maxUnits: 9999 },
    { from: 601, to: 800, rate: 9.45, maxUnits: 9999 },
    { from: 801, to: 1000, rate: 10.5, maxUnits: 9999 },
    { from: 1001, to: 9999, rate: 11.55, maxUnits: 9999 },
  ];

  const docs = [...planA, ...planB].map((d) => ({
    ...d,
    isDefault: true,
    userId: undefined,
  }));

  await Tables.insertMany(docs);
}

async function getBillingTablesForUser(userId) {
  const userTables = await Tables.find({ userId, isDefault: false }).lean();
  if (userTables.length) return sortSlabsForDisplay(userTables);
  const defaults = await Tables.find({ isDefault: true }).lean();
  return sortSlabsForDisplay(defaults);
}

app.get("/tables/default", authenticate, async (req, res) => {
  try {
    const defaults = await Tables.find({ isDefault: true }).lean();
    res.status(200).json(sortSlabsForDisplay(defaults));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/tables/user/:userId", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    if (String(userId) !== String(req.userId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Ensure user-specific copy exists (for brand new users).
    await ensureUserTablesExist(req.userId);

    const userTables = await Tables.find({
      userId: req.userId,
      isDefault: false,
    }).lean();
    if (userTables.length) {
      return res.status(200).json(sortSlabsForDisplay(userTables));
    }

    const defaults = await Tables.find({ isDefault: true }).lean();
    return res.status(200).json(sortSlabsForDisplay(defaults));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Called when user enters edit mode first time: make a user-specific copy.
app.post("/tables/user/init", authenticate, async (req, res) => {
  try {
    await ensureUserTablesExist(req.userId);
    const userTables = await Tables.find({
      userId: req.userId,
      isDefault: false,
    }).lean();
    res.status(200).json(sortSlabsForDisplay(userTables));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Save the full edited table (create user rows if missing).
app.post("/tables/save", authenticate, async (req, res) => {
  try {
    const { tables } = req.body;
    if (!Array.isArray(tables)) {
      return res.status(400).json({ error: "Missing `tables` array" });
    }

    await ensureUserTablesExist(req.userId);

    await Tables.deleteMany({ userId: req.userId, isDefault: false });

    const toNum = parseInfinityNumber;
    const rows = tables
      .map((r) => ({
        from: toNum(r.from),
        to: toNum(r.to),
        maxUnits: toNum(r.maxUnits),
        rate: r.rate,
      }))
      .filter((r) => {
        return (
          Number.isFinite(r.from) &&
          Number.isFinite(r.to) &&
          Number.isFinite(r.maxUnits) &&
          r.rate != null &&
          String(r.rate) !== ""
        );
      })
      .map((r) => ({
        userId: req.userId,
        isDefault: false,
        from: r.from,
        to: r.to,
        maxUnits: r.maxUnits,
        rate: Number(r.rate),
      }));

    if (!rows.length) {
      return res.status(200).json({ message: "Saved (no valid rows)" });
    }

    await Tables.insertMany(rows);
    const userTables = await Tables.find({
      userId: req.userId,
      isDefault: false,
    }).lean();
    res.status(200).json(sortSlabsForDisplay(userTables));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete only user-specific rows (default rows must never be deleted).
app.delete("/tables/:id", authenticate, async (req, res) => {
  try {
    const del = await Tables.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
      isDefault: false,
    });
    if (!del) return res.status(404).json({ error: "Not found" });
    res.status(200).json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── History (protected) ─────────────────────────────────

app.get("/history", authenticate, async (req, res) => {
  try {
    const rows = await History.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean();

    const sortedSlabs = await getBillingTablesForUser(req.userId);

    // Recompute units + billAmount on fetch so the UI stays correct
    // even if billing rules were updated after older rows were saved.
    const normalized = rows.map((r) => {
      const reading = Number(r.reading);
      const baseLMR = Number(r.baseLMR);
      const units =
        Number.isFinite(reading) && Number.isFinite(baseLMR)
          ? reading - baseLMR
          : 0;
      const billAmount = computeBillAmount(units, sortedSlabs);
      return { ...r, units, billAmount };
    });

    res.status(200).json(normalized);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/history/last-reading", authenticate, async (req, res) => {
  try {
    const last = await History.findOne({ userId: req.userId }).sort({
      createdAt: -1,
    });
    if (!last) {
      return res.status(200).json({ lastReading: null });
    }
    res.status(200).json({ lastReading: last.reading });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/history", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { reading, baseLMR: bodyBase } = req.body;
    const r = parseFloat(reading);
    if (Number.isNaN(r))
      return res.status(400).json({ error: "Invalid reading" });

    const sortedSlabs = await getBillingTablesForUser(req.userId);

    const last = await History.findOne({ userId: req.userId }).sort({
      createdAt: -1,
    });

    if (last && r <= last.reading) {
      return res.status(400).json({
        error: "Reading must be greater than previous reading",
      });
    }

    let baseLMR;
    if (last) {
      if (user.billingBaseLMR != null && !Number.isNaN(user.billingBaseLMR)) {
        baseLMR = user.billingBaseLMR;
      } else if (last.baseLMR != null && !Number.isNaN(last.baseLMR)) {
        baseLMR = last.baseLMR;
      } else {
        return res.status(400).json({
          error: "Billing base not set. Use Reset Log or contact support.",
        });
      }
    } else {
      const b = bodyBase != null ? parseFloat(bodyBase) : null;
      if (b == null || Number.isNaN(b)) {
        return res.status(400).json({
          error: "Enter base LMR for the first reading",
        });
      }
      baseLMR = b;
    }

    if (r <= baseLMR) {
      return res.status(400).json({
        error: "Reading must be greater than base LMR",
      });
    }

    const units = r - baseLMR;
    const billAmount = computeBillAmount(units, sortedSlabs);

    const row = await History.create({
      userId: req.userId,
      date: new Date().toLocaleDateString("en-IN"),
      reading: r,
      baseLMR,
      units,
      billAmount,
    });

    if (!last) {
      await User.findByIdAndUpdate(req.userId, { billingBaseLMR: baseLMR });
    }

    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

async function updateLatestHistoryReading(req, res) {
  try {
    const latest = await History.findOne({ userId: req.userId }).sort({
      createdAt: -1,
    });
    if (!latest || String(latest._id) !== req.params.id) {
      return res
        .status(403)
        .json({ error: "Only the latest row can be edited" });
    }

    const r = parseFloat(req.body.reading);
    if (Number.isNaN(r))
      return res.status(400).json({ error: "Invalid reading" });

    if (r <= latest.baseLMR) {
      return res.status(400).json({
        error: "Reading must be greater than base LMR for this row",
      });
    }

    const sortedSlabs = await getBillingTablesForUser(req.userId);
    const units = r - latest.baseLMR;
    const billAmount = computeBillAmount(units, sortedSlabs);

    latest.reading = r;
    latest.units = units;
    latest.billAmount = billAmount;
    await latest.save();

    res.status(200).json(latest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

app.patch("/history/:id", authenticate, updateLatestHistoryReading);
app.put("/history/:id", authenticate, updateLatestHistoryReading);

app.delete("/history/:id", authenticate, async (req, res) => {
  try {
    const latest = await History.findOne({ userId: req.userId }).sort({
      createdAt: -1,
    });
    if (!latest || String(latest._id) !== req.params.id) {
      return res
        .status(403)
        .json({ error: "Only the latest row can be deleted" });
    }

    await History.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/history/all/clear", authenticate, async (req, res) => {
  try {
    await History.deleteMany({ userId: req.userId });
    await User.findByIdAndUpdate(req.userId, { billingBaseLMR: null });
    res.status(200).json({ message: "All history cleared" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

connectDb()
  .then(async () => {
    await ensureDefaultTablesSeed();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to start server:", err);
  });
