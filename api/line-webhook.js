// api/line-webhook.js
// 賀森超強筆記 v1：純規則版派車單整理＋司機快捷

// 主入口（CommonJS 寫法）
async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  let body = req.body;

  // 有些情況 req.body 可能是 undefined，我們手動解析 raw body 當備用
  if (!body || !body.events) {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      body = JSON.parse(raw);
    } catch (e) {
      console.error("解析 LINE 請求 body 失敗：", e);
      return res.status(200).send("OK");
    }
  }

  console.log("收到 LINE 事件：", JSON.stringify(body, null, 2));

  const events = body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = (event.message.text || "").trim();

      // ✅ 先處理兩個司機快捷指令
      if (userText === "陳俊豪") {
        const replyText =
          "司機：陳俊豪\n" +
          "電話：0973550190\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
        await replyMessage(event.replyToken, replyText);
        continue;
      }

      if (userText === "陳正紘") {
        const replyText =
          "司機：陳正紘\n" +
          "電話：0937429798\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
        await replyMessage(event.replyToken, replyText);
        continue;
      }

      // 其他狀況：視為派車單原始資料，用規則解析
      const replyText = await generateDispatchSheet(userText);
      await replyMessage(event.replyToken, replyText);
    }
  }

  return res.status(200).send("OK");
}

// 呼叫 LINE Reply API
async function replyMessage(replyToken, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    console.error("沒有找到 LINE_CHANNEL_ACCESS_TOKEN 環境變數！");
    return;
  }

  const body = {
    replyToken,
    messages: [
      {
        type: "text",
        text,
      },
    ],
  };

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("回覆 LINE 失敗：", res.status, errText);
    }
  } catch (err) {
    console.error("呼叫 LINE Reply API 發生錯誤：", err);
  }
}

// 解析派車原始文字（不靠 AI，純規則）
function parseDispatch(rawText) {
  const data = {
    job_tag: "",
    date: "",
    flight: "",
    pickup_time: "",
    guest_name: "",
    guest_phone: "",
    addresses: [],
    people_count: null,
    luggage: "",
    child_seat: "",
    remark: "",
    driver_name: "",
    driver_phone: "",
    car_plate: "",
    car_type: "",
    payment: ""
  };

  const safeText = (rawText || "").trim();
  const lines = safeText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 1) job_tag：送機 / 接機 / 單接 / 單送
  const jobTags = ["送機", "接機", "單接", "單送"];
  for (const tag of jobTags) {
    if (safeText.includes(tag)) {
      data.job_tag = tag;
      break;
    }
  }

  // 2) 日期（簡單抓 01/01、1/1、2026-02-28 這類）
  // 先抓像 2026-02-28 或 2026/02/28
  let dateMatch =
    safeText.match(/(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/) ||
    safeText.match(/(\d{1,2}[\/.-]\d{1,2})/);
  if (dateMatch) {
    data.date = dateMatch[1];
  }

  // 3) 航班 flight：抓像 BR166 / 06:15
  const flightMatch = safeText.match(/([A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2})/);
  if (flightMatch) {
    data.flight = flightMatch[1].trim();
  }

  // 4) 載客時間 pickup_time：看有沒有「載客時間00:45」這類
  const pickupMatch = safeText.match(/載客時間\s*([0-2]?\d:\d{2})/);
  if (pickupMatch) {
    data.pickup_time = pickupMatch[1];
  }

  // 5) 電話＋貴賓姓名：找 09xxxxxxxx 第一行，上一行當姓名
  let phoneLineIndex = -1;
  lines.forEach((line, idx) => {
    if (/09\d{8}/.test(line) && phoneLineIndex === -1) {
      phoneLineIndex = idx;
      const m = line.match(/(09\d{8})/);
      if (m) data.guest_phone = m[1];
    }
  });
  if (phoneLineIndex > 0) {
    data.guest_name = lines[phoneLineIndex - 1];
  }

  // 6) 地址：抓開頭是數字或序號＋有「市」或「區」或「路」的行
  lines.forEach((line) => {
    if (/^\d+[\.\s、]/.test(line) || /^[１２３４５６７８９]/.test(line)) {
      // 去掉開頭的「1.」「2 」之類
      let addr = line.replace(/^[\d１２３４５６７８９]+[.\s、]?/, "").trim();
      if (addr.includes("市") || addr.includes("區") || addr.includes("路")) {
        data.addresses.push(addr);
      }
    }
  });

  // 7) 人數：抓「7位」「7人」這種
  const peopleMatch = safeText.match(/(\d+)\s*[位人]/);
  if (peopleMatch) {
    data.people_count = parseInt(peopleMatch[1], 10);
  }

  // 8) 收款方式 payment：抓「收現金7000」/「收現金 7000 元」
  const payMatch = safeText.match(/收\s*(現金|匯款|刷卡)?\s*([\d,]+)/);
  if (payMatch) {
    const method = payMatch[1] || "現金";
    const amount = payMatch[2];
    data.payment = `${method} ${amount} 元`;
  }

  // 目前其他欄位（行李 / 安全座椅 / 備註 / 司機等）先留空
  return data;
}

// 版本：不呼叫 OpenAI，純規則解析派車單
async function generateDispatchSheet(rawText) {
  try {
    const parsed = parseDispatch(rawText || "");
    const text = buildDispatchText(parsed || {});
    return text;
  } catch (err) {
    console.error("解析派車資料發生錯誤：", err);
    return `（派車資料解析失敗，暫時先回原文）\n\n${rawText}`;
  }
}

// 根據 structured 資料組合派車單文字
function buildDispatchText(data) {
  const safe = data || {};
  const jobTag = safe.job_tag || "";
  const date = safe.date || "";
  const flight = safe.flight || "";
  const pickupTime = safe.pickup_time || "";
  const guestName = safe.guest_name || "";
  const guestPhone = safe.guest_phone || "";
  const addresses = Array.isArray(safe.addresses) ? safe.addresses : [];
  const peopleCount =
    typeof safe.people_count === "number" ? safe.people_count : "";
  const luggage = safe.luggage || "";
  const childSeat = safe.child_seat || "";
  const remark = safe.remark || "";
  const driverName = safe.driver_name || "";
  const driverPhone = safe.driver_phone || "";
  const carPlate = safe.car_plate || "";
  const carType = safe.car_type || "";
  const payment = safe.payment || "";

  let guestSuffix = "";
  if (peopleCount && peopleCount > 1) {
    guestSuffix = ` 等 ${peopleCount} 位`;
  }

  const addressesBlock =
    addresses.length > 0
      ? addresses.map((addr, idx) => `${idx + 1}. ${addr}`).join("\n")
      : "";

  const text =
    `✈️機場接送🚗預約單\n\n` +
    `📍【${jobTag}】\n\n` +
    `◆日期📅：${date}\n` +
    `◆航班名稱✈️：${flight}\n` +
    `◆載客時間🕰️：${pickupTime}\n` +
    `◆貴賓：${guestName}${guestSuffix}\n` +
    `◆電話：${guestPhone}\n` +
    `◆地址：\n` +
    `${addressesBlock}\n\n` +
    `◆人數：${peopleCount}\n` +
    `◆行李：${luggage}\n` +
    `◆有無安全座椅：${childSeat}\n\n` +
    `🌟備註：${remark}\n\n` +
    `司機：${driverName}\n` +
    `電話：${driverPhone}\n` +
    `車號：${carPlate}\n` +
    `車型：${carType}\n` +
    `➖➖➖➖➖➖➖➖➖➖\n` +
    `收款方式：${payment}`;

  return text;
}

// 匯出 handler（CommonJS）
module.exports = handler;
