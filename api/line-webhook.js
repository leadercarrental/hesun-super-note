// api/line-webhook.js
// 賀森超強筆記 — 純規則 Pro 版 v4

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

// 把開頭的符號（▪️•●- 等）去掉
function stripBullet(line) {
  return line.replace(/^[\u2022\u2023\u25E6\u2043\u2219▪•●▶️➤\-]+[\s]*/, "");
}

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

  let lines = safeText
    .split(/\r?\n/)
    .map((l) => stripBullet(l.trim()))
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

  // 2) 日期：優先吃「出發日期」
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
  let baseFlight = "";
  let flightTime = "";

  // 3-1 「航班名稱：星宇航空JX821」
  lines.forEach((line, idx) => {
    const m = line.match(/^航班名稱[:：]\s*(.+)/);
    if (m) {
      baseFlight = m[1].trim();
      usedLineIndex.add(idx);
    }
  });

  // 3-2 「航班落地時間：14:35」
  lines.forEach((line, idx) => {
    const m = line.match(/(航班落地時間|落地時間|抵達時間)[^0-9]*([0-2]?\d:\d{2})/);
    if (m) {
      flightTime = m[2];
      usedLineIndex.add(idx);
    }
  });

  // 3-3 舊格式 BR166/06:15 或 航班編號：CX464【21:20】
  if (!baseFlight) {
    const flightLabel = safeText.match(
      /航班編號[:：]\s*([A-Z0-9]{2,})[^\d]{0,4}([0-2]?\d:\d{2})/
    );
    if (flightLabel) {
      baseFlight = `${flightLabel[1]}`;
      flightTime = flightTime || flightLabel[2];
      lines.forEach((line, idx) => {
        if (line.includes("航班編號")) usedLineIndex.add(idx);
      });
    } else {
      const flightMatch = safeText.match(
        /([A-Z0-9]{2,}\s*\/\s*[0-2]?\d:\d{2})/
      );
      if (flightMatch) {
        data.flight = flightMatch[1].replace(/\s*/g, "");
        const t = data.flight.match(/(\d{1,2}:\d{2})/);
        if (t) flightTime = flightTime || t[1];
        lines.forEach((line, idx) => {
          if (line.includes(flightMatch[1].trim())) usedLineIndex.add(idx);
        });
      }
    }
  }

  if (baseFlight) {
    data.flight = flightTime ? `${baseFlight}/${flightTime}` : baseFlight;
  }

  // 4) pickup_time：載客時間優先，接機用落地時間
  const pickupMatch = safeText.match(/載客時間\s*([0-2]?\d:\d{2})/);
  if (pickupMatch) {
    data.pickup_time = pickupMatch[1];
  } else if (!data.pickup_time && data.job_tag === "接機" && flightTime) {
    data.pickup_time = flightTime;
  }

  // 5) 先吃「姓名：」「聯絡人：」當貴賓
  lines.forEach((line, idx) => {
    if (data.guest_name) return;
    let m = line.match(/^(姓名|聯絡人)[:：]\s*(.+)/);
    if (m) {
      data.guest_name = m[2].trim();
      usedLineIndex.add(idx);
    }
  });

  // 6) 電話 + 姓名（補姓名）
  let phoneIdx = -1;
  lines.forEach((line, idx) => {
    const m = line.match(/(09\d{8})/);
    if (m && phoneIdx === -1) {
      phoneIdx = idx;
      data.guest_phone = m[1];

      if (!data.guest_name) {
        let before = line.slice(0, m.index).trim();
        before = before.replace(/^電話[:：]?\s*/i, "").trim();
        if (before) {
          data.guest_name = before;
          usedLineIndex.add(idx);
        } else if (idx > 0) {
          let prev = lines[idx - 1].replace(/^(姓名|聯絡人)[:：]\s*/, "");
          data.guest_name = prev.trim();
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

  // (a) 有序號行
  lines.forEach((line, idx) => {
    if (/^\d+[\.\s、]/.test(line) || /^[１２３４５６７８９]/.test(line)) {
      let addr = line.replace(/^[\d１２３４５６７８９]+[.\s、]?/, "").trim();
      if (addr) addrCandidates.push({ addr, idx });
    }
  });

  // (b) 無序號但像地址，排除航班
  lines.forEach((line, idx) => {
    if (line.includes("航班編號")) return;
    let addrLine = line.trim();

    // 去掉常見 label
    addrLine = addrLine.replace(/^(上車地點|下車地點|地址)[:：]\s*/, "");
    addrLine = addrLine.replace(/^(再加一個點|再加一個點：)\s*/, "");

    const hasAddressMarker = /[市區鄉鎮路街巷村里號]/.test(addrLine);
    const hasPhone = /09\d{8}/.test(addrLine);
    const looksLikePayment = /收\s*(現金|匯款|刷卡)?\s*[\d,]+/.test(addrLine);
    const looksLikeFlight = /[A-Z0-9]{2,}\s*\/\s*\d{1,2}:\d{2}/.test(addrLine);
    if (hasAddressMarker && !hasPhone && !looksLikePayment && !looksLikeFlight) {
      addrCandidates.push({ addr: addrLine, idx });
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

  // 8) 人數：乘車人數 / 人數
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

  // 9) 行李：行李數量 / 行李件數
  const luggageMatch =
    safeText.match(/行李(數量)?(件數)?[:：]\s*([0-9\-~＋+]+)/) ||
    safeText.match(/行李[^0-9]*([0-9\-~＋+]+)/);
  if (luggageMatch) {
    data.luggage = luggageMatch[3] || luggageMatch[1];
  }
  lines.forEach((line, idx) => {
    if (/行李(數量)?(件數)?[:：]/.test(line)) {
      usedLineIndex.add(idx);
    }
  });

  // 10) 收款方式：費用 / 收 / 收款
  const payMatchLabel = safeText.match(
    /費用[:：]\s*([^\d\$元]*)\$?\s*([\d,]+)/
  );
  if (payMatchLabel) {
    let methodRaw = (payMatchLabel[1] || "").trim();
    let method = "";
    if (/現金/.test(methodRaw)) method = "現金";
    else if (/匯款/.test(methodRaw)) method = "匯款";
    else if (/刷卡/.test(methodRaw)) method = "刷卡";
    const amount = payMatchLabel[2];
    data.payment = `${method || ""} ${amount} 元`.trim();
  } else {
    const payMatch =
      safeText.match(/收款[:：]?\s*(現金|匯款|刷卡)?\s*([\d,]+)/) ||
      safeText.match(/收\s*(現金|匯款|刷卡)?\s*([\d,]+)/);
    if (payMatch) {
      const method = payMatch[1] || "現金";
      const amount = payMatch[2];
      data.payment = `${method} ${amount} 元`;
    }
  }
  lines.forEach((line, idx) => {
    if (/費用[:：]/.test(line)) usedLineIndex.add(idx);
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
  } else if (/保母車/.test(safeText) && !data.car_type) {
    data.car_type = "豪華新大T保母車";
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
    if (/^日期/.test(line)) return;
    if (/^航班名稱/.test(line)) return;
    if (/航班落地時間|落地時間|抵達時間/.test(line)) return;
    if (/航班編號[:：]/.test(line)) return;
    if (/出發日期[:：]/.test(line)) return;
    if (/聯絡人[:：]/.test(line)) return;
    if (/姓名[:：]/.test(line)) return;
    if (/電話[:：]/.test(line)) return;
    if (/乘車人數|人數/.test(line)) return;
    if (/行李(數量)?(件數)?[:：]/.test(line)) return;
    if (/上車地點[:：]/.test(line)) return;
    if (/下車地點[:：]/.test(line)) return;
    if (/其他備註[:：]/.test(line)) return;
    if (/費用[:：]/.test(line)) return;
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
