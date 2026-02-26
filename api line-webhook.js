// api/line-webhook.js

// 主入口
export default async function handler(req, res) {
  // LINE Webhook 一定是 POST，其他直接略過
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  let body = req.body;

  // 保險：有些環境 req.body 可能是 undefined，我們自己解析一次 raw body
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

      let replyText = "";

      // ✅ 司機快捷：陳俊豪
      if (userText === "陳俊豪") {
        replyText =
          "司機：陳俊豪\n" +
          "電話：0973550190\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
      }
      // ✅ 司機快捷：陳正紘
      else if (userText === "陳正紘") {
        replyText =
          "司機：陳正紘\n" +
          "電話：0937429798\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
      }
      // 其他狀況，先用 echo 測試通道
      else {
        replyText = `你剛剛傳的是：\n${userText}`;
      }

      await replyMessage(event.replyToken, replyText);
    }
  }

  // 一定要回 200 告訴 LINE「我收到了」
  return res.status(200).send("OK");
}

// 呼叫 LINE Reply API 的小工具
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
