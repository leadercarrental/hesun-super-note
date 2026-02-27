// api/line-webhook.js
// 賀森超強筆記 — 純規則 Pro 版 v2
// 不用任何外部 AI，支援：
// - 自動判斷接機/送機
// - 自動解析日期、航班、時間、姓名、電話、地址、人數、收款
// - 小朋友安全座椅
// - 備註（例如：請至環宇接貴賓）
// - 車型關鍵字
// - 「司機 XXX」自動帶出司機資料（陳俊豪 / 陳正紘）

// ---------------------- LINE Webhook 主入口 ----------------------
async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  let body = req.body;

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

  const events = body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = (event.message.text || "").trim();

      // 仍保留原本的兩個「單獨打名字就吐司機資料」指令
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

      // 其他文字 → 視為派車單內容
      const replyText = await generateDispatchSheet(userText);
      await replyMessage(event.replyToken, replyText);
    }
  }

  return res.status(200).send("OK");
}

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

// ---------------------- 純規則解析區 ----------------------

// 中文數字 → 阿拉伯數字（簡單版）
function chineseDigitToNumber(ch) {
  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    兩: 2,
  };
  return map[ch] || null;
}

// 司機資料表（之後要加新司機可以在這邊加）
function lookupDriver(name) {
  if (name === "陳俊豪") {
    return {
      driver_name: "陳俊豪",
      driver_phone: "0973550190",
      car_plate: "RFD-",
      car_type: "豪華新大T保母車",
    };
  }
  if (name === "陳正紘") {
    return {
      driver_name: "陳正紘",
      driver_phone: "0937429798",
      car_plate: "RFD-",
      car_type: "豪華新大T保母車",
    };
  }
  return {
    driver_name: name || "",
    driver_phone: "",
    car_plate: "",
    car_type: "",
  };
}

// 主解析函式
function parseDispatch(rawText) {
  const data = {
    job_tag: "",
    date: "",
    flight: "",
    pickup_time: "",
    guest_name: "",
    guest_phone: "",
    addresses: [],
    people_count: "",
    luggage: "",
    child_seat: "",
    remark: "",
    payment: "",
    car_type: "",
    driver_name: "",
    driver_phone: "",
    car_plate: "",
  };

  const safeText = (rawText || "").trim();
  const lines = safeText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const usedLineIndex = new Set();

  // 1) job_tag：送機 / 接機 / 單接 / 單送
  const jobTags = ["送機", "接機", "單接", "單送"];
  for (const tag of jobTags) {
    if (safeText.includes(tag)) {
      data.job_tag = tag;
      break;
    }
  }

  // 2) 日期
  let dateMatch =
    safeText.match(/(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/) ||
    safeText.match(/(\d{1,2}[\/.-]\d{1,2})/);
  if (dateMatch) {
    data.date = dateMatch[1];
    lines.forEach((line, idx) => {
      if (line.includes(data.date)) usedLineIndex.add(idx);
    });
  }

  // 3) 航班 flight：BR166/06:15、JX851/19:05
  const flightMatch = safeText.match(/([A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2})/);
  if (flightMatch) {
    data.flight = flightMatch[1].replace(/\s*/g, ""); // 去掉多餘空白
    lines.forEach((line, idx) => {
      if (line.includes(flightMatch[1].trim())) usedLineIndex.add(idx);
    });
  }

  // 4) pickup_time：載客時間優先，接機則可用航班時間
  const pickupMatch = safeText.match(/載客時間\s*([0-2]?\d:\d{2})/);
  if (pickupMatch) {
    data.pickup_time = pickupMatch[1];
  } else if (data.job_tag === "接機" && data.flight) {
    const t = data.flight.match(/(\d{1,2}:\d{2})/);
    if (t) data.pickup_time = t[1];
  }

  // 5) 電話 + 姓名
  //   ➤ 先看「同一行」有沒有在電話前面的文字（例如：'陳沛暄0988xxxxxx'）
  //   ➤ 有就用同一行的名字；沒有才退回用上一行
  let phoneIdx = -1;
  lines.forEach((line, idx) => {
    const m = line.match(/(09\d{8})/);
    if (m && phoneIdx === -1) {
      phoneIdx = idx;
      data.guest_phone = m[1];

      const namePart = line.slice(0, m.index).trim();
      if (namePart) {
        // 同一行的電話前文字當姓名
        data.guest_name = namePart;
        usedLineIndex.add(idx);
      } else if (idx > 0) {
        // 沒有的話才退回上一行
        data.guest_name = lines[idx - 1];
        usedLineIndex.add(idx);
        usedLineIndex.add(idx - 1);
      } else {
        usedLineIndex.add(idx);
      }
    }
  });

  // 6) 地址：有序號 + 無序號；一行多個地址拆開
  const addrCandidates = [];

  // (a) 有序號
  lines.forEach((line, idx) => {
    if (/^\d+[\.\s、]/.test(line) || /^[１２３４５６７８９]/.test(line)) {
      let addr = line.replace(/^[\d１２３４５６７８９]+[.\s、]?/, "").trim();
      if (addr) addrCandidates.push({ addr, idx });
    }
  });

  // (b) 無序號但看起來像地址
  lines.forEach((line, idx) => {
    const hasAddressMarker = /[市區鄉鎮路街巷村里號]/.test(line);
    const hasPhone = /09\d{8}/.test(line);
    const looksLikePayment = /收\s*(現金|匯款|刷卡)?\s*[\d,]+/.test(line);
    const looksLikeFlight = /[A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2}/.test(line);
    if (hasAddressMarker && !hasPhone && !looksLikePayment && !looksLikeFlight) {
      addrCandidates.push({ addr: line.trim(), idx });
    }
  });

  const addrSet = new Set();
  addrCandidates.forEach((item) => {
    const segs = item.addr.split(/[、，,；;]/);
    segs.forEach((s) => {
      const seg = s.trim();
      if (!seg) return;
      if (!/[市區鄉鎮路街巷村里號]/.test(seg)) return;
      if (!addrSet.has(seg)) {
        addrSet.add(seg);
        data.addresses.push(seg);
        usedLineIndex.add(item.idx);
      }
    });
  });

  // 7) 人數：阿拉伯數字 + 中文數字
  let pc = "";
  const peopleNum = safeText.match(/(\d+)\s*[位人]/);
  if (peopleNum) {
    pc = peopleNum[1];
  } else {
    const peopleCn =
      safeText.match(/人數.*?([一二三四五六七八九十兩])\s*[位人]/) ||
      safeText.match(/([一二三四五六七八九十兩])\s*位貴賓/);
    if (peopleCn) {
      const n = chineseDigitToNumber(peopleCn[1]);
      if (n) pc = String(n);
    }
  }
  if (pc) data.people_count = pc;

  lines.forEach((line, idx) => {
    if (/人數/.test(line) || /位貴賓/.test(line)) {
      usedLineIndex.add(idx);
    }
  });

  // 8) 收款方式：收現金7000 / 收 7000 / 收款 現金 7000
  const payMatch =
    safeText.match(/收款[:：]?\s*(現金|匯款|刷卡)?\s*([\d,]+)/) ||
    safeText.match(/收\s*(現金|匯款|刷卡)?\s*([\d,]+)/);
  if (payMatch) {
    const method = payMatch[1] || "現金";
    const amount = payMatch[2];
    data.payment = `${method} ${amount} 元`;
  }
  lines.forEach((line, idx) => {
    if (/收\s*(現金|匯款|刷卡)?\s*[\d,]+/.test(line) || /收款/.test(line)) {
      usedLineIndex.add(idx);
    }
  });

  // 9) 安全座椅
  const csMatch =
    safeText.match(/(小朋友|小孩|兒童).*?(\d+)[\s]*位.*(安全座椅|兒童座椅)/) ||
    safeText.match(
      /(小朋友|小孩|兒童).*?([一二三四五六七八九十兩])[\s]*位.*(安全座椅|兒童座椅)/
    ) ||
    safeText.match(/(安全座椅|兒童座椅)/);
  if (csMatch) {
    let count = "";
    if (csMatch[2]) {
      if (/^\d+$/.test(csMatch[2])) {
        count = csMatch[2];
      } else {
        const n = chineseDigitToNumber(csMatch[2]);
        if (n) count = String(n);
      }
    }
    if (count) {
      data.child_seat = `需要安全座椅 ${count} 位`;
    } else {
      data.child_seat = "需要安全座椅";
    }
    lines.forEach((line, idx) => {
      if (/安全座椅|兒童座椅/.test(line)) usedLineIndex.add(idx);
    });
  }

  // 10) 車型：大T / 豪華大T / Caddy / Touran
  if (/豪華新?大T/.test(safeText)) {
    data.car_type = "豪華新大T保母車";
  } else if (/大\s*T|大T/.test(safeText)) {
    data.car_type = "大T";
  } else if (/Caddy/i.test(safeText)) {
    data.car_type = "Caddy";
  } else if (/Touran/i.test(safeText)) {
    data.car_type = "Touran";
  }

  // 11) 司機行：例如「司機 陳俊豪」
  lines.forEach((line, idx) => {
    const m = line.match(/^司機[:：]?\s*(\S+)/);
    if (m) {
      const driverName = m[1].trim();
      const info = lookupDriver(driverName);
      data.driver_name = info.driver_name;
      data.driver_phone = info.driver_phone;
      data.car_plate = info.car_plate;

      // 如果前面沒抓到車型，這裡可以順便補上
      if (!data.car_type && info.car_type) {
        data.car_type = info.car_type;
      }

      usedLineIndex.add(idx);
    }
  });

  // 12) 備註：其他看起來不屬於以上任一類的句子
  const remarkLines = [];
  lines.forEach((line, idx) => {
    if (!line) return;
    if (usedLineIndex.has(idx)) return;

    if (/09\d{8}/.test(line)) return;
    if (jobTags.some((t) => line.includes(t))) return;
    if (/[A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2}/.test(line)) return;
    if (/收\s*(現金|匯款|刷卡)?\s*[\d,]+/.test(line) || /收款/.test(line)) return;
    if (/人數/.test(line) || /位貴賓/.test(line)) return;
    if (
      /^\d{1,2}[\/.-]\d{1,2}/.test(line) ||
      /\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(line)
    )
      return;
    if (/[市區鄉鎮路街巷村里號]/.test(line)) {
      // 地址行 → 已經進 addresses，就不丟備註
      return;
    }
    if (/^司機[:：]?/.test(line)) return; // 司機行已經處理

    remarkLines.push(line);
  });

  if (remarkLines.length > 0) {
    data.remark = remarkLines.join("\n");
  }

  return data;
}

// 純規則：不呼叫任何外部 API
async function generateDispatchSheet(rawText) {
  try {
    const parsed = parseDispatch(rawText || "");
    return buildDispatchText(parsed || {});
  } catch (err) {
    console.error("解析派車資料發生錯誤：", err);
    return `（派車資料解析失敗，暫時先回原文）\n\n${rawText}`;
  }
}

// 把 structured 資料組成派車單文字
function buildDispatchText(data) {
  const jobTag = data.job_tag || "";
  const date = data.date || "";
  const flight = data.flight || "";
  const pickupTime = data.pickup_time || "";
  const guestName = data.guest_name || "";
  const guestPhone = data.guest_phone || "";
  const addresses = Array.isArray(data.addresses) ? data.addresses : [];
  const peopleCount = data.people_count || "";
  const luggage = data.luggage || "";
  const childSeat = data.child_seat || "";
  const remark = data.remark || "";
  const carType = data.car_type || "";
  const payment = data.payment || "";
  const driverName = data.driver_name || "";
  const driverPhone = data.driver_phone || "";
  const carPlate = data.car_plate || "";

  const addressesBlock =
    addresses.length > 0
      ? addresses.map((addr, idx) => `${idx + 1}. ${addr}`).join("\n")
      : "";

  return (
    `✈️機場接送🚗預約單\n\n` +
    `📍【${jobTag}】\n\n` +
    `◆日期📅：${date}\n` +
    `◆航班名稱✈️：${flight}\n` +
    `◆載客時間🕰️：${pickupTime}\n` +
    `◆貴賓：${guestName}\n` +
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
    `收款方式：${payment}`
  );
}

// 匯出 handler
module.exports = handler;
