// api/line-webhook.js

const SYSTEM_PROMPT = `
你是一個幫忙整理「機場接送派車單」的助手。
使用者會貼上一段原始文字，裡面可能包含：
- 出發或服務類型（例如：送機、接機、單接、單送）
- 日期
- 航班資訊（例如：BR166 / 06:15）
- 載客時間（例如：載客時間00:45）
- 貴賓姓名
- 電話
- 一到多個地址
- 人數
- 收款方式（例如：收現金7000）
- 司機姓名

請你根據以下規則解析資料，並輸出一個 JSON 物件。
不要亂猜，沒有提到的資料就用空字串 ""；數字用整數；陣列用陣列。
只回傳 JSON，不要有註解、說明文字或程式碼區塊。

一、📍服務類型（job_tag） → 對應派車單上 📍【】
- 從原始文字中尋找以下關鍵字（按照出現順序）：
  若包含「送機」→ job_tag = "送機"
  若包含「接機」→ job_tag = "接機"
  若包含「單接」→ job_tag = "單接"
  若包含「單送」→ job_tag = "單送"
- 若有多個同時出現，以最先出現的為主。
- 若完全沒有出現，job_tag = ""。

二、航班名稱 flight
- 從原始文字中尋找航班資訊，例如：「BR166 / 06:15」。
- flight 欄位請保留整段，包括斜線後面的時間。
- 若沒有明確航班資訊 → flight = ""。

三、載客時間 pickup_time
- 從原始文字中尋找載客時間，例如：「載客時間00:45」。
- 取出時間部分（例如 "00:45"），不需要保留「載客時間」四個字。
- 若找不到 → pickup_time = ""。

四、基本資訊
- date：日期（若有出現類似「2/28」、「2026-02-28」則存入，否則 ""）
- guest_name：貴賓姓名
- guest_phone：電話（例如 "0979217186"）
- addresses：字串陣列，每個元素是一個完整地址，去掉前面的序號或點號。
  例如：「1臺中市太平區環中東路三段377號」→ "台中市太平區環中東路三段377號"
- people_count：人數（若文字中有「7位」、「7人」，請轉成整數 7；否則用 null）
- luggage：行李資訊（若未提到則 ""）
- child_seat：有無安全座椅（若未提到則 ""）
- remark：備註（若未提到則 ""）

五、司機與車輛資訊（driver_name / driver_phone / car_plate / car_type）
※ 司機名字會在外部程式另外處理，這裡一律留空：
- driver_name：預設 ""
- driver_phone：預設 ""
- car_plate：預設 ""
- car_type：預設 ""

六、收款方式 payment
- 從原始文字中尋找收款資訊，例如：「收現金7000」、「收現金 7000 元」。
- 請轉成人類可讀的字串，例如："現金 7000 元"。
- 若找不到 → payment = ""。

七、輸出格式
請只回傳以下 JSON 物件，欄位為：

{
  "job_tag": string,
  "date": string,
  "flight": string,
  "pickup_time": string,
  "guest_name": string,
  "guest_phone": string,
  "addresses": string[],
  "people_count": number | null,
  "luggage": string,
  "child_seat": string,
  "remark": string,
  "driver_name": string,
  "driver_phone": string,
  "car_plate": string,
  "car_type": string,
  "payment": string
}

不要加任何說明文字、註解、其他欄位或程式碼區塊。
`;

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

      // 其他狀況：視為派車單原始資料，丟給 AI 整理
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

// 🔥 呼叫 OpenAI，幫你把一坨文字變成派車單
async function generateDispatchSheet(rawText) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("沒有找到 OPENAI_API_KEY 環境變數！");
    return `（系統還沒設定好 OPENAI_API_KEY，暫時先回原文）\n\n${rawText}`;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // 模型先用 gpt-4o-mini，比較多人有權限用
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: rawText },
        ],
        temperature: 0.2,
      }),
    });

    const respText = await response.text(); // 把 OpenAI 回覆原封不動存下來

    if (!response.ok) {
      // 這裡把錯誤直接回給你看，方便排錯
      console.error("OpenAI API 回應錯誤：", response.status, respText);
      return `AI 呼叫失敗：${response.status}\n${respText}\n\n（暫時先回原文）\n${rawText}`;
    }

    let data;
    try {
      data = JSON.parse(respText);
    } catch (e) {
      console.error("解析 OpenAI 回傳 JSON 失敗：", e, respText);
      return `AI 回傳格式怪怪的，解析失敗。\n${respText}\n\n（暫時先回原文）\n${rawText}`;
    }

    const content = (data.choices?.[0]?.message?.content || "").trim();

    // 再把 AI 產出的 JSON 字串 parse 出來
    let formattedText = "";
    try {
      const parsed = JSON.parse(content);
      formattedText = buildDispatchText(parsed);
    } catch (e) {
      console.error("解析 AI 內層 JSON 失敗：", e, content);
      formattedText = content;
    }

    return formattedText || content || rawText;
  } catch (err) {
    console.error("呼叫 OpenAI API 發生錯誤：", err);
    return `AI 呼叫整體失敗：${String(err)}\n\n（暫時先回原文）\n${rawText}`;
  }
}

// 根據 structured 資料組合派車單文字
function buildDispatchText(data) {
  const jobTag = data.job_tag || "";
  const date = data.date || "";
  const flight = data.flight || "";
  const pickupTime = data.pickup_time || "";
  const guestName = data.guest_name || "";
  const guestPhone = data.guest_phone || "";
  const addresses = Array.isArray(data.addresses) ? data.addresses : [];
  const peopleCount =
    typeof data.people_count === "number" ? data.people_count : "";
  const luggage = data.luggage || "";
  const childSeat = data.child_seat || "";
  const remark = data.remark || "";
  const driverName = data.driver_name || "";
  const driverPhone = data.driver_phone || "";
  const carPlate = data.car_plate || "";
  const carType = data.car_type || "";
  const payment = data.payment || "";

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

// 把 handler 匯出（CommonJS）
module.exports = handler;
