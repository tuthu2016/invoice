const { google } = require('googleapis');
const axios = require('axios');
const webhookBaseUrl = process.env.BITRIX_API_URL;
const credentials = process.env.credentials;
const sheetId = process.env.sheetId;

const entityTypeId = 31; // SMART_INVOICE
const batchSize = 50;
const batchDelay = 2000;
const maxRetries = 3;
const retryBaseDelay = 2000;

// Khởi tạo Google Sheets API
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: `$credentials`,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Lấy dữ liệu từ Google Sheet
async function getSheetData(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Script!A:I',
  });
  return response.data.values;
}

// Cập nhật kết quả lên Google Sheet
async function updateSheet(sheets, updates) {
  const validUpdates = updates.filter(update => update && Number.isInteger(update.rowIndex) && update.value);
  if (validUpdates.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    resource: {
      valueInputOption: 'RAW',
      data: validUpdates.map(({ rowIndex, value }) => ({
        range: `Script!I${rowIndex + 1}`,
        values: [[value]],
      })),
    },
  });
}

// Delay để tránh quá tải API
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Xử lý từng dòng, có kiểm tra retry
async function processRow(row, rowIndex, retries = 0) {
  const [contactId, productId, beginDate, sanLuong, total, soId, typeReturn, loaikh, result] = row;

  if (!Number.isInteger(rowIndex)) {
    console.error(`❌ Lỗi rowIndex không hợp lệ: ${rowIndex}`);
    return null;
  }

  // Kiểm tra nếu đã có invoice thì bỏ qua
  if (result && result.startsWith("✅ Invoice")) {
    console.log(`⏭️ Bỏ qua row ${rowIndex + 1} - Đã có invoice`);
    return null;
  }

  // Kiểm tra dữ liệu đầu vào
  if (!contactId || !productId || !beginDate || !sanLuong || !total) {
    return { rowIndex, value: "❌ Lỗi: Thiếu dữ liệu" };
  }

  try {
    // Lấy thông tin contact từ Bitrix24
    const contactResponse = await axios.post(`${webhookBaseUrl}crm.contact.get.json`, {
      id: contactId.toString(),
      select: ["NAME", "LAST_NAME", "ASSIGNED_BY_ID"],
    });
    const contactData = contactResponse.data.result;
    if (!contactData) {
      return { rowIndex, value: `❌ Lỗi: Contact ID ${contactId} không tồn tại` };
    }

    const invoiceTitle = `${contactData.NAME || ""} ${contactData.LAST_NAME || ""}`.trim();
    const assignedById = contactData.ASSIGNED_BY_ID;

    // Cập nhật thông tin contact
    await axios.post(`${webhookBaseUrl}crm.contact.update.json`, {
      id: contactId,
      fields: {
        "UF_CRM_1741144215": soId || "",
        "UF_CRM_1741144278": typeReturn || "",
        "UF_CRM_1741155771675": loaikh || "",
      },
    });

    // Tạo invoice trên Bitrix24
    const invoiceResponse = await axios.post(`${webhookBaseUrl}crm.item.add.json`, {
      entityTypeId,
      fields: {
        contactId: parseInt(contactId),
        title: invoiceTitle,
        BEGINDATE: beginDate,
        opportunity: parseFloat(total),
        currencyId: "VND",
        ASSIGNED_BY_ID: parseInt(assignedById || 1),
      },
    });

    const invoiceData = invoiceResponse.data.result?.item;
    if (!invoiceData || !invoiceData.id) {
      return { rowIndex, value: `❌ Lỗi tạo invoice: ${JSON.stringify(invoiceResponse.data)}` };
    }

    const invoiceId = parseInt(invoiceData.id);

    // Gán sản phẩm vào invoice
    const productResponse = await axios.post(`${webhookBaseUrl}crm.item.productrow.set.json`, {
      ownerId: invoiceId,
      ownerType: "SI",
      productRows: [{
        productId: parseInt(productId),
        price: parseFloat(total) / parseFloat(sanLuong),
        quantity: parseInt(sanLuong),
        sort: 10,
      }],
    });

    const productResult = productResponse.data.result;
    return {
      rowIndex,
      value: productResult
        ? `✅ Invoice ${invoiceId} created`
        : `❌ Lỗi thêm sản phẩm: ${JSON.stringify(productResponse.data)}`,
    };
  } catch (error) {
    if (error.response?.status === 503 && retries < maxRetries) {
      const retryDelayMs = retryBaseDelay * Math.pow(2, retries); // 2s, 4s, 8s, ...
      console.log(`🔄 Retry row ${rowIndex + 1} (${retries + 1}/${maxRetries}) sau ${retryDelayMs}ms...`);
      await delay(retryDelayMs);
      return processRow(row, rowIndex, retries + 1);
    }
    return { rowIndex, value: `❌ Lỗi: ${error.message}` };
  }
}

// Xử lý từng batch (nhóm) dữ liệu
async function processBatch(rows, startIndex, sheets) {
  const updates = [];

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = startIndex + i;
    const row = rows[i];

    // Nếu đã có invoice thì bỏ qua
    if (row[8] && row[8].startsWith("✅ Invoice")) {
      console.log(`⏭️ Bỏ qua row ${rowIndex + 1} - Đã xử lý`);
      continue;
    }

    const result = await processRow(row, rowIndex);
    if (result) updates.push(result);
  }

  // Ghi lại kết quả vào Google Sheets nếu có thay đổi
  if (updates.length > 0) {
    await updateSheet(sheets, updates);
  }

  console.log(`✅ Processed batch ${startIndex + 1} - ${startIndex + rows.length}`);
}

// Hàm chính chạy toàn bộ quá trình
async function createSmartInvoice() {
  const sheets = await getSheetsClient();
  const data = await getSheetData(sheets);

  for (let i = 1; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    await processBatch(batch, i, sheets);
    await delay(batchDelay);
  }

  console.log("🎉 Done!");
}

// Xử lý khi bị dừng đột ngột
process.on('SIGINT', async () => {
  console.log("⚠️ Quá trình bị gián đoạn. Đang lưu kết quả...");
  process.exit(0);
});

// Chạy chương trình
createSmartInvoice().catch(error => console.error("❌ Lỗi:", error));
