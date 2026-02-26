export default function handler(req, res) {
  // LINE 會用 POST 打這支 API
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const events = req.body.events || [];

  // 這裡我們只做最簡單的：回覆「收到囉」
  // 真正連回 LINE 需要 access token，這一步我們先不叫 LINE，只回個 200 表示成功
  console.log("收到 LINE 事件：", JSON.stringify(events, null, 2));

  return res.status(200).send("OK");
}
