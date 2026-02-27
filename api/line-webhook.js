// api/line-webhook.js
// 賀森超強筆記 — 純規則 Pro 版 v3

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

      // 單獨查司機指令
      if (userText === "陳俊豪") {
        await replyMessage(
          event.replyToken,
          "司機：陳俊豪\n電話：0973550190\n車號：RFD-\n車型：豪華新大T保母車"
        );
        continue;
      }

      if (userText === "陳正紘") {
        await replyMessage(
          event.replyToken,
          "司機：陳正紘\n電話：0937429798\n車號：RFD-\n車型：豪華新大T保母車"
        );
        continue;
      }

      // 其他視為派車內容
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

// 司機資料表
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

  // 2) 日期：先看「出發日期」
  let dateMatch =
    safeText.match(/出發日期[:：]\s*([0-9]{1,2}[\/.-][0-9]{1,2})/) ||
    safeText.match(/(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/) ||
    safeText.match(/(\d{1,2}[\/.-]\d{1,2})/);
  if (dateMatch) {
    data.date = dateMatch[1];
    lines.forEach((line, idx) => {
      if (line.includes(dateMatch[0])) usedLineIndex.add(idx);
    });
  }

  // 3) 航班 flight
  // 3-1 專門吃「航班編號：CX464【21:20】」
  let flightMatchLabel = safeText.match(
    /航班編號[:：]\s*([A-Z0-9]{2,})[^\d]{0,4}([0-2]?\d:\d{2})/
  );
  if (flightMatchLabel) {
    data.flight = `${flightMatchLabel[1]}/${flightMatchLabel[2]}`;
    lines.forEach((line, idx) => {
      if (line.includes("航班編號")) usedLineIndex.add(idx);
    });
  } else {
    // 3-2 原本的：BR166/06:15
    const flightMatch = safeText.match(
      /([A-Z0-9]{2,}\s*\/\s*[0-2]?\d:\d{2})/
    );
    if (flightMatch) {
      data.flight = flightMatch[1].replace(/\s*/g, "");
      lines.forEach((line, idx) => {
        if (line.includes(flightMatch[1].trim())) usedLineIndex.add(idx);
      });
    }
  }

  // 4) pickup_time：載客時間優先，接機用航班時間
  const pickupMatch = safeText.match(/載客時間\s*([0-2]?\d:\d{2})/);
  if (pickupMatch) {
    data.pickup_time = pickupMatch[1];
  } else if (data.job_tag === "接機" && data.flight) {
    const t = data.flight.match(/(\d{1,2}:\d{2})/);
    if (t) data.pickup_time = t[1];
  }

  // 5) 先吃「聯絡人：XXX」當貴賓
  lines.forEach((line, idx) => {
    const m = line.match(/^聯絡人[:：]\s*(.+)/);
    if (m) {
      data.guest_name = m[1].trim();
      usedLineIndex.add(idx);
    }
  });

  // 6) 電話 + 姓名：電話行若有前綴「電話：」，不拿來當姓名
  let phoneIdx = -1;
  lines.forEach((line, idx) => {
    const m = line.match(/(09\d{8})/);
    if (m && phoneIdx === -1) {
      phoneIdx = idx;
      data.guest_phone = m[1];

      // 如果前面還沒從「聯絡人」取得姓名，才補
      if (!data.guest_name) {
        let before = line.slice(0, m.index).trim();
        // 去掉「電話：」「Tel:」這類前綴
        before = before.replace(/^電話[:：]?\s*/i, "").trim();
        if (before) {
          data.guest_name = before;
          usedLineIndex.add(idx);
        } else if (idx > 0) {
          data.guest_name = lines[idx - 1];
          usedLineIndex.add(idx);
          usedLineIndex.add(idx - 1);
        } else {
          usedLineIndex.add(idx);
        }
      } else {
        usedLineIndex.add(idx);
      }
    }
  });

  // 7) 地址：有序號 + 無序號；一行多個地址拆開
  const addrCandidates = [];

  // (a) 有序號
  lines.forEach((line, idx) => {
    if (/^\d+[\.\s、]/.test(line) || /^[１２３４５６７８９]/.test(line)) {
      let addr = line.replace(/^[\d１２３４５６７８９]+[.\s、]?/, "").trim();
      if (addr) addrCandidates.push({ addr, idx });
    }
  });

  // (b) 無序號但像地址，排除「航班編號」
  lines.forEach((line, idx) => {
    if (line.includes("航班編號")) return; // 避免航班被當地址
    const hasAddressMarker = /[市區鄉鎮路街巷村里號]/.test(line);
    const hasPhone = /09\d{8}/.test(line);
    const looksLikePayment = /收\s*(現金|匯款|刷卡)?\s*[\d,]+/.test(line);
    const looksLikeFlight = /[A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2}/.test(line);
    if (hasAddressMarker && !hasPhone && !looksLikePayment && !looksLikeFlight) {
      let addr = line.trim();
      // 去掉「上車地點：」「下車地點：」「地址：」
      addr = addr.replace(/^(上車地點|下車地點|地址)[:：]\s*/, "");
      addrCandidates.push({ addr, idx });
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

  // 8) 人數：先吃「乘車人數：4」
  let pc = "";
  const peopleLabeled = safeText.match(
    /(乘車人數|人數)[:：]\s*([0-9]+)/
  );
  if (peopleLabeled) {
    pc = peopleLabeled[2];
  } else {
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
  }
  if (pc) data.people_count = pc;

  lines.forEach((line, idx) => {
    if (/乘車人數/.test(line) || /人數/.test(line) || /位貴賓/.test(line)) {
      usedLineIndex.add(idx);
    }
  });

  // 9) 行李：行李數量：4
  const luggageMatch = safeText.match(/行李(數量)?[:：]\s*([0-9]+)/);
  if (luggageMatch) {
    data.luggage = luggageMatch[2];
  }
  lines.forEach((line, idx) => {
    if (/行李(數量)?[:：]/.test(line)) {
      usedLineIndex.add(idx);
    }
  });

  // 10) 收款方式：收現金7000 / 收 7000 / 收款 現金 7000
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

  // 11) 安全座椅
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

  // 12) 車型關鍵字
  if (/豪華新?大T/.test(safeText)) {
    data.car_type = "豪華新大T保母車";
  } else if (/大\s*T|大T/.test(safeText)) {
    data.car_type = "大T";
  } else if (/Caddy/i.test(safeText)) {
    data.car_type = "Caddy";
  } else if (/Touran/i.test(safeText)) {
    data.car_type = "Touran";
  }

  // 13) 司機行：司機陳俊豪 / 司機 陳俊豪
  lines.forEach((line, idx) => {
    const m = line.match(/^司機[:：]?\s*(\S+)/);
    if (m) {
      const driverName = m[1].trim();
      const info = lookupDriver(driverName);
      data.driver_name = info.driver_name;
      data.driver_phone = info.driver_phone;
      data.car_plate = info.car_plate;
      if (!data.car_type && info.car_type) data.car_type = info.car_type;
      usedLineIndex.add(idx);
    }
  });

  // 14) 備註：剩下比較像自然語句的
  const remarkLines = [];
  lines.forEach((line, idx) => {
    if (!line) return;
    if (usedLineIndex.has(idx)) return;

    if (/09\d{8}/.test(line)) return;
    if (jobTags.some((t) => line.includes(t))) return;
    if (/[A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2}/.test(line)) return;
    if (/出發日期[:：]/.test(line)) return;
    if (/聯絡人[:：]/.test(line)) return;
    if (/電話[:：]/.test(line)) return;
    if (/乘車人數|人數/.test(line)) return;
    if (/行李(數量)?[:：]/.test(line)) return;
    if (/上車地點[:：]/.test(line)) return; // 若你希望上車地點也進地址可改這裡
    if (/下車地點[:：]/.test(line)) return;
    if (/其他備註[:：]/.test(line)) return;
    if (/航班編號[:：]/.test(line)) return;
    if (/收款/.test(line) || /收\s*(現金|匯款|刷卡)?\s*[\d,]+/.test(line)) return;
    if (
      /^\d{1,2}[\/.-]\d{1,2}/.test(line) ||
      /\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(line)
    )
      return;
    if (/[市區鄉鎮路街巷村里號]/.test(line)) {
      // 地址行已處理
      return;
    }
    if (/^司機[:：]?/.test(line)) return;

    remarkLines.push(line);
  });

  if (remarkLines.length > 0) {
    data.remark = remarkLines.join("\n");
  }

  return data;
}

// 純規則：不呼叫外部 API
async function generateDispatchSheet(rawText) {
  try {
    const parsed = parseDispatch(rawText || "");
    return buildDispatchText(parsed || {});
  } catch (err) {
    console.error("解析派車資料發生錯誤：", err);
    return `（派車資料解析失敗，暫時先回原文）\n\n${rawText}`;
  }
}

// 組成派車單文字
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

module.exports = handler;
