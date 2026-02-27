// api/line-webhook.js
// 賀森超強筆記 v3.0 — Gemini v1 正式版（100%可用）

const SYSTEM_PROMPT = `
你是一個專門協助整理「機場接送派車單」的智能助手。
使用者會傳給你一段文字，你需要從裡面整理出派車單需要的資料，
以 JSON 方式輸出：

{
  "job_tag": "",
  "date": "",
  "flight": "",
  "pickup_time": "",
  "guest_name": "",
  "guest_phone": "",
  "addresses": [],
  "people_count": "",
  "luggage": "",
  "child_seat": "",
  "remark": "",
  "payment": "",
  "car_type": ""
}

規則如下：
1) job_tag：送機 / 接機 / 單接 / 單送
2) date：找第一個符合日期格式的
3) flight：如 BR166/06:15、JX851/19:05
4) pickup_time：
   - 如有「載客時間XX:YY」→ 使用該時間
   - 若是接機 → 使用 flight 時間
5) guest_name：電話上一行
6) guest_phone：找第一個 09xxxxxxxx
7) addresses：找任何包含 市/區/路/街/巷/號 的行，支持一行多地址
8) people_count：中英文數字皆可
9) child_seat：若含安全座椅 → 填入
10) payment：支援「收 7000」「收現金7000」
11) remark：其他無法分類的句子
12) car_type：大T、豪華大T、Caddy、Touran

請只輸出 JSON，不要描述文字。
`;

async function generateDispatchSheetGemini(rawText) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    // ✅ 正確的 v1 endpoint
    const url =
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.0-pro-latest:generateContent?key=" +
      apiKey;

    const payload = {
      contents: [
        { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        { role: "user", parts: [{ text: rawText }] },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Gemini Error:", data.error);
      return `（AI 錯誤：${data.error.message}）\n\n${rawText}`;
    }

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("解析 JSON 失敗：", text);
      return `（AI 回傳格式錯誤）\n${text}`;
    }

    return buildDispatchText(parsed);
  } catch (err) {
    console.error("Gemini 呼叫失敗：", err);
    return `（AI 呼叫失敗）\n${rawText}`;
  }
}

function buildDispatchText(data) {
  return `
✈️機場接送🚗預約單

📍【${data.job_tag || ""}】

◆日期📅：${data.date || ""}
◆航班名稱✈️：${data.flight || ""}
◆載客時間🕰️：${data.pickup_time || ""}
◆貴賓：${data.guest_name || ""}
◆電話：${data.guest_phone || ""}
◆地址：
${(data.addresses || [])
  .map((a, i) => `${i + 1}. ${a}`)
  .join("\n")}

◆人數：${data.people_count || ""}
◆行李：${data.luggage || ""}
◆有無安全座椅：${data.child_seat || ""}

🌟備註：
${data.remark || ""}

司機：
電話：
車號：
車型：${data.car_type || ""}
➖➖➖➖➖➖➖➖➖➖
收款方式：${data.payment || ""}
`.trim();
}

// LINE webhook 主程式
async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  const body = req.body || {};
  const events = body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text.trim();

      if (text === "陳俊豪") {
        await replyMessage(
          event.replyToken,
          "司機：陳俊豪\n電話：0973550190\n車號：RFD-\n車型：豪華新大T保母車"
        );
        continue;
      }

      if (text === "陳正紘") {
        await replyMessage(
          event.replyToken,
          "司機：陳正紘\n電話：0937429798\n車號：RFD-\n車型：豪華新大T保母車"
        );
        continue;
      }

      const result = await generateDispatchSheetGemini(text);
      await replyMessage(event.replyToken, result);
    }
  }

  res.status(200).send("OK");
}

async function replyMessage(replyToken, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return;

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

module.exports = handler;
