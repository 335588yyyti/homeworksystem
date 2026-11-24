/**
 * 下課檢查站：把今日聯絡簿發到 BAND
 *
 * 看板按「確認，發到BAND」後會把內容送到這支程式，這支程式再用 BAND Open API 發文。
 * BAND 的金鑰和發布密碼只放在這裡的「指令碼屬性」，不會出現在看板或公開的程式碼裡。
 *
 * 需要的指令碼屬性（專案設定 → 指令碼屬性）：
 *   BAND_ACCESS_TOKEN  BAND 開發者網站給的 access token
 *   BAND_KEY           要發文的那個 BAND 的 band_key（可以先執行 listMyBands 查）
 *   PUBLISH_PASSWORD   老師在看板上要輸入的發布密碼（自己訂，不要跟其他密碼一樣）
 * 選填：
 *   DO_PUSH            填 false 就不推播通知（預設會推播）
 */

var BAND_API = 'https://openapi.band.us';

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return reply({ ok: false, error: '收到的資料看不懂' });
  }

  // 密碼打錯太多次就先擋 10 分鐘，避免被一直猜
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= 10) return reply({ ok: false, error: '密碼錯太多次，請 10 分鐘後再試' });
  var password = props.getProperty('PUBLISH_PASSWORD');
  if (!password || String(body.password || '') !== password) {
    cache.put('fails', String(fails + 1), 600);
    Utilities.sleep(1000);
    return reply({ ok: false, error: '發布密碼不對' });
  }

  var content = String(body.content || '').trim().slice(0, 3000);
  if (!content) return reply({ ok: false, error: '沒有內容可以發' });
  var date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) ? String(body.date) : '';

  var token = props.getProperty('BAND_ACCESS_TOKEN');
  var bandKey = props.getProperty('BAND_KEY');
  if (!token || !bandKey) return reply({ ok: false, error: '發布程式還沒設定 BAND_ACCESS_TOKEN 或 BAND_KEY' });

  // 同一時間只發一篇；同一天的聯絡簿發過了就不再發（看板勾「確定要再發一次」才發）
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (date && !body.force && props.getProperty('LAST_POSTED_DATE') === date) {
      return reply({ ok: false, already: true, error: '這天的聯絡簿已經發過了' });
    }
    var res = UrlFetchApp.fetch(BAND_API + '/v2.2/band/post/create', {
      method: 'post',
      payload: {
        access_token: token,
        band_key: bandKey,
        content: content,
        do_push: props.getProperty('DO_PUSH') === 'false' ? 'false' : 'true'
      },
      muteHttpExceptions: true
    });
    var text = res.getContentText();
    var data = {};
    try { data = JSON.parse(text); } catch (err) {}
    if (res.getResponseCode() === 200 && data.result_code === 1) {
      if (date) props.setProperty('LAST_POSTED_DATE', date);
      cache.remove('fails');
      return reply({ ok: true, post_key: data.result_data && data.result_data.post_key });
    }
    console.error('BAND 回覆：' + res.getResponseCode() + ' ' + text);
    return reply({ ok: false, error: 'BAND 沒有發成功（' + res.getResponseCode() + '）：' + text.slice(0, 200) });
  } finally {
    lock.releaseLock();
  }
}

// 打開網址時顯示的說明（確認部署成功用）
function doGet() {
  return reply({ ok: true, message: '下課檢查站的 BAND 發布程式已經在運作' });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 查自己的 BAND 清單和 band_key：在編輯器上方選這個函式，按「執行」，到「執行記錄」看結果。
 * 先在指令碼屬性填好 BAND_ACCESS_TOKEN。
 */
function listMyBands() {
  var token = PropertiesService.getScriptProperties().getProperty('BAND_ACCESS_TOKEN');
  var res = UrlFetchApp.fetch(BAND_API + '/v2.1/bands?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  if (data.result_code !== 1) {
    console.log('查詢失敗：' + res.getContentText());
    return;
  }
  (data.result_data.bands || []).forEach(function (band) {
    console.log(band.name + '　→　band_key：' + band.band_key);
  });
}

/** 不用看板，直接測試發一篇（會真的發到 BAND，測完記得刪掉那篇） */
function testPost() {
  var props = PropertiesService.getScriptProperties();
  var result = doPost({ postData: { contents: JSON.stringify({
    password: props.getProperty('PUBLISH_PASSWORD'),
    content: '這是下課檢查站的測試發文，可以刪掉',
    force: true
  }) } });
  console.log(result.getContent());
}
