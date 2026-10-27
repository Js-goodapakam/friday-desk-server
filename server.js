const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const db = require("./src/db");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({limit:process.env.FRIDAY_LOCAL_DEV==='1'?'12mb':'256kb'}));
const auth = require("./src/auth").createAuth(db);
const properties = require("./src/properties").propertyRoutes(db);
app.use("/api/auth",auth.checkOrigin);
app.post("/api/auth/login",auth.login);
app.get("/api/auth/session",auth.requireSession,(req,res)=>res.json({user:req.user}));
app.post("/api/auth/logout",auth.logout);
app.use("/api",(req,res,next)=>{
 if(req.path==="/health")return next();
 if(req.path.startsWith("/webhooks/")){
  if(!process.env.TELECMI_WEBHOOK_TOKEN || req.headers["x-webhook-token"]!==process.env.TELECMI_WEBHOOK_TOKEN)return res.status(401).json({error:"Webhook authentication required."});
  return next();
 }
 auth.requireSession(req,res,()=>auth.checkOrigin(req,res,()=>properties.scope(req,res,next)));
});
app.get('/api/properties',properties.list);
app.get('/api/properties/:id',properties.select);
app.post('/api/properties',properties.create);
const owner=require('./src/owner-routes').ownerRoutes(db);
app.get('/api/owner',owner.get);
app.put('/api/owner',owner.save);
app.post('/api/owner/staff',owner.staff);
const demoRoutes=require('./src/demo-routes').routes(db);
app.get('/api/properties/:id/workspace',demoRoutes.get);
app.put('/api/properties/:id/workspace',demoRoutes.put);
app.post('/api/properties/:id/mock-sync',demoRoutes.simulate);
app.get('/api/properties/:id/activity',demoRoutes.audit);
app.get("/api/call-logs/:id/recording", async (req, res) => {
  try {
    const callLogId = Number(req.params.id);

    if (!Number.isInteger(callLogId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid call log ID",
      });
    }

    const result = await db.query(
      `SELECT
        "id",
        "recordingFilename",
        "recordingAvailable"
       FROM "callLog"
       WHERE "id" = $1 AND "propertyId" = $2
       LIMIT 1`,
      [callLogId, req.user.propertyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Call log not found",
      });
    }

    const callLog = result.rows[0];

    if (!callLog.recordingAvailable || !callLog.recordingFilename) {
      return res.status(404).json({
        success: false,
        error: "Recording is not available for this call",
      });
    }

    const appId = process.env.TELECMI_APP_ID;
    const appSecret = process.env.TELECMI_APP_SECRET;

    if (!appId || !appSecret) {
      console.error("TeleCMI recording credentials are missing");

      return res.status(500).json({
        success: false,
        error: "TeleCMI recording configuration is missing",
      });
    }

    const recordingUrl =
      `https://piopiy.telecmi.com/v1/play` +
      `?appid=${encodeURIComponent(appId)}` +
      `&token=${encodeURIComponent(appSecret)}` +
      `&file=${encodeURIComponent(callLog.recordingFilename)}`;

const response = await fetch(recordingUrl);

const contentType = response.headers.get("content-type") || "";

if (!response.ok) {
  console.error(
    "TeleCMI recording API error:",
    response.status,
    response.statusText
  );

  return res.status(502).json({
    success: false,
    error: "Unable to retrieve recording from TeleCMI"
  });
}

if (contentType.includes("application/json")) {
  const telecmiError = await response.text();

  console.error("TeleCMI recording API returned JSON:", telecmiError);

  return res.status(404).json({
    success: false,
    error: "Recording file was not found in TeleCMI"
  });
}
    res.setHeader("Content-Type", contentType || "audio/mpeg");
    res.setHeader("Content-Disposition", "inline");

    if (response.headers.get("content-length")) {
      res.setHeader(
        "Content-Length",
        response.headers.get("content-length")
      );
    }

    const arrayBuffer = await response.arrayBuffer();

    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error("Recording API error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to stream recording",
    });
  }
});

// ============================================================
// TeleCMI CDR Webhook
// Receives completed incoming/outgoing call CDRs from TeleCMI
// ============================================================

app.post("/api/webhooks/telecmi/cdr", async (req, res) => {
  try {
    const cdr = req.body || {};

    console.log("========================================");
    console.log("TeleCMI CDR received");
    console.log(JSON.stringify(cdr, null, 2));
    console.log("========================================");

    // Ignore non-CDR payloads
    if (cdr.type && cdr.type !== "cdr") {
      return res.status(200).json({
        success: true,
        message: "Event ignored",
      });
    }

    const direction =
      String(cdr.direction || "").toLowerCase() === "outbound"
        ? "OUTBOUND"
        : "INBOUND";

    const telecmiCallId = cdr.cmiuuid
      ? String(cdr.cmiuuid)
      : null;

    const conversationId = cdr.conversation_uuid
      ? String(cdr.conversation_uuid)
      : null;

    const agentId = cdr.user
      ? String(cdr.user)
      : null;

    const callLeg = cdr.leg
      ? String(cdr.leg)
      : null;

    const fromNumber = cdr.from
      ? String(cdr.from)
      : null;

    const toNumber = cdr.to
      ? String(cdr.to)
      : null;

    // For the CallLog phoneNumber field:
    // Incoming  -> caller's number
    // Outgoing  -> destination number
    const phoneNumber =
      direction === "INBOUND"
        ? fromNumber || toNumber || "UNKNOWN"
        : toNumber || fromNumber || "UNKNOWN";

    // Map TeleCMI status to Friday CallStatus enum
    const telecmiStatus = String(cdr.status || "").toLowerCase();

    let status = "COMPLETED";

    switch (telecmiStatus) {
      case "answered":
        status = "COMPLETED";
        break;

      case "missed":
      case "voicemail":
        status = "MISSED";
        break;

      case "busy":
        status = "BUSY";
        break;

      case "rejected":
        status = "REJECTED";
        break;

      case "failed":
        status = "FAILED";
        break;

      case "ringing":
        status = "RINGING";
        break;

      case "connected":
        status = "CONNECTED";
        break;

      default:
        status = "COMPLETED";
    }

    const durationSeconds = Number(cdr.answeredsec || 0);

    // TeleCMI sends timestamp in milliseconds
    const timestamp = Number(cdr.time);

    const startedAt = Number.isFinite(timestamp)
      ? new Date(timestamp)
      : new Date();

    const endedAt = new Date(
      startedAt.getTime() + durationSeconds * 1000
    );

    const recordingFilename =
      cdr.filename
        ? String(cdr.filename)
        : null;

    const recordingAvailable =
      Boolean(cdr.record) && Boolean(recordingFilename);

    const hangupReason =
      cdr.hangup_reason
        ? String(cdr.hangup_reason)
        : null;

    const telecmiCdr = JSON.stringify(cdr);

    // ----------------------------------------------------------
    // Try to identify the TeleCMI mapped application user
    // ----------------------------------------------------------

    let handledById = null;

    if (agentId) {
      const mappingResult = await db.query(
        `SELECT "userId"
         FROM "teleCMIUserMapping"
         WHERE "agentId" = $1
           AND "isActive" = true
         LIMIT 1`,
        [agentId]
      );

      if (mappingResult.rows.length > 0) {
        handledById = mappingResult.rows[0].userId;
      }
    }

    // ----------------------------------------------------------
    // Find an existing call
    //
    // 1. First try cmiuuid
    // 2. Then conversation_uuid
    //
    // This prevents duplicate records when TeleCMI sends
    // multiple legs for an outgoing call.
    // ----------------------------------------------------------

    let existingCall = null;

    if (telecmiCallId) {
      const result = await db.query(
        `SELECT "id"
         FROM "callLog"
         WHERE "telecmiCallId" = $1
         LIMIT 1`,
        [telecmiCallId]
      );

      if (result.rows.length > 0) {
        existingCall = result.rows[0];
      }
    }

    if (!existingCall && conversationId) {
      const result = await db.query(
        `SELECT "id"
         FROM "callLog"
         WHERE "telecmiConversationId" = $1
         ORDER BY "id" DESC
         LIMIT 1`,
        [conversationId]
      );

      if (result.rows.length > 0) {
        existingCall = result.rows[0];
      }
    }

    // ----------------------------------------------------------
    // UPDATE existing CallLog
    // ----------------------------------------------------------

    if (existingCall) {
      const result = await db.query(
        `UPDATE "callLog"
         SET
           "telecmiCallId" = COALESCE($1, "telecmiCallId"),
           "telecmiAgentId" = COALESCE($2, "telecmiAgentId"),
           "telecmiConversationId" = COALESCE($3, "telecmiConversationId"),
           "telecmiCallLeg" = COALESCE($4, "telecmiCallLeg"),
           "phoneNumber" = COALESCE($5, "phoneNumber"),
           "direction" = $6,
           "status" = $7,
           "startedAt" = $8,
           "endedAt" = $9,
           "durationSeconds" = $10,
           "handledById" = COALESCE($11, "handledById"),
           "recordingFilename" = COALESCE($12, "recordingFilename"),
           "recordingAvailable" = $13 OR "recordingAvailable",
           "hangupReason" = COALESCE($14, "hangupReason"),
           "fromNumber" = COALESCE($15, "fromNumber"),
           "toNumber" = COALESCE($16, "toNumber"),
           "telecmiCdr" = $17,
           "updatedAt" = NOW()
         WHERE "id" = $18
         RETURNING *`,
        [
          telecmiCallId,
          agentId,
          conversationId,
          callLeg,
          phoneNumber,
          direction,
          status,
          startedAt,
          endedAt,
          durationSeconds,
          handledById,
          recordingFilename,
          recordingAvailable,
          hangupReason,
          fromNumber,
          toNumber,
          telecmiCdr,
          existingCall.id,
        ]
      );

      console.log(
        `TeleCMI CDR updated CallLog ID: ${existingCall.id}`
      );

      return res.status(200).json({
        success: true,
        action: "updated",
        callLog: result.rows[0],
      });
    }

    // ----------------------------------------------------------
    // CREATE new CallLog
    // ----------------------------------------------------------

    const result = await db.query(
      `INSERT INTO "callLog"
       (
         "propertyId",
         "handledById",
         "telecmiCallId",
         "telecmiAgentId",
         "telecmiConversationId",
         "telecmiCallLeg",
         "phoneNumber",
         "direction",
         "status",
         "startedAt",
         "endedAt",
         "durationSeconds",
         "recordingFilename",
         "recordingAvailable",
         "hangupReason",
         "fromNumber",
         "toNumber",
         "telecmiCdr",
         "createdAt",
         "updatedAt"
       )
       VALUES
       (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         $14,
         $15,
         $16,
         $17,
         $18,
         NOW(),
         NOW()
       )
       RETURNING *`,
      [
        1,
        handledById,
        telecmiCallId,
        agentId,
        conversationId,
        callLeg,
        phoneNumber,
        direction,
        status,
        startedAt,
        endedAt,
        durationSeconds,
        recordingFilename,
        recordingAvailable,
        hangupReason,
        fromNumber,
        toNumber,
        telecmiCdr,
      ]
    );

    console.log(
      `TeleCMI CDR created CallLog ID: ${result.rows[0].id}`
    );

    return res.status(201).json({
      success: true,
      action: "created",
      callLog: result.rows[0],
    });
  } catch (error) {
    console.error("TeleCMI CDR webhook error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to process TeleCMI CDR",
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "StayDesk API is running",
  });
});

app.get("/api/property", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM "property"
       WHERE "id" = $1
       LIMIT 1`, [req.user.propertyId]
    );

    res.json({
      success: true,
      property: result.rows[0] || null,
    });
  } catch (error) {
    console.error("Property API error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to fetch property",
    });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    if(!["ADMIN","MANAGER"].includes(req.user.role))return res.status(403).json({error:"Permission denied."});
    const propertyId = req.user.propertyId;

    const result = await db.query(
      `SELECT *
       FROM "user"
       WHERE "propertyId" = $1
       ORDER BY "id"`,
      [propertyId]
    );

    res.json({
      success: true,
      users: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Users API error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
    });
  }
});
app.post("/api/users", async (req, res) => {
  try {
    const { name, email, phone, role, propertyId } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({
        success: false,
        error: "name, email and role are required",
      });
    }

    if(req.user.role!=="ADMIN")return res.status(403).json({error:"Administrator access required."});
    const finalPropertyId = req.user.propertyId;

    const property = await db.query(
      `SELECT "id"
       FROM "property"
       WHERE "id" = $1`,
      [finalPropertyId]
    );

    if (property.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Property not found",
      });
    }

    const result = await db.query(
      `INSERT INTO "user"
       ("name", "email", "phone", "role", "propertyId", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
       RETURNING *`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        phone || null,
        role.trim().toUpperCase(),
        finalPropertyId,
      ]
    );

    res.status(201).json({
      success: true,
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Create user API error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A user with this email already exists",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to create user",
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`StayDesk API running on http://localhost:${PORT}`);
  });
}

module.exports = app;
