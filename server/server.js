const express = require('express');
const multer = require('multer');
const dotenv = require('dotenv');
const cors = require('cors');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse'); 
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
app.use(cors());
const upload = multer();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});
  
app.post('/api/process-file', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded.' });

    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/pdf', 
      'image/png', 
      'image/jpeg', 
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Please upload an Excel, PDF, or image file.' });
    }

    let fileContent = "Limited summary content due to file type restrictions.";

    
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet);

      fileContent = jsonData.slice(0, Math.min(20, jsonData.length))
        .map((row, index) => {
          return `Invoice ${index + 1} - Customer: ${row['Party Name'] || 'N/A'}, Product: ${row['Product Name'] || 'N/A'}, Qty: ${row['Qty'] || 'N/A'}, Total: ${row['Item Total Amount'] || 'N/A'}`;
        })
        .join('\n');
    } else if (file.mimetype === 'application/pdf') {
      const pdfData = await pdfParse(file.buffer);
      fileContent = pdfData.text.slice(0, 1000); 
    }

    
    const fileData = {
      inlineData: {
        data: Buffer.from(fileContent).toString('base64'),
        mimeType: 'text/plain',
      },
    };

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent([
      fileData,
      {
        text: `
          Extract the following information in JSON format:
          - Invoices: { Serial Number, Customer Name, Product Name, Qty, Tax, Total Amount, Date }
          - Products: { Product Name, Category, Unit Price, Tax, Price with Tax, Stock Quantity }
          - Customers: { Customer Name, Phone Number, Total Purchase Amount }
          Ensure the response follows strict JSON formatting.
        `,
      },
    ]);

    let responseText = result.response.text();
    console.log("Raw API Response:", responseText);

    responseText = responseText.replace(/```json|```/g, '').trim();
    responseText = responseText.match(/{[\s\S]*}/)?.[0] || responseText;

    let data;
    try {
      data = JSON.parse(responseText);
      return res.json({
        invoices: data.Invoices || [],
        products: data.Products || [],
        customers: data.Customers || [],
        rawResponse: null,
      });
    } catch (jsonError) {
      console.warn("Response is not valid JSON. Returning raw text instead.");
      return res.json({ invoices: [], products: [], customers: [], rawResponse: responseText });
    }
  } catch (error) {
    console.error('Error processing file:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to process the file.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
