// api/line-webhook.js
// 賀森超強筆記 v1.5：純規則派車單整理＋司機快捷

// 主入口（CommonJS）
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

      // ✅ 司機快捷：陳俊豪
      if (userText === "陳俊豪") {
        const replyText =
          "司機：陳俊豪\n" +
          "電話：0973550190\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
        await replyMessage(event.replyToken, replyText);
        continue;
      }

      // ✅ 司機快捷：陳正紘
      if (userText === "陳正紘") {
        const replyText =
          "司機：陳正紘\n" +
          "電話：0937429798\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
        await replyMessage(event.replyToken, replyText);
        continue;
      }

      // ✅ 司機快捷：蔣金海
      if (userText === "蔣金海") {
        const replyText =
          "司機：蔣金海\n" +
          "電話：09157547765\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
        await replyMessage(event.replyToken, replyText);
        continue;
      }
      // ✅ 司機快捷：葉俊麟
      if (userText === "葉俊麟") {
        const replyText =
          "司機：葉俊麟\n" +
          "電話：0921097732\n" +
          "車號：RFD-3200\n" +
          "車型：豪華新大T保母車";
        await replyMessage(event.replyToken, replyText);
        continue;
      }

      // ✅ 司機快捷：張啟隆
      if (userText === "張啟隆") {
        const replyText =
          "司機：張啟隆\n" +
          "電話：0919625653\n" +
          "車號：RFD-3192\n" +
          "車型：豪華新大T保母車";
        await replyMessage(event.replyToken, replyText);
        continue;
      }

      // ✅ 司機快捷：譚楚萍
      if (userText === "譚楚萍") {
        const replyText =
          "司機：譚楚萍\n" +
          "電話：0932636805\n" +
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

// ------- 純規則解析區 -------

// 簡單把中文數字（一二三四五六七八九十兩）轉成阿拉伯數字
function chineseDigitToNumber(ch) {
  const map = {
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
    "兩": 2
  };
  return map[ch] || null;
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

  // 用來記錄哪些行已經被用途占用（避免丟到備註）
  const usedLineIndex = new Set();

  // 1) job_tag：送機 / 接機 / 單接 / 單送
  const jobTags = ["送機", "接機", "單接", "單送"];
  for (const tag of jobTags) {
    if (safeText.includes(tag)) {
      data.job_tag = tag;
      break;
    }
  }

  // 2) 日期：抓 2026-02-28 或 2/27 這種
  let dateMatch =
    safeText.match(/(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/) ||
    safeText.match(/(\d{1,2}[\/.-]\d{1,2})/);
  if (dateMatch) {
    data.date = dateMatch[1];
    // 推測日期大多在第一行，標記第一行為已使用
    if (lines.length > 0 && lines[0].includes(data.date)) {
      usedLineIndex.add(0);
    }
  }

  // 3) 航班 flight：抓像 BR166 / 06:15 或 JX851/19:05
  const flightMatch = safeText.match(/([A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2})/);
  if (flightMatch) {
    data.flight = flightMatch[1].trim();
    // 找是在哪一行
    lines.forEach((line, idx) => {
      if (line.includes(data.flight)) {
        usedLineIndex.add(idx);
      }
    });
  }

  // 4) 載客時間 pickup_time：看有沒有「載客時間00:45」這類
  const pickupMatch = safeText.match(/載客時間\s*([0-2]?\d:\d{2})/);
  if (pickupMatch) {
    data.pickup_time = pickupMatch[1];
  }

  // ✅ 如果是接機，且沒有提供載客時間，則用航班時間當載客時間
  if (!data.pickup_time && data.job_tag === "接機" && data.flight) {
    const timeInFlight = data.flight.match(/(\d{1,2}:\d{2})/);
    if (timeInFlight) {
      data.pickup_time = timeInFlight[1];
    }
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
    usedLineIndex.add(phoneLineIndex);
    usedLineIndex.add(phoneLineIndex - 1);
  }

  // 6) 地址：先抓開頭有序號的，再抓沒有序號但看起來是地址的，再支援一行多個地址
  const addressCandidates = [];

  // (a) 有序號的行
  lines.forEach((line, idx) => {
    if (/^\d+[\.\s、]/.test(line) || /^[１２３４５６７８９]/.test(line)) {
      let addr = line.replace(/^[\d１２３４５６７８９]+[.\s、]?/, "").trim();
      addressCandidates.push({ addr, idx, source: "numbered" });
    }
  });

  // (b) 沒有序號但看起來像地址的行（有 市/區/路/街/巷/號 等）
  lines.forEach((line, idx) => {
    const hasAddressMarker = /[市區鄉鎮路街巷村里號]/.test(line);
    const hasPhone = /09\d{8}/.test(line);
    const looksLikePayment = /收\s*[\d,]+/.test(line);
    const looksLikeFlight = /[A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2}/.test(line);
    if (hasAddressMarker && !hasPhone && !looksLikePayment && !looksLikeFlight) {
      addressCandidates.push({ addr: line.trim(), idx, source: "plain" });
    }
  });

  // (c) 一行多個地址：用「、，,；;」切開
  const extraCandidates = [];
  addressCandidates.forEach((item) => {
    const parts = item.addr.split(/[、，,；;]/);
    if (parts.length > 1) {
      parts.forEach((p) => {
        const seg = p.trim();
        if (seg.length === 0) return;
        if (/[市區鄉鎮路街巷村里號]/.test(seg)) {
          extraCandidates.push({ addr: seg, idx: item.idx, source: "split" });
        }
      });
    }
  });

  const allAddressCandidates = [...addressCandidates, ...extraCandidates];

  const addrSet = new Set();
  allAddressCandidates.forEach((item) => {
    if (!item.addr) return;
    if (!/[市區鄉鎮路街巷村里號]/.test(item.addr)) return;
    const key = item.addr;
    if (!addrSet.has(key)) {
      addrSet.add(key);
      data.addresses.push(item.addr);
      usedLineIndex.add(item.idx);
    }
  });

  // 7) 人數
  // 7-1 阿拉伯數字：7位 / 7人
  const peopleMatch = safeText.match(/(\d+)\s*[位人]/);
  if (peopleMatch) {
    data.people_count = parseInt(peopleMatch[1], 10);
  } else {
    // 7-2 中文數字：「人數五位貴賓」或「五位貴賓」
    const peopleMatchCn =
      safeText.match(/人數.*?([一二三四五六七八九十兩])\s*[位人]/) ||
      safeText.match(/([一二三四五六七八九十兩])\s*位貴賓/);
    if (peopleMatchCn) {
      const n = chineseDigitToNumber(peopleMatchCn[1]);
      if (n) data.people_count = n;
    }
  }

  // 人數行從備註中排除
  lines.forEach((line, idx) => {
    if (/人數/.test(line) || /位貴賓/.test(line)) {
      usedLineIndex.add(idx);
    }
  });

  // 8) 收款方式 payment：支援「收現金7000」「收現金 7000」「收 7000」
  const payMatch = safeText.match(/收\s*(現金|匯款|刷卡)?\s*([\d,]+)/);
  if (payMatch) {
    const method = payMatch[1] || "現金";
    const amount = payMatch[2];
    data.payment = `${method} ${amount} 元`;
  }
  lines.forEach((line, idx) => {
    if (/收\s*(現金|匯款|刷卡)?\s*([\d,]+)/.test(line)) {
      usedLineIndex.add(idx);
    }
  });

  // 9) 安全座椅：例如「小朋友 1 位 要安全座椅」
  const childSeatMatch =
    safeText.match(/(小朋友|小孩|兒童).*?(\d+)[\s]*位.*(安全座椅|兒童座椅)/) ||
    safeText.match(/(小朋友|小孩|兒童).*?([一二三四五六七八九十兩])[\s]*位.*(安全座椅|兒童座椅)/) ||
    safeText.match(/(安全座椅|兒童座椅)/);
  if (childSeatMatch) {
    let count = "";
    if (childSeatMatch[2]) {
      if (/^\d+$/.test(childSeatMatch[2])) {
        count = childSeatMatch[2];
      } else {
        const n = chineseDigitToNumber(childSeatMatch[2]);
        if (n) count = String(n);
      }
    }
    if (count) {
      data.child_seat = `需要安全座椅 ${count} 位`;
    } else {
      data.child_seat = "需要安全座椅";
    }

    // 將包含安全座椅字樣的行從備註中排除（或讓它同時進備註也可以，看你習慣）
    lines.forEach((line, idx) => {
      if (/安全座椅|兒童座椅/.test(line)) {
        usedLineIndex.add(idx);
      }
    });
  }

  // 10) 車型：若文字中提到特定車型，就寫到 car_type
  if (/豪華新?大T/.test(safeText)) {
    data.car_type = "豪華新大T保母車";
  } else if (/大\s*T|大T/.test(safeText)) {
    data.car_type = "大T";
  } else if (/Caddy/i.test(safeText)) {
    data.car_type = "Caddy";
  } else if (/Touran/i.test(safeText)) {
    data.car_type = "Touran";
  }

  // 11) 備註：將「看起來不屬於其他欄位」的文字收集進來
  const remarkLines = [];
  lines.forEach((line, idx) => {
    if (!line) return;

    // 已經被用過的行先跳過
    if (usedLineIndex.has(idx)) return;

    // 明確判斷這行是什麼：如果是電話/日期/航班/人數/收款，就不要放到備註
    if (/09\d{8}/.test(line)) return; // 電話
    if (jobTags.some((t) => line.includes(t))) return; // 送機/接機…
    if (/[A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2}/.test(line)) return; // 航班
    if (/收\s*(現金|匯款|刷卡)?\s*([\d,]+)/.test(line)) return; // 收款
    if (/人數/.test(line) || /位貴賓/.test(line)) return; // 人數
    if (/^\d{1,2}[\/.-]\d{1,2}/.test(line) || /\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(line)) {
      return; // 日期
    }

    // 地址行：這裡有兩種做法：
    //  1. 完全不要放進備註（現在採用這個）
    //  2. 要是你之後希望備註也出現地址再調整
    if (/[市區鄉鎮路街巷村里號]/.test(line)) {
      // 已經在 addresses 裡的就不放備註
      return;
    }

    // 其餘的行（例如：請至環宇接貴賓 / 貴賓會在環宇內用餐），通通當成備註的一部分
    remarkLines.push(line);
  });

  if (remarkLines.length > 0) {
    data.remark = remarkLines.join("\n");
  }

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

  // 不再自動加「等 X 位」，改成單純顯示貴賓姓名
  const guestSuffix = ""; // 若你之後想恢復可以再改

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
    `🌟備註：\n${remark}\n\n` +
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
